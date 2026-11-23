/**
 * Wiring do limite de utilizadores nos endpoints de criação.
 * Self-contained: arranca a API numa porta própria e mata-a no fim.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";

import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { organizations, roles, rolePermissions, sectors, users, userRoles } from "../db/schema";

const API_ROOT = join(import.meta.dir, "..", "..");
const TEST_PORT = process.env.SUBSCRIPTION_WIRING_PORT || "3104";
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = Date.now().toString(36);

let serverProc: Subprocess | null = null;
let adminToken = "";
let tenantId = "";
let adminUserId = "";

async function api<T>(
  path: string,
  opts: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body && !(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await res.json() : await res.text();
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

beforeAll(async () => {
  serverProc = spawn({
    cmd: ["bun", "src/index.ts"],
    cwd: API_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PORT: TEST_PORT, NODE_ENV: "test", ALLOW_PUBLIC_ONBOARDING: "true" },
  });
  if (!(await waitForApi())) throw new Error("API não está disponível em " + BASE);

  const email = `wiring-admin-${RUN_ID}@test.docid`;
  const created = await api<any>("/tenants", {
    method: "POST",
    body: JSON.stringify({
      name: `Wiring Org ${RUN_ID}`,
      adminEmail: email,
      adminPassword: "testpass123",
      identifierPrefix: "WIR",
      termsAccepted: true,
    }),
  });
  expect(created.status).toBe(200);
  tenantId = created.body.data.id;
  adminUserId = created.body.data.admin.id;

  const login = await api<any>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "testpass123" }),
  });
  expect(login.status).toBe(200);
  adminToken = login.body.data.token;
  expect(login.body.data.user.roles).toContain("ORG_ADMIN");

  // O handler de invite procura o role no tenant (os roles de sistema têm tenantId null).
  const memberRole = await api<any>("/roles", {
    method: "POST",
    token: adminToken,
    body: JSON.stringify({ name: "MEMBER" }),
  });
  expect(memberRole.status).toBe(200);
}, 45000);

afterAll(async () => {
  serverProc?.kill(9);
  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(userRoles).where(
        sql`${userRoles.userId} IN (SELECT ${users.id} FROM ${users} WHERE ${users.tenantId} = ${tenantId})`,
      );
      await tx.delete(users).where(eq(users.tenantId, tenantId));
      await tx.delete(rolePermissions).where(
        sql`${rolePermissions.roleId} IN (SELECT ${roles.id} FROM ${roles} WHERE ${roles.tenantId} = ${tenantId})`,
      );
      await tx.delete(roles).where(eq(roles.tenantId, tenantId));
      await tx.delete(sectors).where(eq(sectors.tenantId, tenantId));
      await tx.delete(organizations).where(eq(organizations.id, tenantId));
    });
  }
});

describe("limite de utilizadores no wiring dos endpoints", () => {
  test("tenant free no limite (1/1): invite responde 403 e não apaga utilizadores", async () => {
    const before = await api<any>("/users/", { token: adminToken });
    expect(before.status).toBe(200);
    expect(before.body.data.length).toBe(1); // admin do tenant — free tem maxUsers=1

    const invite = await api<any>("/users/invite", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        email: `wiring-invite-${RUN_ID}@test.docid`,
        fullName: "Convidado",
        sectorId: before.body.data[0].sectorId,
        role: "MEMBER",
      }),
    });

    expect(invite.status).toBe(403);
    expect(invite.body.error?.code).toBe("SUBSCRIPTION_USER_LIMIT");
    expect(invite.body.error?.message).toBe(
      "O limite de utilizadores do seu plano foi atingido. Faça upgrade para convidar mais.",
    );

    const after = await api<any>("/users/", { token: adminToken });
    expect(after.status).toBe(200);
    expect(after.body.data.length).toBe(1); // nada foi apagado
    expect(after.body.data[0].id).toBe(before.body.data[0].id);
  });
});
