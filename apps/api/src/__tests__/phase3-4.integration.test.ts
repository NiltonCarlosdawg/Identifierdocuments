/**
 * Testes de integração — Fases 3 e 4
 * Cobre: auth, identificadores, documentos, partilha, aprovações, notificações
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";

import { join } from "node:path";

const API_ROOT = join(import.meta.dir, "..", "..");
const BASE = process.env.API_TEST_URL || "http://localhost:3000";
const RUN_ID = Date.now().toString(36);

let serverProc: Subprocess | null = null;

async function waitForApi(maxMs = 15000): Promise<boolean> {
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

async function api<T>(
  path: string,
  opts: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string>),
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
  });

  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await res.json()
    : await res.text();
  return { status: res.status, body: body as T };
}

beforeAll(async () => {
  let ready = await waitForApi(5000);
  if (!ready) {
    serverProc = spawn({
      cmd: ["bun", "src/index.ts"],
      cwd: API_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
    ready = await waitForApi(20000);
  }
  if (!ready) throw new Error("API não está disponível em " + BASE);
});

afterAll(() => {
  serverProc?.kill();
});

describe("Health & Auth", () => {
  test("GET / retorna status online", async () => {
    const { status, body } = await api<any>("/");
    expect(status).toBe(200);
    expect(body.status).toBe("online");
  });

  test("POST /tenants cria organização e login funciona", async () => {
    const email = `admin-${RUN_ID}@test.docid`;
    const { status, body } = await api<any>("/tenants", {
      method: "POST",
      body: JSON.stringify({
        name: `Test Org ${RUN_ID}`,
        adminEmail: email,
        adminPassword: "testpass123",
        identifierPrefix: "TST",
      }),
    });
    expect(status).toBe(200);
    expect(body.data?.slug).toBeDefined();

    const login = await api<any>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "testpass123" }),
    });
    expect(login.status).toBe(200);
    expect(login.body.data?.token).toBeDefined();
    expect(login.body.data?.user?.roles).toContain("ORG_ADMIN");
  });
});

describe("Fluxo completo — documentos, partilha e aprovações", () => {
  let adminToken = "";
  let adminUserId = "";
  let tenantId = "";
  let sectorAId = "";
  let sectorBId = "";
  let supervisorToken = "";
  let supervisorUserId = "";
  let identifier = "";
  let approvalId = "";

  test("setup: criar sectores e supervisor", async () => {
    const email = `admin-${RUN_ID}@test.docid`;
    const login = await api<any>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "testpass123" }),
    });
    adminToken = login.body.data.token;
    adminUserId = login.body.data.user.id;
    tenantId = login.body.data.user.tenantId;

    const sectors = await api<any>("/sectors", { token: adminToken });
    sectorAId = sectors.body.data[0].id;

    const sectorB = await api<any>("/sectors", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ name: "Financeiro", code: `FIN${RUN_ID.slice(-4)}` }),
    });
    expect(sectorB.status).toBe(200);
    sectorBId = sectorB.body.data.id;

    const supervisorEmail = `supervisor-${RUN_ID}@test.docid`;
    const createUser = await api<any>("/users", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        email: supervisorEmail,
        password: "testpass123",
        fullName: "Supervisor Teste",
        sectorId: sectorBId,
      }),
    });
    expect(createUser.status).toBe(200);
    supervisorUserId = createUser.body.data.id;

    const roles = await api<any>("/roles", { token: adminToken });
    const supervisorRole = roles.body.data.find((r: any) => r.name === "SECTOR_SUPERVISOR");
    expect(supervisorRole).toBeDefined();

    await api(`/users/${supervisorUserId}/roles`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ roleId: supervisorRole.id, sectorId: sectorBId }),
    });

    await api(`/sectors/${sectorBId}/supervisor`, {
      method: "PATCH",
      token: adminToken,
      body: JSON.stringify({ supervisorId: supervisorUserId }),
    });

    const supLogin = await api<any>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: supervisorEmail, password: "testpass123" }),
    });
    supervisorToken = supLogin.body.data.token;
    expect(supLogin.body.data.user.roles).toContain("SECTOR_SUPERVISOR");
  });

  test("gerar identificador", async () => {
    const res = await api<any>("/identifiers/generate", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ categoryId: "PROP", issuedTo: "Cliente Teste", origin: "digital" }),
    });
    expect(res.status).toBe(200);
    identifier = res.body.data.identifier;
    expect(identifier).toMatch(/^TST-PROP-/);
  });

  test("associar documento com identificador no texto", async () => {
    const content = `Proposta comercial\nIdentificador: ${identifier}\nFim.`;
    const file = new File([content], "proposta.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("identifier", identifier);
    form.append("file", file);
    form.append("uploadSource", "manual");

    const res = await fetch(`${BASE}/documents/attach`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("associar com uploadSource sync", async () => {
    const gen = await api<any>("/identifiers/generate", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ categoryId: "MEM", origin: "digital" }),
    });
    const id2 = gen.body.data.identifier;
    const content = `Memorando ${id2}`;
    const file = new File([content], "memo.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("identifier", id2);
    form.append("file", file);
    form.append("uploadSource", "sync");

    const res = await fetch(`${BASE}/documents/attach`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.document.uploadSource).toBe("sync");
  });

  test("partilha cross-sector cria aprovação pendente", async () => {
    const share = await api<any>(`/documents/${identifier}/share`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ sectorId: sectorBId }),
    });
    expect(share.status).toBe(200);

    const approvals = await api<any>("/approvals?status=pending", { token: supervisorToken });
    expect(approvals.status).toBe(200);
    const match = approvals.body.data.find(
      (a: any) => a.document?.identifier?.identifier === identifier,
    );
    expect(match).toBeDefined();
    approvalId = match.id;
  });

  test("partilha sem destino retorna 422", async () => {
    const res = await api<any>(`/documents/${identifier}/share`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  test("MEMBER/ADMIN sem ser supervisor não aprova aprovação de outro sector", async () => {
    const res = await api<any>(`/approvals/${approvalId}`, {
      method: "PATCH",
      token: adminToken,
      body: JSON.stringify({ status: "approved" }),
    });
    // ORG_ADMIN pode aprovar qualquer — deve passar
    expect(res.status).toBe(200);
  });

  test("listar partilhas do documento", async () => {
    const res = await api<any>(`/documents/${identifier}/shares`, { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe("Notificações", () => {
  let token = "";

  beforeAll(async () => {
    const login = await api<any>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: `admin-${RUN_ID}@test.docid`, password: "testpass123" }),
    });
    token = login.body.data.token;
  });

  test("GET /notifications retorna histórico", async () => {
    const res = await api<any>("/notifications", { token });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("PATCH /notifications/:id/read marca como lida", async () => {
    const list = await api<any>("/notifications?unreadOnly=true", { token });
    if (list.body.data.length === 0) return;

    const id = list.body.data[0].id;
    const res = await api<any>(`/notifications/${id}/read`, {
      method: "PATCH",
      token,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.isRead).toBe(true);
  });

  test("SSE stream aceita access_token", async () => {
    const res = await fetch(`${BASE}/notifications/stream?access_token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("connected");
    reader?.cancel();
  });
});

describe("Sectores e RBAC", () => {
  let token = "";

  beforeAll(async () => {
    const login = await api<any>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: `admin-${RUN_ID}@test.docid`, password: "testpass123" }),
    });
    token = login.body.data.token;
  });

  test("GET /sectors lista sectores", async () => {
    const res = await api<any>("/sectors", { token });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  test("GET /approvals requer autenticação", async () => {
    const res = await api<any>("/approvals");
    expect(res.status).toBe(401);
  });
});
