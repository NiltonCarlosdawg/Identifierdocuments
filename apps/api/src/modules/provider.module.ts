import Elysia from "elysia";
import { Type as t } from "@sinclair/typebox";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { organizations, orders, plans, providerUsers } from "../db/schema";
import { verifyPassword } from "../lib/password";
import { signProviderToken, requireProvider } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { getClientIp } from "../lib/ip";
import { approveOrder, OrderError, rejectOrder } from "../services/order.service";

const planFields = {
  name: t.String({ minLength: 1 }),
  price: t.Integer({ minimum: 0 }),
  maxUsers: t.Integer({ minimum: 1 }),
  monthlyOnlineIdentifiers: t.Integer({ minimum: 1 }),
  offlineBudgetPerMachine: t.Integer({ minimum: 1 }),
};

export const providerModule = new (Elysia as any)({ prefix: "/provider" })

  // O onError global do index é ignorado em erros de validação de body.
  .onError(({ code, set }: any) => {
    if (code === "VALIDATION") {
      set.status = 422;
      return { error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } };
    }
  })

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

  // Tabela global: SEM withTenant (plans não é uma tabela de tenant).
  .use(requireProvider())

  .get("/plans", async () => {
    const rows = await db.select().from(plans);
    return { plans: rows };
  }, {
    detail: { summary: "Listar planos", tags: ["Painel"] },
  })

  .post("/plans", async ({ body }: any) => {
    const { name, price, maxUsers, monthlyOnlineIdentifiers, offlineBudgetPerMachine } = body;
    const [created] = await db.insert(plans).values({
      name, price, maxUsers, monthlyOnlineIdentifiers, offlineBudgetPerMachine,
      isFree: false,
      active: true,
    }).returning();
    return created;
  }, {
    body: t.Object(planFields),
    detail: { summary: "Criar plano", tags: ["Painel"] },
  })

  .put("/plans/:id", async ({ params, body, set }: any) => {
    const [plan] = await db.select().from(plans).where(eq(plans.id, params.id)).limit(1);
    if (!plan) {
      set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Plano não encontrado." } };
    }
    // Free é imutável: nem campos nem active=false.
    if (plan.isFree) {
      set.status = 403;
      return { error: { code: "FREE_PLAN_IMMUTABLE", message: "O plano free não pode ser alterado." } };
    }
    const { name, price, maxUsers, monthlyOnlineIdentifiers, offlineBudgetPerMachine, active } = body;
    const [updated] = await db.update(plans).set({
      name, price, maxUsers, monthlyOnlineIdentifiers, offlineBudgetPerMachine,
      ...(active === undefined ? {} : { active }),
    }).where(eq(plans.id, params.id)).returning();
    return updated;
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ ...planFields, active: t.Optional(t.Boolean()) }),
    detail: { summary: "Editar plano", tags: ["Painel"] },
  })

  .get("/orders", async () => {
    // Tabelas globais: SEM withTenant.
    const rows = await db.select({
      order: orders,
      tenantName: organizations.name,
      planName: plans.name,
    }).from(orders)
      .innerJoin(organizations, eq(orders.tenantId, organizations.id))
      .innerJoin(plans, eq(orders.planId, plans.id))
      .orderBy(desc(orders.createdAt));
    return rows.map(({ order, tenantName, planName }) => ({ ...order, tenantName, planName }));
  }, { detail: { summary: "Listar pedidos", tags: ["Painel"] } })

  .post("/orders/:id/approve", async (ctx: any) => {
    try {
      return await approveOrder(ctx.params.id, ctx.provider.id, getClientIp(ctx.request));
    } catch (err) {
      if (err instanceof OrderError) {
        ctx.set.status = err.status;
        return { error: { code: err.code, message: err.message } };
      }
      throw err;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Aprovar pedido", tags: ["Painel"] },
  })

  .post("/orders/:id/reject", async (ctx: any) => {
    try {
      return await rejectOrder(ctx.params.id, ctx.provider.id, ctx.body.reason, getClientIp(ctx.request));
    } catch (err) {
      if (err instanceof OrderError) {
        ctx.set.status = err.status;
        return { error: { code: err.code, message: err.message } };
      }
      throw err;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ reason: t.String({ minLength: 1 }) }),
    detail: { summary: "Rejeitar pedido", tags: ["Painel"] },
  });
