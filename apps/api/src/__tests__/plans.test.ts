/**
 * Planos: endpoint público + CRUD do painel.
 * TABELA GLOBAL — todas as queries usam `db` directamente, SEM withTenant:
 * valida que plans não está presa a RLS por tenant.
 * Self-contained: arranca a API numa porta própria e mata-a no fim.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { join } from "node:path";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { plans, providerUsers } from "../db/schema";
import { hashPassword } from "../lib/password";

const API_ROOT = join(import.meta.dir, "..", "..");
const TEST_PORT = process.env.PLANS_TEST_PORT || "3109";
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = Date.now().toString(36);
const EMAIL = `provider-plans-${RUN_ID}@test.docid`;
const PASSWORD = "testpass123";

let serverProc: Subprocess | null = null;
let providerToken = "";
let freePlanId = "";
const createdPlanIds: string[] = [];

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

const paidBody = {
  name: `Pago ${RUN_ID}`,
  price: 250000,
  maxUsers: 10,
  monthlyOnlineIdentifiers: 500,
  offlineBudgetPerMachine: 1000,
};

beforeAll(async () => {
  // Global table, sem withTenant (Review Focus 1)
  const [free] = await db.select().from(plans).where(eq(plans.isFree, true)).limit(1);
  expect(free).toBeTruthy();
  freePlanId = free.id;

  await db.insert(providerUsers).values({
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    name: "Provider Planos",
  });
  serverProc = spawn({
    cmd: ["bun", "src/index.ts"],
    cwd: API_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PORT: TEST_PORT, NODE_ENV: "test" },
  });
  if (!(await waitForApi())) throw new Error("API não está disponível em " + BASE);
  const login = await api<{ token: string }>("/provider/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(login.status).toBe(200);
  providerToken = login.body.token;
}, 45000);

afterAll(async () => {
  serverProc?.kill(9);
  for (const id of createdPlanIds) {
    await db.delete(plans).where(eq(plans.id, id));
  }
  await db.delete(providerUsers).where(eq(providerUsers.email, EMAIL));
});

describe("planos", () => {
  test("GET /plans sem auth inclui o free com os valores do spec", async () => {
    const res = await api<{ plans: AnyBody[] }>("/plans");
    expect(res.status).toBe(200);
    const free = res.body.plans.find((p) => p.name === "Free");
    expect(free).toBeDefined();
    expect(free).toMatchObject({
      price: 0, maxUsers: 1, monthlyOnlineIdentifiers: 10, offlineBudgetPerMachine: 10,
    });
    // Endpoint público não expõe campos de gestão
    expect(free).not.toHaveProperty("isFree");
    expect(free).not.toHaveProperty("active");
  });

  test("POST /provider/plans cria e GET /provider/plans mostra o plano", async () => {
    const created = await api<AnyBody>("/provider/plans", {
      method: "POST",
      token: providerToken,
      body: JSON.stringify(paidBody),
    });
    expect(created.status).toBe(200);
    expect(created.body.name).toBe(paidBody.name);
    expect(created.body.price).toBe(paidBody.price);
    createdPlanIds.push(created.body.id);

    const list = await api<{ plans: AnyBody[] }>("/provider/plans", { token: providerToken });
    expect(list.status).toBe(200);
    const row = list.body.plans.find((p) => p.id === created.body.id);
    expect(row).toMatchObject({ ...paidBody, isFree: false, active: true });
  });

  test("PUT /provider/plans/:id do free responde 403 FREE_PLAN_IMMUTABLE", async () => {
    const edited = await api<AnyBody>(`/provider/plans/${freePlanId}`, {
      method: "PUT",
      token: providerToken,
      body: JSON.stringify({ ...paidBody, name: "Free editado" }),
    });
    expect(edited.status).toBe(403);
    expect(edited.body.error?.code).toBe("FREE_PLAN_IMMUTABLE");

    // tentativa de desactivar o free também é recusada
    const deactivate = await api<AnyBody>(`/provider/plans/${freePlanId}`, {
      method: "PUT",
      token: providerToken,
      body: JSON.stringify({ ...paidBody, name: "Free", active: false }),
    });
    expect(deactivate.status).toBe(403);
    expect(deactivate.body.error?.code).toBe("FREE_PLAN_IMMUTABLE");

    const [free] = await db.select().from(plans).where(eq(plans.id, freePlanId));
    expect(free).toMatchObject({ name: "Free", price: 0, isFree: true, active: true });
  });

  test("PUT num plano pago altera preço/limites e é reflectido", async () => {
    const created = await api<AnyBody>("/provider/plans", {
      method: "POST",
      token: providerToken,
      body: JSON.stringify(paidBody),
    });
    expect(created.status).toBe(200);
    createdPlanIds.push(created.body.id);

    const changed = {
      name: `Pago editado ${RUN_ID}`,
      price: 999000,
      maxUsers: 25,
      monthlyOnlineIdentifiers: 750,
      offlineBudgetPerMachine: 2000,
    };
    const updated = await api<AnyBody>(`/provider/plans/${created.body.id}`, {
      method: "PUT",
      token: providerToken,
      body: JSON.stringify(changed),
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject(changed);

    const list = await api<{ plans: AnyBody[] }>("/provider/plans", { token: providerToken });
    expect(list.body.plans.find((p) => p.id === created.body.id)).toMatchObject(changed);
    const pub = await api<{ plans: AnyBody[] }>("/plans");
    expect(pub.body.plans.find((p) => p.id === created.body.id)).toMatchObject({
      price: changed.price, maxUsers: changed.maxUsers,
      monthlyOnlineIdentifiers: changed.monthlyOnlineIdentifiers,
      offlineBudgetPerMachine: changed.offlineBudgetPerMachine,
    });
  });

  test("GET /plans não lista planos inactive", async () => {
    const created = await api<AnyBody>("/provider/plans", {
      method: "POST",
      token: providerToken,
      body: JSON.stringify({ ...paidBody, name: `Inactivo ${RUN_ID}` }),
    });
    expect(created.status).toBe(200);
    createdPlanIds.push(created.body.id);

    const updated = await api<AnyBody>(`/provider/plans/${created.body.id}`, {
      method: "PUT",
      token: providerToken,
      body: JSON.stringify({ ...paidBody, name: `Inactivo ${RUN_ID}`, active: false }),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.active).toBe(false);

    const pub = await api<{ plans: AnyBody[] }>("/plans");
    expect(pub.body.plans.find((p) => p.id === created.body.id)).toBeUndefined();

    const list = await api<{ plans: AnyBody[] }>("/provider/plans", { token: providerToken });
    expect(list.body.plans.find((p) => p.id === created.body.id)).toMatchObject({ active: false });
  });
});
