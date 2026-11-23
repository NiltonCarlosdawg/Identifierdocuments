/**
 * Pedidos de subscrição: token de checkout single-use, fallback e notificação.
 * Self-contained: arranca a API numa porta própria e mata-a no fim.
 * TABELAS GLOBAIS — orders/plans/organizations sem withTenant nas queries directas.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { decodeJwt, SignJWT } from "jose";

import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { auditLogs, documents, identifiers, orders, organizations, plans, providerUsers, roles, sectors, userRoles, users , licenses } from "../db/schema";
import { hashPassword } from "../lib/password";
import { signProviderToken } from "../middleware/auth";
import { checkUploadLimit } from "../services/subscription.service";

const API_ROOT = join(import.meta.dir, "..", "..");
const TEST_PORT = process.env.ORDERS_TEST_PORT || "3110";
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = Date.now().toString(36);
const SLUG = `orders-tenant-${RUN_ID}`;
const ADMIN_EMAIL = `orders-admin-${RUN_ID}@test.docid`;
const PROVIDER_EMAIL = `orders-provider-${RUN_ID}@test.docid`;
const TENANT_NAME = `Pedidos Org ${RUN_ID}`;
const PASSWORD = "testpass123";
const DAY_MS = 24 * 60 * 60 * 1000;

let serverProc: Subprocess | null = null;
let adminToken = "";
let adminUserId = "";
let providerToken = "";
let providerUserId = "";
let tenantId = "";
let paidPlanId = "";
let upgradePlanId = "";
let freePlanId = "";
let inactivePlanId = "";
let firstApprovedOrderId = "";

type AnyBody = Record<string, any>;

async function api<T = AnyBody>(
  path: string,
  opts: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const body = await res.json();
  return { status: res.status, body: body as T };
}

async function waitForApi(maxMs = 20000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await Bun.sleep(300);
  }
  return false;
}

async function checkoutToken(): Promise<string> {
  const res = await api<{ token: string; url: string }>("/subscriptions/checkout-token", {
    method: "POST",
    token: adminToken,
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
  expect(res.body.token).toBeTruthy();
  return res.body.token;
}

type OrderFields = {
  planId: string;
  paymentMethod: "multicaixa" | "transfer" | "send_order";
  phone: string;
  contactEmail: string;
};

function orderBody(planId = paidPlanId): OrderFields {
  return {
    planId,
    paymentMethod: "multicaixa",
    phone: "912345678",
    contactEmail: `contacto-${RUN_ID}@test.docid`,
  };
}

async function newPendingOrder(planId = paidPlanId): Promise<string> {
  const res = await api<any>("/orders", {
    method: "POST",
    body: JSON.stringify({ ...orderBody(planId), tenantSlug: SLUG }),
  });
  expect(res.status).toBe(200);
  return res.body.orderId;
}

function approve(orderId: string) {
  return api<any>(`/provider/orders/${orderId}/approve`, { method: "POST", token: providerToken });
}

function reject(orderId: string, body: Record<string, unknown>) {
  return api<any>(`/provider/orders/${orderId}/reject`, {
    method: "POST", token: providerToken, body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const [free] = await db.select().from(plans).where(eq(plans.isFree, true)).limit(1);
  expect(free).toBeTruthy();
  freePlanId = free.id;

  const [paid] = await db.insert(plans).values({
    name: `Pedidos pago ${RUN_ID}`,
    price: 250000,
    maxUsers: 10,
    monthlyOnlineIdentifiers: 500,
    offlineBudgetPerMachine: 1000,
  }).returning();
  paidPlanId = paid.id;

  // Plano de upgrade: headroom para o teste de geração pós-aprovação e para renovação.
  const [upgrade] = await db.insert(plans).values({
    name: `Pedidos upgrade ${RUN_ID}`,
    price: 400000,
    maxUsers: 20,
    monthlyOnlineIdentifiers: 500,
    offlineBudgetPerMachine: 1000,
  }).returning();
  upgradePlanId = upgrade.id;

  const [inactive] = await db.insert(plans).values({
    name: `Pedidos inactivo ${RUN_ID}`,
    price: 250000,
    maxUsers: 10,
    monthlyOnlineIdentifiers: 500,
    offlineBudgetPerMachine: 1000,
    active: false,
  }).returning();
  inactivePlanId = inactive.id;

  const [provider] = await db.insert(providerUsers).values({
    email: PROVIDER_EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    name: "Provedora Teste",
  }).returning();
  providerUserId = provider.id;
  providerToken = await signProviderToken({ id: provider.id, email: provider.email });

  serverProc = spawn({
    cmd: ["bun", "src/index.ts"],
    cwd: API_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    // Sem SMTP: mailer cai para log; NODE_ENV=test desactiva rate limit.
    env: { ...process.env, PORT: TEST_PORT, NODE_ENV: "test", SMTP_HOST: "", ALLOW_PUBLIC_ONBOARDING: "true" },
  });
  if (!(await waitForApi())) throw new Error("API não está disponível em " + BASE);

  const created = await api<any>("/tenants", {
    method: "POST",
    body: JSON.stringify({
      name: TENANT_NAME,
      slug: SLUG,
      adminEmail: ADMIN_EMAIL,
      adminPassword: PASSWORD,
      identifierPrefix: "PED",
      termsAccepted: true,
    }),
  });
  expect(created.status).toBe(200);
  tenantId = created.body.data.id;
  await db.delete(licenses).where(eq(licenses.tenantId, tenantId));

  const login = await api<any>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }),
  });
  expect(login.status).toBe(200);
  adminToken = login.body.data.token;
  expect(login.body.data.user.roles).toContain("ORG_ADMIN");
  const [adminUser] = await db.select({ id: users.id }).from(users)
    .where(eq(users.email, ADMIN_EMAIL)).limit(1);
  adminUserId = adminUser.id;
}, 45000);

afterAll(async () => {
  serverProc?.kill(9);
  if (tenantId) {
    // Tabela global: SEM withTenant.
    await db.delete(orders).where(eq(orders.tenantId, tenantId));
    await withTenant(tenantId, async (tx) => {
      await tx.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
      await tx.delete(documents).where(eq(documents.tenantId, tenantId));
      await tx.delete(identifiers).where(eq(identifiers.tenantId, tenantId));
      await tx.delete(userRoles).where(
        sql`${userRoles.userId} IN (SELECT ${users.id} FROM ${users} WHERE ${users.tenantId} = ${tenantId})`,
      );
      await tx.delete(users).where(eq(users.tenantId, tenantId));
      await tx.delete(roles).where(eq(roles.tenantId, tenantId));
      await tx.delete(sectors).where(eq(sectors.tenantId, tenantId));
      await tx.delete(organizations).where(eq(organizations.id, tenantId));
    });
  }
  if (providerUserId) await db.delete(providerUsers).where(eq(providerUsers.id, providerUserId));
  if (paidPlanId) await db.delete(plans).where(eq(plans.id, paidPlanId));
  if (upgradePlanId) await db.delete(plans).where(eq(plans.id, upgradePlanId));
  if (inactivePlanId) await db.delete(plans).where(eq(plans.id, inactivePlanId));
});

describe("token de checkout", () => {
  test("admin obtém token assinado com purpose/audience/48h e url da landing", async () => {
    const res = await api<{ token: string; url: string }>("/subscriptions/checkout-token", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const claims = decodeJwt(res.body.token);
    expect(claims.purpose).toBe("checkout");
    expect(claims.tenantId).toBe(tenantId);
    expect(claims.aud).toBe("docid-checkout");
    expect(claims.iss).toBe("docid-api");
    expect(typeof claims.jti).toBe("string");
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(48 * 3600);
    expect(res.body.url).toContain("/checkout?pedido=");
    expect(res.body.url).toContain(res.body.token);
  });

  test("GET /subscriptions/checkout devolve o nome do tenant; token inválido/expirado é 401", async () => {
    const token = await checkoutToken();
    const ok = await api<any>(`/subscriptions/checkout?token=${encodeURIComponent(token)}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ tenantName: TENANT_NAME });

    const bad = await api<any>("/subscriptions/checkout?token=nao-e-um-jwt");
    expect(bad.status).toBe(401);
    expect(bad.body.error).toEqual({
      code: "INVALID_TOKEN",
      message: "Token de checkout inválido ou expirado.",
    });

    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const expired = await new SignJWT({ purpose: "checkout", tenantId, jti: randomUUID() })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .setIssuer("docid-api")
      .setAudience("docid-checkout")
      .sign(secret);
    const expiredRes = await api<any>(`/subscriptions/checkout?token=${encodeURIComponent(expired)}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error?.code).toBe("INVALID_TOKEN");
  });

  test("sem auth, checkout-token é 401; sem ORG_ADMIN é 403", async () => {
    const noAuth = await api<any>("/subscriptions/checkout-token", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(noAuth.status).toBe(401);
    expect(noAuth.body.error?.code).toBe("UNAUTHORIZED");

    const memberToken = await new SignJWT({
      userId: randomUUID(), tenantId, sectorId: null, roles: ["MEMBER"],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer("docid-api")
      .setAudience("docid-desktop")
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    const res = await api<any>("/subscriptions/checkout-token", {
      method: "POST",
      token: memberToken,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("FORBIDDEN");
  });
});

describe("criação de pedidos", () => {
  test("com token + plano pago cria pedido pending e guarda o jti", async () => {
    const token = await checkoutToken();
    const claims = decodeJwt(token);
    const res = await api<any>("/orders", {
      method: "POST",
      body: JSON.stringify({ ...orderBody(), token }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orderId: expect.any(String), status: "pending" });

    // Tabela global: SEM withTenant.
    const [row] = await db.select().from(orders).where(eq(orders.id, res.body.orderId));
    expect(row).toMatchObject({
      tenantId,
      planId: paidPlanId,
      paymentMethod: "multicaixa",
      phone: "912345678",
      contactEmail: `contacto-${RUN_ID}@test.docid`,
      status: "pending",
      checkoutJti: claims.jti,
    });
  });

  test("repetir o mesmo token dá 409 TOKEN_USED", async () => {
    const token = await checkoutToken();
    const body = JSON.stringify({ ...orderBody(), token });
    expect((await api<any>("/orders", { method: "POST", body })).status).toBe(200);
    const again = await api<any>("/orders", { method: "POST", body });
    expect(again.status).toBe(409);
    expect(again.body.error).toEqual({
      code: "TOKEN_USED",
      message: "Este token de checkout já foi utilizado.",
    });
  });

  test("sem token, fallback por slug e por email de utilizador existente", async () => {
    const bySlug = await api<any>("/orders", {
      method: "POST",
      body: JSON.stringify({ ...orderBody(), tenantSlug: SLUG }),
    });
    expect(bySlug.status).toBe(200);

    const byEmail = await api<any>("/orders", {
      method: "POST",
      body: JSON.stringify({ ...orderBody(), tenantEmail: ADMIN_EMAIL }),
    });
    expect(byEmail.status).toBe(200);

    for (const id of [bySlug.body.orderId, byEmail.body.orderId]) {
      const [row] = await db.select().from(orders).where(eq(orders.id, id));
      expect(row.tenantId).toBe(tenantId);
      expect(row.checkoutJti).toBeTruthy();
    }
  });

  test("tenant inexistente (slug/email) dá 404 TENANT_NOT_FOUND", async () => {
    const byEmail = await api<any>("/orders", {
      method: "POST",
      body: JSON.stringify({ ...orderBody(), tenantEmail: `ninguem-${RUN_ID}@test.docid` }),
    });
    expect(byEmail.status).toBe(404);
    expect(byEmail.body.error).toEqual({
      code: "TENANT_NOT_FOUND",
      message: "Organização não encontrada.",
    });

    const bySlug = await api<any>("/orders", {
      method: "POST",
      body: JSON.stringify({ ...orderBody(), tenantSlug: `sem-este-slug-${RUN_ID}` }),
    });
    expect(bySlug.status).toBe(404);
    expect(bySlug.body.error?.code).toBe("TENANT_NOT_FOUND");
  });

  test("plano free, inactivo ou inexistente dá 404 PLAN_NOT_FOUND", async () => {
    for (const planId of [freePlanId, inactivePlanId, randomUUID()]) {
      const res = await api<any>("/orders", {
        method: "POST",
        body: JSON.stringify({ ...orderBody(planId), tenantSlug: SLUG }),
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual({
        code: "PLAN_NOT_FOUND",
        message: "Plano não encontrado.",
      });
    }
  });

  test("sem telefone ou email de contacto: 422 VALIDATION_ERROR e nenhum pedido criado", async () => {
    const countSql = sql<number>`count(*)::int`;
    const [before] = await db.select({ n: countSql }).from(orders).where(eq(orders.tenantId, tenantId));

    for (const campo of ["phone", "contactEmail"]) {
      const body: AnyBody = { ...orderBody(), tenantSlug: SLUG };
      delete body[campo];
      const res = await api<any>("/orders", { method: "POST", body: JSON.stringify(body) });
      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: "VALIDATION_ERROR",
        message: "Dados inválidos.",
      });
    }

    const [after] = await db.select({ n: countSql }).from(orders).where(eq(orders.tenantId, tenantId));
    expect(after.n).toBe(before.n);
  });

  test("sem SMTP, createOrder não lança e devolve log", async () => {
    // Import dinâmico: o serviço é testável sem HTTP.
    const { createOrder } = await import("../services/order.service");
    const result = await createOrder({ ...orderBody(), tenantSlug: SLUG });
    expect(result.status).toBe("pending");
    expect(result.orderId).toBeTruthy();

    const [row] = await db.select().from(orders).where(eq(orders.id, result.orderId));
    expect(row.tenantId).toBe(tenantId);
  });
});

describe("aprovação e rejeição de pedidos (painel)", () => {
  async function currentOrg() {
    const [row] = await db.select().from(organizations).where(eq(organizations.id, tenantId)).limit(1);
    return row;
  }

  test("aprovar: pedido approved e organization paid com plano e expiresAt ≈ now+365d", async () => {
    const orderId = await newPendingOrder();
    const antes = Date.now();
    const res = await approve(orderId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orderId, status: "approved" });

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order).toMatchObject({ status: "approved", decidedBy: providerUserId });
    expect(order.decidedAt).toBeTruthy();

    const org = await currentOrg();
    expect(org.subscriptionStatus).toBe("paid");
    expect(org.planId).toBe(paidPlanId);
    const dias = (org.subscriptionExpiresAt!.getTime() - antes) / DAY_MS;
    expect(dias).toBeGreaterThan(364.9);
    expect(dias).toBeLessThan(365.1);
    firstApprovedOrderId = orderId;
  });

  test("2.ª aprovação do mesmo pedido: 409 ORDER_NOT_PENDING", async () => {
    const res = await approve(firstApprovedOrderId);
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: "ORDER_NOT_PENDING",
      message: "Este pedido já foi decidido.",
    });
  });

  test("rejeitar com motivo: pedido rejected, reason guardado, tenant intacto", async () => {
    const orderId = await newPendingOrder();
    const antes = await currentOrg();
    const semMotivo = await reject(orderId, {});
    expect(semMotivo.status).toBe(422);
    expect(semMotivo.body.error?.code).toBe("VALIDATION_ERROR");

    const res = await reject(orderId, { reason: "Pagamento não confirmado." });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orderId, status: "rejected" });

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order).toMatchObject({
      status: "rejected",
      rejectReason: "Pagamento não confirmado.",
      decidedBy: providerUserId,
    });
    const depois = await currentOrg();
    expect(depois.subscriptionStatus).toBe(antes.subscriptionStatus);
    expect(depois.planId).toBe(antes.planId);
    expect(depois.subscriptionExpiresAt?.getTime()).toBe(antes.subscriptionExpiresAt?.getTime());
  });

  test("VERIFICAÇÃO DEV: após aprovar, ORG_ADMIN gera identificador sem bloqueio", async () => {
    const res = await api<any>("/identifiers/generate", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ categoryId: "PROP", origin: "digital" }),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.identifier).toBeTruthy();
  });

  test("auditoria: row subscription.approve no tenant com providerUserId no metadata", async () => {
    const [row] = await db.select().from(auditLogs)
      .where(eq(auditLogs.resourceId, firstApprovedOrderId)).limit(1);
    expect(row).toBeTruthy();
    expect(row.tenantId).toBe(tenantId);
    expect(row.userId).toBeNull();
    expect(row.action).toBe("subscription.approve");
    expect(JSON.parse(row.metadata!).providerUserId).toBe(providerUserId);
  });

  test("renovação: tenant já paid com expiresAt antigo recalcula da aprovação", async () => {
    await db.update(organizations).set({
      subscriptionStatus: "paid",
      planId: upgradePlanId,
      subscriptionExpiresAt: new Date("2020-01-01T00:00:00Z"),
    }).where(eq(organizations.id, tenantId));

    const orderId = await newPendingOrder();
    const antes = Date.now();
    const res = await approve(orderId);
    expect(res.status).toBe(200);

    const org = await currentOrg();
    expect(org.planId).toBe(paidPlanId);
    const dias = (org.subscriptionExpiresAt!.getTime() - antes) / DAY_MS;
    expect(dias).toBeGreaterThan(364.9);
    expect(dias).toBeLessThan(365.1);
  });
});

describe("suspensão e reativação de tenants (painel)", () => {
  function setOrg(fields: Record<string, unknown>) {
    // Tabela global: SEM withTenant.
    return db.update(organizations).set(fields).where(eq(organizations.id, tenantId));
  }

  async function currentOrg() {
    const [row] = await db.select().from(organizations).where(eq(organizations.id, tenantId)).limit(1);
    return row;
  }

  async function seedUploadToday() {
    await withTenant(tenantId, async (tx) => {
      const [sec] = await tx.insert(sectors).values({ tenantId, name: "Suspensao", code: "SUS" }).returning();
      const [ident] = await tx.insert(identifiers).values({
        tenantId, sectorId: sec.id, categoryId: "PROP", createdBy: adminUserId,
        identifier: `susp-${RUN_ID}`, sequence: 1,
      }).returning();
      await tx.insert(documents).values({ tenantId, identifierId: ident.id, uploadedBy: adminUserId });
    });
  }

  test("GET /provider/tenants: status derivado (lazy), planName e userCount", async () => {
    await db.delete(licenses).where(eq(licenses.tenantId, tenantId));
    await setOrg({
      planId: paidPlanId, subscriptionStatus: "paid",
      subscriptionExpiresAt: new Date(Date.now() - DAY_MS), // paid vencido => expired
    });
    const res = await api<any>("/provider/tenants", { token: providerToken });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const row = res.body.find((r: any) => r.id === tenantId);
    expect(row).toMatchObject({
      id: tenantId,
      name: TENANT_NAME,
      slug: SLUG,
      status: "expired",
      planName: `Pedidos pago ${RUN_ID}`,
    });
    expect(row.expiresAt).toBeTruthy();
    expect(row.userCount).toBeGreaterThanOrEqual(1);
  });

  test("suspender: status suspended, checkUploadLimit ativo (1/dia) e auditoria tenant.suspend", async () => {
    await setOrg({
      planId: paidPlanId, subscriptionStatus: "paid",
      subscriptionExpiresAt: new Date(Date.now() + DAY_MS),
    });
    await seedUploadToday();
    expect(await checkUploadLimit(tenantId, adminUserId)).toBeNull(); // ativo: sem limite

    const res = await api<any>(`/provider/tenants/${tenantId}/suspend`, {
      method: "POST", token: providerToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("suspended");

    expect((await currentOrg()).subscriptionStatus).toBe("suspended");
    expect(await checkUploadLimit(tenantId, adminUserId)).toMatchObject({ code: "UPLOAD_LIMIT_REACHED" });

    const [audit] = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "tenant.suspend")))
      .limit(1);
    expect(audit).toBeTruthy();
    expect(audit.userId).toBeNull();
    expect(JSON.parse(audit.metadata!).providerUserId).toBe(providerUserId);
  });

  test("reativar com expiresAt futuro: paid e auditoria tenant.reactivate", async () => {
    await setOrg({
      planId: paidPlanId, subscriptionStatus: "suspended",
      subscriptionExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    });
    const res = await api<any>(`/provider/tenants/${tenantId}/reactivate`, {
      method: "POST", token: providerToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    expect((await currentOrg()).subscriptionStatus).toBe("paid");

    const [audit] = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "tenant.reactivate")))
      .limit(1);
    expect(audit).toBeTruthy();
    expect(audit.userId).toBeNull();
    expect(JSON.parse(audit.metadata!).providerUserId).toBe(providerUserId);
  });

  test("reativar com expiresAt passado: expired", async () => {
    await setOrg({
      planId: paidPlanId, subscriptionStatus: "suspended",
      subscriptionExpiresAt: new Date(Date.now() - DAY_MS),
    });
    const res = await api<any>(`/provider/tenants/${tenantId}/reactivate`, {
      method: "POST", token: providerToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("expired");
    expect((await currentOrg()).subscriptionStatus).toBe("expired");
  });

  test("reativar tenant free: free", async () => {
    await setOrg({
      planId: freePlanId, subscriptionStatus: "suspended", subscriptionExpiresAt: null,
    });
    const res = await api<any>(`/provider/tenants/${tenantId}/reactivate`, {
      method: "POST", token: providerToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("free");
    expect((await currentOrg()).subscriptionStatus).toBe("free");
  });

  test("rotas exigem token de provedor (401 UNAUTHORIZED)", async () => {
    const noAuth = await api<any>(`/provider/tenants/${tenantId}/suspend`, { method: "POST" });
    expect(noAuth.status).toBe(401);
    expect(noAuth.body.error?.code).toBe("UNAUTHORIZED");
  });
});
