import Elysia from "elysia";
import { Type as t } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "../db/schema";
import { getFreshRoles, requireAuth } from "../middleware/auth";
import { isTenantAdmin } from "../services/access-decision.service";
import { checkRateLimit } from "../middleware/rateLimit";
import { getClientIp } from "../lib/ip";
import { createOrder, OrderError, resolveCheckoutToken, signCheckoutToken } from "../services/order.service";

const LANDING_URL = (process.env.LANDING_URL || "http://localhost:5173").replace(/\/+$/, "");

export const subscriptionsModule = new (Elysia as any)()

  .get("/subscriptions/checkout", async ({ query, set }: any) => {
    let claims: { tenantId: string; jti: string };
    try {
      claims = await resolveCheckoutToken(query.token);
    } catch {
      set.status = 401;
      return { error: { code: "INVALID_TOKEN", message: "Token de checkout inválido ou expirado." } };
    }
    // Tabela global: SEM withTenant.
    const [org] = await db.select({ name: organizations.name }).from(organizations)
      .where(eq(organizations.id, claims.tenantId)).limit(1);
    if (!org) {
      set.status = 401;
      return { error: { code: "INVALID_TOKEN", message: "Token de checkout inválido ou expirado." } };
    }
    return { tenantName: org.name };
  }, {
    query: t.Object({ token: t.String() }),
    detail: { summary: "Dados do checkout a partir do token (público)", tags: ["Subscrições"] },
  })

  .post("/orders", async ({ body, set, request }: any) => {
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`orders:${ip}`, 5, 60_000))) {
      set.status = 429;
      return { error: { code: "RATE_LIMITED", message: "Muitas tentativas. Tente novamente em 1 minuto." } };
    }
    try {
      const result = await createOrder(body);
      return { orderId: result.orderId, status: result.status };
    } catch (err) {
      if (err instanceof OrderError) {
        set.status = err.status;
        return { error: { code: err.code, message: err.message } };
      }
      throw err;
    }
  }, {
    body: t.Object({
      token: t.Optional(t.String()),
      tenantSlug: t.Optional(t.String()),
      tenantEmail: t.Optional(t.String({ format: "email" })),
      planId: t.String(),
      paymentMethod: t.Union([
        t.Literal("multicaixa"),
        t.Literal("transfer"),
        t.Literal("send_order"),
      ]),
      phone: t.Optional(t.String()),
      contactEmail: t.Optional(t.String({ format: "email" })),
    }),
    detail: { summary: "Criar pedido de subscrição (público)", tags: ["Subscrições"] },
  })

  .use(requireAuth())

  .post("/subscriptions/checkout-token", async ({ auth, set }: any) => {
    const roles = await getFreshRoles(auth.userId, auth.tenantId);
    if (!isTenantAdmin(roles)) {
      set.status = 403;
      return { error: { code: "FORBIDDEN", message: "Permissão insuficiente." } };
    }
    const token = await signCheckoutToken(auth.tenantId);
    return { token, url: `${LANDING_URL}/checkout?pedido=${token}` };
  }, {
    body: t.Object({}),
    detail: { summary: "Gerar token de checkout (ORG_ADMIN)", tags: ["Subscrições"] },
  });
