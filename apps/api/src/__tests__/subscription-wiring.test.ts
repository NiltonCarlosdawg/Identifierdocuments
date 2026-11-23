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
import { auditLogs, documents, documentVersions, identifiers, organizations, plans, roles, rolePermissions, sectors, users, userRoles , licenses } from "../db/schema";

const API_ROOT = join(import.meta.dir, "..", "..");
const TEST_PORT = process.env.SUBSCRIPTION_WIRING_PORT || "3104";
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = Date.now().toString(36);

let serverProc: Subprocess | null = null;
let adminToken = "";
let tenantId = "";
let adminUserId = "";
let importPlanId = "";
let memberRoleId = "";
let quotaPlanId = "";
let uploadPlanId = "";
let statusPlanId = "";
let registeredTenantId = "";

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
  await db.delete(licenses).where(eq(licenses.tenantId, tenantId));
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
  memberRoleId = memberRole.body.data.id;
}, 45000);

async function cleanupTenant(id: string) {
  await withTenant(id, async (tx) => {
    await tx.delete(documentVersions).where(eq(documentVersions.tenantId, id));
    await tx.delete(documents).where(eq(documents.tenantId, id));
    await tx.delete(auditLogs).where(eq(auditLogs.tenantId, id));
    await tx.delete(identifiers).where(eq(identifiers.tenantId, id));
    await tx.delete(userRoles).where(
      sql`${userRoles.userId} IN (SELECT ${users.id} FROM ${users} WHERE ${users.tenantId} = ${id})`,
    );
    await tx.delete(users).where(eq(users.tenantId, id));
    await tx.delete(rolePermissions).where(
      sql`${rolePermissions.roleId} IN (SELECT ${roles.id} FROM ${roles} WHERE ${roles.tenantId} = ${id})`,
    );
    await tx.delete(roles).where(eq(roles.tenantId, id));
    await tx.delete(sectors).where(eq(sectors.tenantId, id));
    await tx.delete(organizations).where(eq(organizations.id, id));
  });
}

afterAll(async () => {
  serverProc?.kill(9);
  if (tenantId) await cleanupTenant(tenantId);
  if (registeredTenantId) await cleanupTenant(registeredTenantId);
  if (importPlanId) await db.delete(plans).where(eq(plans.id, importPlanId));
  if (quotaPlanId) await db.delete(plans).where(eq(plans.id, quotaPlanId));
  if (uploadPlanId) await db.delete(plans).where(eq(plans.id, uploadPlanId));
  if (statusPlanId) await db.delete(plans).where(eq(plans.id, statusPlanId));
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

  test("import CSV com headroom insuficiente: excesso responde 403 e deixa exatamente maxUsers", async () => {
    // Plano só deste teste: maxUsers=3 → admin + 2 linhas importadas cabem, a 3.ª não.
    const [plan] = await db.insert(plans).values({
      name: `wiring-import-${RUN_ID}`,
      price: 100000,
      maxUsers: 3,
      monthlyOnlineIdentifiers: 100,
      offlineBudgetPerMachine: 100,
    }).returning();
    importPlanId = plan.id;
    await db.update(organizations).set({ planId: plan.id }).where(eq(organizations.id, tenantId));

    const csv = [
      "email,full_name",
      ...[1, 2, 3, 4].map(i => `import-${i}-${RUN_ID}@test.docid,Importado ${i}`),
    ].join("\n");

    const res = await api<any>("/users/import", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ csv }),
    });

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("SUBSCRIPTION_USER_LIMIT");
    expect(res.body.error?.message).toBe(
      "O limite de utilizadores do seu plano foi atingido. Faça upgrade para convidar mais.",
    );

    const list = await api<any>("/users/", { token: adminToken });
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(3); // admin + 2 importados — exatamente maxUsers
    expect(list.body.data.map((u: any) => u.email).sort()).toEqual([
      `wiring-admin-${RUN_ID}@test.docid`,
      `import-1-${RUN_ID}@test.docid`,
      `import-2-${RUN_ID}@test.docid`,
    ].sort());
  });
});

describe("estado da subscrição ao adicionar utilizadores", () => {
  let sectorId = "";

  beforeAll(async () => {
    const [plan] = await db.insert(plans).values({
      name: `wiring-status-${RUN_ID}`,
      price: 100000,
      maxUsers: 10,
      monthlyOnlineIdentifiers: 100,
      offlineBudgetPerMachine: 100,
    }).returning();
    statusPlanId = plan.id;
    await db.update(organizations).set({
      planId: plan.id,
      subscriptionStatus: "paid",
      subscriptionExpiresAt: null,
    }).where(eq(organizations.id, tenantId));
    const list = await api<any>("/sectors", { token: adminToken });
    sectorId = list.body.data[0].id;
  });

  function invite(suffix: string) {
    return api<any>("/users/invite", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({
        email: `wiring-${suffix}-${RUN_ID}@test.docid`,
        fullName: "Convidado",
        sectorId,
        role: "MEMBER",
      }),
    });
  }

  test("paid ativo com headroom: invite permitido", async () => {
    const res = await invite("status-active");
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBeDefined();
  });

  test("expirado com headroom: invite 403 SUBSCRIPTION_RESTRICTED", async () => {
    await db.update(organizations).set({ subscriptionStatus: "expired" })
      .where(eq(organizations.id, tenantId));
    const res = await invite("status-expired");
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("SUBSCRIPTION_RESTRICTED");
    expect(res.body.error?.message).toBe("Subscrição expirada. Contacte o administrador.");
  });

  test("suspenso com headroom: invite 403 SUBSCRIPTION_RESTRICTED", async () => {
    await db.update(organizations).set({ subscriptionStatus: "suspended" })
      .where(eq(organizations.id, tenantId));
    const res = await invite("status-suspended");
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("SUBSCRIPTION_RESTRICTED");
    expect(res.body.error?.message).toBe("Subscrição expirada. Contacte o administrador.");
  });
});

describe("quota mensal de identificadores no wiring", () => {
  let memberToken = "";
  let memberUserId = "";
  let sectorId = "";

  beforeAll(async () => {
    const [plan] = await db.insert(plans).values({
      name: `wiring-quota-${RUN_ID}`,
      price: 100000,
      maxUsers: 10,
      monthlyOnlineIdentifiers: 2,
      offlineBudgetPerMachine: 100,
    }).returning();
    quotaPlanId = plan.id;
    await db.update(organizations).set({
      planId: plan.id,
      subscriptionStatus: "paid",
      subscriptionExpiresAt: null,
    }).where(eq(organizations.id, tenantId));

    const list = await api<any>("/sectors", { token: adminToken });
    sectorId = list.body.data[0].id;

    const email = `wiring-member-${RUN_ID}@test.docid`;
    const created = await api<any>("/users", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ email, password: "testpass123", fullName: "Membro", sectorId }),
    });
    expect(created.status).toBe(200);
    memberUserId = created.body.data.id;

    const assigned = await api<any>(`/users/${memberUserId}/roles`, {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ roleId: memberRoleId, sectorId }),
    });
    expect(assigned.status).toBe(200);

    const login = await api<any>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "testpass123" }),
    });
    expect(login.status).toBe(200);
    memberToken = login.body.data.token;
    expect(login.body.data.user.roles).toContain("MEMBER");
  });

  function generate(token: string) {
    return api<any>("/identifiers/generate", {
      method: "POST",
      token,
      body: JSON.stringify({ categoryId: "PROP", origin: "digital" }),
    });
  }

  test("tenant ativo no teto (2/2): 403 IDENTIFIER_QUOTA_EXCEEDED", async () => {
    expect((await generate(adminToken)).status).toBe(200);
    expect((await generate(adminToken)).status).toBe(200);
    const res = await generate(adminToken);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("IDENTIFIER_QUOTA_EXCEEDED");
    expect(res.body.error?.message).toBe(
      "O limite mensal de identificadores do seu plano foi atingido. Faça upgrade para continuar.",
    );
  });

  test("tenant suspenso, MEMBER: 403 SUBSCRIPTION_RESTRICTED", async () => {
    await db.update(organizations).set({ subscriptionStatus: "suspended" })
      .where(eq(organizations.id, tenantId));
    const res = await generate(memberToken);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("SUBSCRIPTION_RESTRICTED");
    expect(res.body.error?.message).toBe("Subscrição expirada. Contacte o administrador.");
  });

  test("tenant suspenso, ORG_ADMIN: quota aplica-se; com headroom gera", async () => {
    const atCap = await generate(adminToken);
    expect(atCap.status).toBe(403);
    expect(atCap.body.error?.code).toBe("IDENTIFIER_QUOTA_EXCEEDED");

    await db.update(plans).set({ monthlyOnlineIdentifiers: 3 }).where(eq(plans.id, quotaPlanId));
    const ok = await generate(adminToken);
    expect(ok.status).toBe(200);
    expect(ok.body.data.identifier).toBeDefined();
  });
});

describe("limite de 1 upload/dia na expiração", () => {
  let primaryIdentifier = "";
  let documentId = "";

  const EXPECTED_ERROR = {
    code: "UPLOAD_LIMIT_REACHED",
    message: "Subscrição expirada: limite de 1 upload por dia.",
  };

  async function newIdentifier(): Promise<string> {
    const gen = await api<any>("/identifiers/generate", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ categoryId: "PROP", origin: "digital" }),
    });
    expect(gen.status).toBe(200);
    return gen.body.data.identifier;
  }

  function docForm(identifier: string, source?: "manual" | "sync") {
    const form = new FormData();
    form.append("identifier", identifier);
    form.append("file", new File([`Contrato ${identifier}\n`], "contrato.txt", { type: "text/plain" }));
    if (source) form.append("uploadSource", source);
    return form;
  }

  function versionForm(identifier: string, source?: "manual" | "sync") {
    const form = new FormData();
    form.append("file", new File([`Nova versão ${identifier}\n`], "versao.txt", { type: "text/plain" }));
    if (source) form.append("uploadSource", source);
    return form;
  }

  async function post(path: string, form: FormData) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form,
    });
    return { status: res.status, body: await res.json() };
  }

  beforeAll(async () => {
    const [plan] = await db.insert(plans).values({
      name: `wiring-upload-${RUN_ID}`,
      price: 100000,
      maxUsers: 10,
      monthlyOnlineIdentifiers: 1000,
      offlineBudgetPerMachine: 100,
    }).returning();
    uploadPlanId = plan.id;
    await db.update(organizations).set({
      planId: plan.id,
      subscriptionStatus: "suspended",
      subscriptionExpiresAt: null,
    }).where(eq(organizations.id, tenantId));
  });

  test("suspenso: 1.º upload passa, 2.º manual é 403 nos 3 handlers; fila 'sync' continua", async () => {
    await db.update(organizations).set({ subscriptionStatus: "suspended" })
      .where(eq(organizations.id, tenantId));

    primaryIdentifier = await newIdentifier();
    const first = await post("/documents/attach", docForm(primaryIdentifier, "manual"));
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);
    documentId = first.body.document.id;

    const second = await post("/documents/attach", docForm(await newIdentifier(), "manual"));
    expect(second.status).toBe(403);
    expect(second.body.error).toEqual(EXPECTED_ERROR);

    const attachment = await post("/documents/attachments", docForm(primaryIdentifier, "manual"));
    expect(attachment.status).toBe(403);
    expect(attachment.body.error).toEqual(EXPECTED_ERROR);

    const version = await post(`/documents/${documentId}/versions`, versionForm(primaryIdentifier, "manual"));
    expect(version.status).toBe(403);
    expect(version.body.error).toEqual(EXPECTED_ERROR);

    const syncAttach = await post("/documents/attach", docForm(await newIdentifier(), "sync"));
    expect(syncAttach.status).toBe(200);
    expect(syncAttach.body.document.uploadSource).toBe("sync");

    const syncAttachment = await post("/documents/attachments", docForm(primaryIdentifier, "sync"));
    expect(syncAttachment.status).toBe(200);

    const syncVersion = await post(`/documents/${documentId}/versions`, versionForm(primaryIdentifier, "sync"));
    expect(syncVersion.status).toBe(200);
  });

  test("tenant paid ativo: uploads manuais ilimitados nos 3 handlers", async () => {
    await db.update(organizations).set({
      subscriptionStatus: "paid",
      subscriptionExpiresAt: null,
    }).where(eq(organizations.id, tenantId));

    expect((await post("/documents/attach", docForm(await newIdentifier(), "manual"))).status).toBe(200);
    expect((await post("/documents/attach", docForm(await newIdentifier(), "manual"))).status).toBe(200);
    expect((await post("/documents/attachments", docForm(primaryIdentifier, "manual"))).status).toBe(200);
    expect((await post(`/documents/${documentId}/versions`, versionForm(primaryIdentifier, "manual"))).status).toBe(200);
  });
});

describe("registo com plano free e estado de subscrição", () => {
  test("registo público cria tenant no plano free; /tenants/me devolve a subscrição", async () => {
    const email = `wiring-registered-${RUN_ID}@test.docid`;
    const created = await api<any>("/tenants", {
      method: "POST",
      body: JSON.stringify({
        name: `Wiring Registered ${RUN_ID}`,
        slug: `wiring-registered-${RUN_ID}`,
        adminEmail: email,
        adminPassword: "testpass123",
        identifierPrefix: "REG",
        termsAccepted: true,
      }),
    });
    expect(created.status).toBe(200);
    registeredTenantId = created.body.data.id;

    const login = await api<any>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "testpass123" }),
    });
    expect(login.status).toBe(200);

    const me = await api<any>("/tenants/me", { token: login.body.data.token });
    expect(me.status).toBe(200);
    expect(me.body.data.subscription).toEqual({
      status: "free",
      planName: "Free",
      price: 0,
      expiresAt: null,
    });
  });

  test("PATCH /tenants/me ignora identifierLeaseBatchSize enviado pelo desktop atual", async () => {
    const res = await api<any>("/tenants/me", {
      method: "PATCH",
      token: adminToken,
      body: JSON.stringify({ identifierPrefix: "WIR", identifierLeaseBatchSize: 50 }),
    });
    expect(res.status).toBe(200);
  });
});
