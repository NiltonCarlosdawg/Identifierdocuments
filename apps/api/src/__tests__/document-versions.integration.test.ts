/**
 * Testes de integração — anexos múltiplos + versionamento de documentos
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { join } from "node:path";

const API_ROOT = join(import.meta.dir, "..", "..");
const BASE = process.env.API_TEST_URL || "http://localhost:3000";
const RUN_ID = Date.now().toString(36);

let serverProc: Subprocess | null = null;
let adminToken = "";
let identifier = "";
let documentId = "";

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
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
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

  const email = `ver-admin-${RUN_ID}@test.docid`;
  await api<any>("/tenants", {
    method: "POST",
    body: JSON.stringify({
      name: `Version Org ${RUN_ID}`,
      adminEmail: email,
      adminPassword: "testpass123",
      identifierPrefix: "VER",
    }),
  });
  const login = await api<any>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "testpass123" }),
  });
  adminToken = login.body.data.token;

  const gen = await api<any>("/identifiers/generate", {
    method: "POST",
    token: adminToken,
    body: JSON.stringify({ categoryId: "PROP", origin: "digital" }),
  });
  identifier = gen.body.data.identifier;
}, 60000);

afterAll(() => {
  serverProc?.kill();
});

describe("Anexos e versionamento", () => {
  test("attach primary cria v1", async () => {
    const content = `Documento principal\nID: ${identifier}\n`;
    const file = new File([content], "primary.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("identifier", identifier);
    form.append("file", file);

    const res = await fetch(`${BASE}/documents/attach`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.document.kind).toBe("primary");
    expect(body.document.currentVersion).toBe(1);
    documentId = body.document.id;
  });

  test("segundo primary é rejeitado", async () => {
    const content = `Outro principal\nID: ${identifier}\n`;
    const file = new File([content], "primary2.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("identifier", identifier);
    form.append("file", file);

    const res = await fetch(`${BASE}/documents/attach`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe("ATTACH_ERROR");
  });

  test("attachment OK sem verificação de identificador", async () => {
    const file = new File(["anexo suplementar sem id"], "anexo.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("identifier", identifier);
    form.append("file", file);
    form.append("label", "Comprovativo");

    const res = await fetch(`${BASE}/documents/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.document.kind).toBe("attachment");
    expect(body.document.label).toBe("Comprovativo");
  });

  test("nova versão incrementa e só uma current", async () => {
    const content = `Versão 2\nID: ${identifier}\n`;
    const file = new File([content], "primary-v2.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("file", file);

    const res = await fetch(`${BASE}/documents/${documentId}/versions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.version.version).toBe(2);
    expect(body.version.isCurrent).toBe(true);

    const meta = await api<any>(`/documents/${documentId}`, { token: adminToken });
    expect(meta.status).toBe(200);
    const versions = meta.body.data.versions;
    expect(versions.length).toBe(2);
    expect(versions.filter((v: any) => v.isCurrent).length).toBe(1);
    expect(versions.find((v: any) => v.version === 2)?.isCurrent).toBe(true);
    expect(meta.body.data.attachments?.length).toBeGreaterThanOrEqual(1);
  });

  test("download v1 após v2 ainda funciona", async () => {
    const res = await fetch(`${BASE}/documents/${documentId}/versions/1/download`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Documento principal");

    const current = await fetch(`${BASE}/documents/${documentId}/download`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(current.status).toBe(200);
    const currentText = await current.text();
    expect(currentText).toContain("Versão 2");
  });
});
