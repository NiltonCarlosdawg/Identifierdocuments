import { Elysia, t } from "elysia";
import { login, getMe, changePassword, refreshToken } from "../services/auth.service";
import { requireAuth } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { users } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";

export const authModule = new Elysia({ prefix: "/auth" })

  .post("/login", async ({ body, request, set }) => {
    const ip = request.headers.get("x-forwarded-for") || "unknown"; // TODO(security): validar/sanitizar IP; atualmente confia no header
    const rateLimitKey = `login:${ip}:${body.email}`;
    if (!(await checkRateLimit(rateLimitKey))) {
      set.status = 429;
      return { error: { code: "RATE_LIMITED", message: "Muitas tentativas. Tente novamente em 1 minuto." } };
    }
    try {
      const result = await login(body.email, body.password, body.organizationSlug);
      return { data: result };
    } catch (err: any) {
      set.status = 401;
      return { error: { code: "INVALID_CREDENTIALS", message: err.message } };
    }
  }, {
    body: t.Object({
      email: t.String({ format: "email" }),
      password: t.String({ minLength: 6 }),
      organizationSlug: t.Optional(t.String()),
    }),
    detail: { summary: "Login", tags: ["Autenticação"] },
  })

  .post("/refresh", async ({ body, request, set }) => {
    const ip = request.headers.get("x-forwarded-for") || "unknown"; // TODO(security): validar/sanitizar IP; atualmente confia no header
    const rateLimitKey = `refresh:${ip}`;
    if (!(await checkRateLimit(rateLimitKey, 10, 60000))) {
      set.status = 429;
      return { error: { code: "RATE_LIMITED", message: "Muitas tentativas. Tente novamente em 1 minuto." } };
    }
    try {
      const result = await refreshToken(body.token);
      return { data: result };
    } catch (err: any) {
      set.status = 401;
      return { error: { code: "TOKEN_EXPIRED", message: "Sessão expirada. Faça login novamente." } };
    }
  }, {
    body: t.Object({ token: t.String() }),
    detail: { summary: "Renovar token", tags: ["Autenticação"] },
  })

  .use(requireAuth())
  .get("/me", ({ auth }) => getMe(auth!), {
    detail: { summary: "Perfil do utilizador", tags: ["Autenticação"] },
  })

  .use(requireAuth())
  .patch("/me", async ({ auth, body, set, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      try {
        const [updated] = await tx.update(users)
          .set({ fullName: body.fullName })
          .where(eq(users.id, auth!.userId))
          .returning({ id: users.id, fullName: users.fullName, email: users.email });
        return { data: updated };
      } catch (err: any) {
        set.status = 400;
        return { error: { code: "UPDATE_ERROR", message: err.message } };
      }
    });
  }, {
    body: t.Object({ fullName: t.String() }),
    detail: { summary: "Actualizar perfil", tags: ["Autenticação"] },
  })

  .use(requireAuth())
  .patch("/me/password", async ({ auth, body, set }) => {
    try {
      return await changePassword(auth!, body.currentPassword, body.newPassword);
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "PASSWORD_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({ currentPassword: t.String(), newPassword: t.String({ minLength: 6 }) }),
    detail: { summary: "Alterar password", tags: ["Autenticação"] },
  })

  .use(requireAuth())
  .patch("/me/notifications-preferences", async ({ auth, body, tenantId, set }) => {
    return withTenant(tenantId, async (tx) => {
      try {
        const [updated] = await tx.execute(sql`
          UPDATE ${users} SET notification_preferences = COALESCE(notification_preferences, '{}'::jsonb) || ${JSON.stringify(body)}::jsonb
          WHERE id = ${auth!.userId}
          RETURNING id, notification_preferences
        `);
        return { data: updated };
      } catch (err: any) {
        set.status = 400;
        return { error: { code: "UPDATE_ERROR", message: safeError(err) } };
      }
    });
  }, {
    body: t.Object({
      approval_pending: t.Optional(t.Boolean()),
      approval_resolved: t.Optional(t.Boolean()),
      document_shared: t.Optional(t.Boolean()),
      sync_complete: t.Optional(t.Boolean()),
      watcher_detected: t.Optional(t.Boolean()),
    }),
    detail: { summary: "Actualizar preferências de notificação", tags: ["Autenticação"] },
  });
