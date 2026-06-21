import { Elysia, t } from "elysia";
import { login, getMe, changePassword } from "../services/auth.service";
import { requireAuth } from "../middleware/auth";

export const authModule = new Elysia({ prefix: "/auth" })

  .post("/login", async ({ body, set }) => {
    try {
      const result = await login(body.email, body.password);
      return { data: result };
    } catch (err: any) {
      set.status = 401;
      return { error: { code: "INVALID_CREDENTIALS", message: err.message } };
    }
  }, {
    body: t.Object({ email: t.String({ format: "email" }), password: t.String({ minLength: 6 }) }),
    detail: { summary: "Login", tags: ["Autenticação"] },
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
