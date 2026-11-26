/**
 * A API a correr com um utilizador da BD sem BYPASSRLS (como deve estar em produção).
 * Os outros testes ligam como superutilizador, que ignora todas as policies: um handler
 * que se esqueça de withTenant passa neles e falha em silêncio em produção.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { join } from "node:path";
import postgres from "postgres";

const API_ROOT = join(import.meta.dir, "..", "..");
const TEST_PORT = process.env.RLS_APP_ROLE_PORT || "3111";
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = Date.now().toString(36);
const ROLE = "docid_rls_app_test";
const ROLE_PASSWORD = "rls-app-test-only";

const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
let serverProc: Subprocess | null = null;
let token = "";
let tenantId = "";

async function api<T>(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  return { status: res.status, body: (await res.json()) as T };
}

async function waitForApi(maxMs = 20000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      if ((await fetch(`${BASE}/`)).ok) return true;
    } catch { /* retry */ }
    await Bun.sleep(300);
  }
  return false;
}

beforeAll(async () => {
  await admin.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN
      CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
  const [{ db: dbName }] = await admin<{ db: string }[]>`SELECT current_database() AS db`;
  await admin.unsafe(`GRANT CONNECT ON DATABASE "${dbName}" TO ${ROLE}`);
  await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await admin.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
  await admin.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
  await admin.unsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${ROLE}`);

  const url = new URL(process.env.DATABASE_URL!);
  url.username = ROLE;
  url.password = ROLE_PASSWORD;

  serverProc = spawn({
    cmd: ["bun", "src/index.ts"],
    cwd: API_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      PORT: TEST_PORT,
      NODE_ENV: "test",
      ALLOW_PUBLIC_ONBOARDING: "true",
      REQUIRE_RLS_ROLE: "true",
    },
  });
  if (!(await waitForApi())) throw new Error("API não arrancou com o papel sem bypass em " + BASE);

  const email = `rls-app-${RUN_ID}@test.docid`;
  const created = await api<any>("/tenants", {
    method: "POST",
    body: JSON.stringify({
      name: `RLS App ${RUN_ID}`,
      adminEmail: email,
      adminPassword: "testpass123",
      identifierPrefix: "RLS",
      termsAccepted: true,
    }),
  });
  expect(created.status).toBe(200);
  tenantId = created.body.data.id;

  const login = await api<any>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "testpass123" }),
  });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  serverProc?.kill();
  await serverProc?.exited;
  if (tenantId) {
    // Superutilizador: apaga sem contexto de tenant. Ordem pelas FKs.
    for (const q of [
      `DELETE FROM audit_logs WHERE tenant_id = $1`,
      `DELETE FROM identifiers WHERE tenant_id = $1`,
      `DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)`,
      `DELETE FROM licenses WHERE tenant_id = $1`,
      `DELETE FROM users WHERE tenant_id = $1`,
      `DELETE FROM sectors WHERE tenant_id = $1`,
      `DELETE FROM roles WHERE tenant_id = $1`,
      `DELETE FROM organizations WHERE id = $1`,
    ]) {
      await admin.unsafe(q, [tenantId]).catch(() => {});
    }
  }
  await admin.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE}`);
  await admin.unsafe(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE}`);
  await admin.unsafe(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${ROLE}`);
  await admin.unsafe(`REVOKE ALL ON SCHEMA public FROM ${ROLE}`);
  const [{ db: dbName }] = await admin<{ db: string }[]>`SELECT current_database() AS db`;
  await admin.unsafe(`REVOKE ALL ON DATABASE "${dbName}" FROM ${ROLE}`);
  await admin.unsafe(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {});
  await admin.end();
});

describe("API com papel da BD sem BYPASSRLS", () => {
  test("PATCH /tenants/me grava e devolve a organização", async () => {
    const res = await api<any>("/tenants/me", {
      method: "PATCH",
      token,
      body: JSON.stringify({ name: `RLS App renomeada ${RUN_ID}` }),
    });
    expect(res.status).toBe(200);
    expect(res.body.data?.name).toBe(`RLS App renomeada ${RUN_ID}`);

    const me = await api<any>("/tenants/me", { token });
    expect(me.status).toBe(200);
    expect(me.body.data.name).toBe(`RLS App renomeada ${RUN_ID}`);
  });

  test("PATCH /tenants/me sem campos responde 400", async () => {
    const res = await api<any>("/tenants/me", { method: "PATCH", token, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });
});

describe("prefixo do identificador (API)", () => {
  test("onboarding recusa prefixo com hífen ou dígitos", async () => {
    for (const identifierPrefix of ["EMP-", "AB2"]) {
      const res = await api<any>("/tenants", {
        method: "POST",
        body: JSON.stringify({
          name: `Prefixo inválido ${RUN_ID}`,
          adminEmail: `bad-prefix-${identifierPrefix.length}-${RUN_ID}@test.docid`,
          adminPassword: "testpass123",
          identifierPrefix,
          termsAccepted: true,
        }),
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("INVALID_IDENTIFIER_PREFIX");
    }
  });

  test("PATCH normaliza minúsculas e recusa inválidos", async () => {
    const ok = await api<any>("/tenants/me", { method: "PATCH", token, body: JSON.stringify({ identifierPrefix: "rlsx" }) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.identifierPrefix).toBe("RLSX");

    const bad = await api<any>("/tenants/me", { method: "PATCH", token, body: JSON.stringify({ identifierPrefix: "RL-1" }) });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("INVALID_IDENTIFIER_PREFIX");
  });

  test("depois de emitir um identificador o prefixo fica bloqueado (o mesmo valor continua aceite)", async () => {
    const sector = await api<any>("/sectors", {
      method: "POST",
      token,
      body: JSON.stringify({ name: "Prefixo", code: `PFX${RUN_ID.slice(-4)}` }),
    });
    expect(sector.status).toBe(200);
    const gen = await api<any>("/identifiers/generate", {
      method: "POST",
      token,
      body: JSON.stringify({ categoryId: "MEM", sectorId: sector.body.data.id }),
    });
    expect(gen.status).toBe(200);
    expect(gen.body.data.identifier.startsWith("RLSX-MEM-")).toBe(true);

    const change = await api<any>("/tenants/me", { method: "PATCH", token, body: JSON.stringify({ identifierPrefix: "NOVO" }) });
    expect(change.status).toBe(409);
    expect(change.body.error.code).toBe("PREFIX_LOCKED");

    const same = await api<any>("/tenants/me", { method: "PATCH", token, body: JSON.stringify({ identifierPrefix: "RLSX" }) });
    expect(same.status).toBe(200);
  });
});
