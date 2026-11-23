/**
 * Pedidos de subscrição: token de checkout single-use, fallback e notificação.
 * Self-contained: arranca a API numa porta própria e mata-a no fim.
 * TABELAS GLOBAIS — orders/plans/organizations sem withTenant nas queries directas.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { decodeJwt, SignJWT } from "jose";

import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { orders, organizations, plans, roles, sectors, userRoles, users } from "../db/schema";

const API_ROOT = join(import.meta.dir, "..", "..");
const TEST_PORT = process.env.ORDERS_TEST_PORT || "3110";
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = Date.now().toString(36);
const SLUG = `orders-tenant-${RUN_ID}`;
const ADMIN_EMAIL = `orders-admin-${RUN_ID}@test.docid`;
const TENANT_NAME = `Pedidos Org ${RUN_ID}`;
const PASSWORD = "testpass123";

let serverProc: Subprocess | null = null;
let adminToken = "";
let tenantId = "";
let paidPlanId = "";
let freePlanId = "";
let inactivePlanId = "";

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

function orderBody(planId = paidPlanId): AnyBody {
  return {
    planId,
    paymentMethod: "multicaixa",
    phone: "912345678",
    contactEmail: `contacto-${RUN_ID}@test.docid`,
  };
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

  const [inactive] = await db.insert(plans).values({
    name: `Pedidos inactivo ${RUN_ID}`,
    price: 250000,
    maxUsers: 10,
    monthlyOnlineIdentifiers: 500,
    offlineBudgetPerMachine: 1000,
    active: false,
  }).returning();
  inactivePlanId = inactive.id;

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

  const login = await api<any>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }),
  });
  expect(login.status).toBe(200);
  adminToken = login.body.data.token;
  expect(login.body.data.user.roles).toContain("ORG_ADMIN");
}, 45000);

afterAll(async () => {
  serverProc?.kill(9);
  if (tenantId) {
    // Tabela global: SEM withTenant.
    await db.delete(orders).where(eq(orders.tenantId, tenantId));
    await withTenant(tenantId, async (tx) => {
      await tx.delete(userRoles).where(
        sql`${userRoles.userId} IN (SELECT ${users.id} FROM ${users} WHERE ${users.tenantId} = ${tenantId})`,
      );
      await tx.delete(users).where(eq(users.tenantId, tenantId));
      await tx.delete(roles).where(eq(roles.tenantId, tenantId));
      await tx.delete(sectors).where(eq(sectors.tenantId, tenantId));
      await tx.delete(organizations).where(eq(organizations.id, tenantId));
    });
  }
  if (paidPlanId) await db.delete(plans).where(eq(plans.id, paidPlanId));
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

  test("sem SMTP, createOrder não lança e devolve log", async () => {
    // Import dinâmico: o serviço é testável sem HTTP.
    const { createOrder } = await import("../services/order.service");
    const result = await createOrder({ ...orderBody(), tenantSlug: SLUG } as any);
    expect(result.status).toBe("pending");
    expect(result.orderId).toBeTruthy();

    const [row] = await db.select().from(orders).where(eq(orders.id, result.orderId));
    expect(row.tenantId).toBe(tenantId);
  });
});
