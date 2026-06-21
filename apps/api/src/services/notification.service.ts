import { Elysia, t } from "elysia";
import { Redis } from "ioredis";
import { db } from "../db";
import { notifications } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

export interface NotificationEvent {
  type: string;
  userId: string;
  tenantId?: string;
  payload: Record<string, unknown>;
}

const subscribers = new Map<string, Set<(event: NotificationEvent) => void>>();

export function subscribe(userId: string, callback: (event: NotificationEvent) => void) {
  if (!subscribers.has(userId)) subscribers.set(userId, new Set());
  subscribers.get(userId)!.add(callback);
  return () => subscribers.get(userId)?.delete(callback);
}

export async function notify(event: NotificationEvent & { tenantId: string }) {
  const [row] = await db.insert(notifications).values({
    tenantId: event.tenantId,
    userId: event.userId,
    type: event.type,
    payload: JSON.stringify(event.payload),
  }).returning();

  const fullEvent = { ...event, payload: { ...event.payload, notificationId: row.id } };

  const userSubs = subscribers.get(event.userId);
  if (userSubs) userSubs.forEach((cb) => cb(fullEvent));
  await redis.publish(`notifications:${event.userId}`, JSON.stringify(fullEvent));
}

export const notificationSSEModule = new Elysia()
  .get("/notifications/stream", async ({ auth, query, set }) => {
    let userId: string | null = auth?.userId ?? null;

    if (!userId && query.access_token) {
      try {
        const { verifyToken } = await import("../middleware/auth");
        const payload = await verifyToken(query.access_token);
        userId = payload.userId;
      } catch {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Token inválido." } };
      }
    }

    if (!userId) {
      set.status = 401;
      return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } };
    }

    set.headers["Content-Type"] = "text/event-stream";
    set.headers["Cache-Control"] = "no-cache";
    set.headers["Connection"] = "keep-alive";

    const encoder = new TextEncoder();
    const streamUserId = userId;
    const stream = new ReadableStream({
      start(controller) {
        const heartbeat = setInterval(() => {
          controller.enqueue(encoder.encode(`:heartbeat\n\n`));
        }, 30000);

        const unsub = subscribe(streamUserId, (event) => {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`));
        });

        controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));

        return () => {
          clearInterval(heartbeat);
          unsub();
        };
      },
    });

    return stream;
  }, {
    query: t.Object({ access_token: t.Optional(t.String()) }),
    detail: { summary: "SSE stream de notificações", tags: ["Notificações"] },
  })

  .use(requireAuth())
  .get("/notifications", async ({ auth, query }) => {
    const conditions = [
      eq(notifications.tenantId, auth.tenantId),
      eq(notifications.userId, auth.userId),
    ];
    if (query.unreadOnly === "true") {
      conditions.push(eq(notifications.isRead, false));
    }

    const rows = await db.query.notifications.findMany({
      where: and(...conditions),
      orderBy: [desc(notifications.createdAt)],
      limit: query.limit ? Number(query.limit) : 50,
    });

    return {
      data: rows.map((r) => ({
        id: r.id,
        type: r.type,
        payload: JSON.parse(r.payload),
        isRead: r.isRead,
        createdAt: r.createdAt,
      })),
    };
  }, {
    query: t.Object({
      unreadOnly: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
    detail: { summary: "Histórico de notificações", tags: ["Notificações"] },
  })

  .patch("/notifications/:id/read", async ({ auth, params, set }) => {
    const [row] = await db.update(notifications)
      .set({ isRead: true })
      .where(and(
        eq(notifications.id, params.id),
        eq(notifications.userId, auth.userId),
        eq(notifications.tenantId, auth.tenantId),
      ))
      .returning();

    if (!row) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Notificação não encontrada." } }; }
    return { data: { id: row.id, isRead: true } };
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Marcar notificação como lida", tags: ["Notificações"] },
  });
