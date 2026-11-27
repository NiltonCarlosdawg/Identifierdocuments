import Elysia from "elysia";
import { Type as t } from "@sinclair/typebox";
import { desc, eq, sql } from "drizzle-orm";
// O painel lê cross-tenant: pool com app.auth_lookup ligado (ver db/index.ts).
import { lookupDb as db } from "../db";
import { withTenant } from "../db/withTenant";
import { auditLogs, licenses, organizations, orders, plans, providerUsers, users } from "../db/schema";
import { verifyPassword } from "../lib/password";
import { signProviderToken, requireProvider } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { getClientIp } from "../lib/ip";
import { approveOrder, OrderError, rejectOrder, orderDisplayName } from "../services/order.service";
import { getSubscriptionContext } from "../services/subscription.service";
import { getLicenseContext } from "../services/license.service";

/** Estado manual do tenant (audit incluída) — espelha o padrão de approveOrder. */
async function changeTenantStatus(
  tenantId: string,
  status: "free" | "paid" | "expired" | "suspended",
  action: "tenant.suspend" | "tenant.reactivate",
  providerUserId: string,
  ip?: string | null,
) {
  await withTenant(tenantId, async (tx) => {
    await tx.update(organizations)
      .set({ subscriptionStatus: status })
      .where(eq(organizations.id, tenantId));
    await tx.update(licenses)
      .set({
        status: status === "suspended" ? "suspended" : "active",
        updatedAt: new Date(),
        updatedBy: providerUserId,
      })
      .where(eq(licenses.tenantId, tenantId));
    await tx.insert(auditLogs).values({
      tenantId,
      userId: null,
      action,
      resource: "organizations",
      resourceId: tenantId,
      metadata: JSON.stringify({ providerUserId }),
      ip: ip ?? null,
    });
  });
  return { id: tenantId, status };
}

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
    // leftJoin: pedidos de clientes novos ainda não têm organização.
    const rows = await db.select({
      order: orders,
      orgName: organizations.name,
      planName: plans.name,
    }).from(orders)
      .leftJoin(organizations, eq(orders.tenantId, organizations.id))
      .innerJoin(plans, eq(orders.planId, plans.id))
      .orderBy(desc(orders.createdAt));
    return rows.map(({ order, orgName, planName }) => ({
      ...order,
      tenantName: orderDisplayName(orgName, order.companyName),
      isNewCustomer: order.tenantId === null,
      planName,
    }));
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
  })

  .get("/tenants", async () => {
    // Leitura cross-tenant pelo pool de lookup (app.auth_lookup), sem depender de BYPASSRLS.
    const rows = await db.select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      planName: plans.name,
      expiresAt: organizations.subscriptionExpiresAt,
      userCount: sql<number>`(select count(*)::int from ${users} where ${users.tenantId} = ${organizations.id})`,
    }).from(organizations)
      .innerJoin(plans, eq(organizations.planId, plans.id))
      .orderBy(desc(organizations.createdAt));

    // getSubscriptionContext devolve o status derivado (paid vencido => expired).
    return Promise.all(rows.map(async (row) => {
      const { status } = await getSubscriptionContext(row.id);
      return { ...row, status };
    }));
  }, { detail: { summary: "Listar tenants", tags: ["Painel"] } })

  .get("/licenses", async () => {
    const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
    return Promise.all(orgs.map(async (org) => {
      const ctx = await getLicenseContext(org.id);
      const activeRows = await db.execute(sql`select count(*)::int as n from users where tenant_id = ${org.id} and is_active = true`);
      const n = activeRows[0]?.n ?? 0;
      return {
        tenantId: org.id,
        tenantName: org.name,
        licenseNumber: ctx.license?.licenseNumber ?? null,
        state: ctx.state,
        status: ctx.license?.status ?? null,
        maxUsers: ctx.maxUsers,
        validUntil: ctx.validUntil,
        planName: ctx.plan?.name ?? null,
        activeUsers: n,
      };
    }));
  }, { detail: { summary: "Listar licenças", tags: ["Painel"] } })

  .patch("/licenses/:number", async (ctx: any) => {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    let found: { tenantId: string; licenseId: string } | null = null;
    for (const org of orgs) {
      const lic = await getLicenseContext(org.id);
      if (lic.license?.licenseNumber === ctx.params.number) {
        found = { tenantId: org.id, licenseId: lic.license.id };
        break;
      }
    }
    if (!found) {
      ctx.set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Licença não encontrada." } };
    }

    await withTenant(found.tenantId, async (tx) => {
      const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: ctx.provider.id };
      if (ctx.body.status) patch.status = ctx.body.status;
      if (ctx.body.maxUsers !== undefined) patch.maxUsers = ctx.body.maxUsers;
      if (ctx.body.validUntil !== undefined) patch.validUntil = ctx.body.validUntil ? new Date(ctx.body.validUntil) : null;
      if (ctx.body.extendDays) {
        const current = ctx.body.validUntil ? new Date(ctx.body.validUntil) : new Date();
        patch.validUntil = new Date(current.getTime() + ctx.body.extendDays * 86_400_000);
      }
      await tx.update(licenses).set(patch).where(eq(licenses.id, found!.licenseId));
      await tx.insert(auditLogs).values({
        tenantId: found!.tenantId,
        userId: null,
        action: "LICENSE_UPDATED",
        resource: "licenses",
        resourceId: found!.licenseId,
        metadata: JSON.stringify({ providerUserId: ctx.provider.id, changes: ctx.body }),
        ip: getClientIp(ctx.request),
      });
    });
    return { updated: true };
  }, {
    params: t.Object({ number: t.String() }),
    body: t.Object({
      status: t.Optional(t.Union([t.Literal("trial"), t.Literal("active"), t.Literal("expired"), t.Literal("suspended")])),
      maxUsers: t.Optional(t.Union([t.Integer({ minimum: 1 }), t.Null()])),
      validUntil: t.Optional(t.Union([t.String({ format: "date-time" }), t.Null()])),
      extendDays: t.Optional(t.Integer({ minimum: 1 })),
    }),
    detail: { summary: "Gerir licença", tags: ["Painel"] },
  })

  .post("/tenants/:id/suspend", async (ctx: any) => {
    const tenantId = ctx.params.id;
    const [org] = await db.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, tenantId)).limit(1);
    if (!org) {
      ctx.set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Organização não encontrada." } };
    }
    return changeTenantStatus(tenantId, "suspended", "tenant.suspend", ctx.provider.id, getClientIp(ctx.request));
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Suspender tenant", tags: ["Painel"] },
  })

  .post("/tenants/:id/reactivate", async (ctx: any) => {
    const tenantId = ctx.params.id;
    const [row] = await db.select({ org: organizations, plan: plans })
      .from(organizations)
      .innerJoin(plans, eq(organizations.planId, plans.id))
      .where(eq(organizations.id, tenantId)).limit(1);
    if (!row) {
      ctx.set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Organização não encontrada." } };
    }
    const status = row.plan.isFree
      ? "free"
      : row.org.subscriptionExpiresAt && row.org.subscriptionExpiresAt > new Date()
        ? "paid"
        : "expired";
    return changeTenantStatus(tenantId, status, "tenant.reactivate", ctx.provider.id, getClientIp(ctx.request));
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Reativar tenant", tags: ["Painel"] },
  });
