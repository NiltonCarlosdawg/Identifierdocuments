import Elysia from "elysia";
import { Type as t } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { providerUsers } from "../db/schema";
import { verifyPassword } from "../lib/password";
import { signProviderToken, requireProvider } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { getClientIp } from "../lib/ip";

export const providerModule = new (Elysia as any)({ prefix: "/provider" })

  .post("/login", async (ctx: any) => {
    const { body, request, set } = ctx;
    if (!(await checkRateLimit(`provider-login:${getClientIp(request)}:${body.email}`))) {
      set.status = 429;
      return { error: { code: "RATE_LIMITED", message: "Muitas tentativas. Tente novamente em 1 minuto." } };
    }
    const [user] = await db.select().from(providerUsers)
      .where(eq(providerUsers.email, body.email)).limit(1);
    if (!user || !user.isActive || !(await verifyPassword(body.password, user.passwordHash))) {
      set.status = 401;
      return { error: { code: "PROVIDER_INVALID_CREDENTIALS", message: "Credenciais inválidas." } };
    }
    return { token: await signProviderToken({ id: user.id, email: user.email }) };
  }, {
    body: t.Object({
      email: t.String({ format: "email" }),
      password: t.String({ minLength: 6 }),
    }),
    detail: { summary: "Login do painel", tags: ["Painel"] },
  })

  // As rotas reais de pedidos/organizações chegam nas tasks 9–12.
  .use(requireProvider())
  .get("/orders", () => [], { detail: { summary: "Pedidos (placeholder)", tags: ["Painel"] } });
