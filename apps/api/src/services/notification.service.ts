import { Elysia, t } from "elysia";
import { Redis } from "ioredis";
import { db, DB } from "../db";
import { withTenant } from "../db/withTenant";
import { notifications } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redisPassword = process.env.REDIS_PASSWORD;
const redis = new Redis(redisUrl, redisPassword ? { password: redisPassword } : {});

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

export async function notify(tx: DB, event: NotificationEvent & { tenantId: string }) {
  const [row] = await tx.insert(notifications).values({
    tenantId: event.tenantId,
    userId: event.userId,
    type: event.type,
    payload: JSON.stringify(event.payload),
  }).returning();

  const fullEvent = { ...event, payload: { ...event.payload, notificationId: row.id } };

  const userSubs = subscribers.get(event.userId);
  if (userSubs) userSubs.forEach((cb) => cb(fullEvent));

  // CORREÇÃO: notify() é chamado a meio de fluxos de negócio importantes (ex.: criar
  // uma partilha em documents.module.ts). Antes, se o Redis estivesse em baixo ou a
  // publicação falhasse por qualquer razão, a excepção subia até ao handler chamador,
  // cujo try/catch devolvia um erro 400/500 ao cliente — mesmo que a operação principal
  // (ex.: a partilha) já tivesse sido gravada com sucesso na base de dados. A entrega
  // em tempo real é um "nice to have"; a sua falha não deve mascarar nem reverter o
  // sucesso da operação que a originou. A notificação já ficou persistida em
  // `notifications` acima e será visível em GET /notifications mesmo que o push em
  // directo falhe.
  try {
    await redis.publish(`notifications:${event.userId}`, JSON.stringify(fullEvent));
  } catch (err) {
    console.error("[NOTIFY] Falha ao publicar no Redis (notificação já persistida em BD):", err);
  }
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
    set.headers["Cache-Control"] = "no-cache, no-store";
    set.headers["Connection"] = "keep-alive";
    set.headers["X-Accel-Buffering"] = "no";

    if (!auth?.userId && query.access_token) {
      console.warn(`[SSE] Token via query param para userId=${userId} — considerar token SSE dedicado`);
    }

    const encoder = new TextEncoder();
    const streamUserId = userId;
    // CORREÇÃO CRÍTICA: a Streams API não trata o valor devolvido por start() como
    // callback de cancelamento — isso é o papel exclusivo de cancel(). O código
    // anterior devolvia a função de limpeza dentro de start(), que nunca era invocada
    // quando o cliente desligava. Resultado: a cada reconexão SSE ficava um
    // subscritor "morto" acumulado em `subscribers` (memory leak num processo de
    // longa duração) e o heartbeat correspondente continuava a correr indefinidamente.
    // Agora heartbeat/unsub são geridos fora do start() e libertados em cancel().
    let active = true;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsub: (() => void) | undefined;

    const stream = new ReadableStream({
      start(controller) {
        heartbeat = setInterval(() => {
          if (!active) { clearInterval(heartbeat); return; }
          try {
            controller.enqueue(encoder.encode(`:heartbeat\n\n`));
          } catch {
            active = false;
            clearInterval(heartbeat);
          }
        }, 30000);

        unsub = subscribe(streamUserId, (event) => {
          if (!active) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`));
          } catch {
            active = false;
            if (heartbeat) clearInterval(heartbeat);
          }
        });

        controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));
      },
      cancel() {
        active = false;
        if (heartbeat) clearInterval(heartbeat);
        unsub?.();
      },
    });

    return stream;
  }, {
    query: t.Object({ access_token: t.Optional(t.String()) }),
    detail: { summary: "SSE stream de notificações", tags: ["Notificações"] },
  })

  .use(requireAuth())
  .get("/notifications", async ({ tenantId, auth, query }) => {
    return withTenant(tenantId, async (tx) => {
      const conditions = [
        eq(notifications.tenantId, tenantId),
        eq(notifications.userId, auth.userId),
      ];
      if (query.unreadOnly === "true") {
        conditions.push(eq(notifications.isRead, false));
      }

      const parsedLimit = query.limit ? parseInt(query.limit, 10) : 50;
      const limit = Math.min(Math.max(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50, 1), 100);

      const rows = await tx.query.notifications.findMany({
        where: and(...conditions),
        orderBy: [desc(notifications.createdAt)],
        limit,
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
    });
  }, {
    query: t.Object({
      unreadOnly: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
    detail: { summary: "Histórico de notificações", tags: ["Notificações"] },
  })

  .patch("/notifications/:id/read", async ({ tenantId, auth, params, set }) => {
    return withTenant(tenantId, async (tx) => {
      const [row] = await tx.update(notifications)
        .set({ isRead: true })
        .where(and(
          eq(notifications.id, params.id),
          eq(notifications.userId, auth.userId),
          eq(notifications.tenantId, tenantId),
        ))
        .returning();

      if (!row) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Notificação não encontrada." } }; }
      return { data: { id: row.id, isRead: true } };
    });
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Marcar notificação como lida", tags: ["Notificações"] },
  });