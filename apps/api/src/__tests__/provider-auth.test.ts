/**
 * Auth própria do painel: login de provider_users e guard com escopo provider.
 * Self-contained: arranca a API numa porta própria e mata-a no fim.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";

import { db } from "../db";
import { providerUsers } from "../db/schema";
import { hashPassword } from "../lib/password";
import { signToken } from "../middleware/auth";

const API_ROOT = join(import.meta.dir, "..", "..");
const TEST_PORT = process.env.PROVIDER_AUTH_PORT || "3108";
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = Date.now().toString(36);
const EMAIL = `provider-${RUN_ID}@test.docid`;
const PASSWORD = "testpass123";

let serverProc: Subprocess | null = null;
let providerToken = "";
let desktopToken = "";

async function api<T>(
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

beforeAll(async () => {
  await db.insert(providerUsers).values({
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    name: "Provider Teste",
  });
  serverProc = spawn({
    cmd: ["bun", "src/index.ts"],
    cwd: API_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PORT: TEST_PORT, NODE_ENV: "test" },
  });
  if (!(await waitForApi())) throw new Error("API não está disponível em " + BASE);
  desktopToken = await signToken({
    userId: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    sectorId: null,
    roles: ["MEMBER"],
  });
}, 45000);

afterAll(async () => {
  serverProc?.kill(9);
  await db.delete(providerUsers).where(eq(providerUsers.email, EMAIL));
});

describe("auth do painel", () => {
  test("POST /provider/login com credenciais válidas devolve token", async () => {
    const res = await api<any>("/provider/login", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    const claims = decodeJwt(res.body.token);
    expect(claims.scope).toBe("provider");
    expect(claims.aud).toBe("docid-provider");
    expect(claims.exp! - claims.iat!).toBe(8 * 60 * 60);
    providerToken = res.body.token;
  });

  test("POST /provider/login com password errada responde 401 PROVIDER_INVALID_CREDENTIALS", async () => {
    const res = await api<any>("/provider/login", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, password: "wrongpassword" }),
    });
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("PROVIDER_INVALID_CREDENTIALS");
  });

  test("GET /provider/orders sem token responde 401", async () => {
    const res = await api<any>("/provider/orders");
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("UNAUTHORIZED");
  });

  test("GET /provider/orders com JWT desktop responde 401", async () => {
    const res = await api<any>("/provider/orders", { token: desktopToken });
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("UNAUTHORIZED");
  });

  test("GET /provider/orders com token provider responde 200", async () => {
    const res = await api<any>("/provider/orders", { token: providerToken });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
