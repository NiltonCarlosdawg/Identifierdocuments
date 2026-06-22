import { Elysia, t } from "elysia";
import { login, getMe, changePassword, refreshToken } from "../services/auth.service";
import { requireAuth } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";

export const authModule = new Elysia({ prefix: "/auth" })

  .post("/login", async ({ body, request, set }) => {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    if (!checkRateLimit(`login:${ip}`)) {
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

  .post("/refresh", async ({ body, set }) => {
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
  });
