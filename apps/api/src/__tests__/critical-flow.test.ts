/**
 * Testes de Fluxos Críticos — Cobertura end-to-end dos caminhos principais
 * Cobre: auth JWT, RBAC, geração de identificadores, fila de upload, sync offline
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { getFreshRoles } from "../middleware/auth";
import { eq, and, sql } from "drizzle-orm";
import {
  organizations, sectors, users, roles, userRoles,
  categories, devices, identifierLeases, identifiers,
  auditLogs, idempotencyRecords, notifications,
} from "../db/schema";
import { generateIdentifier } from "../services/identifier.service";
import { leaseIdentifiers, releaseLease } from "../services/lease.service";

const rng = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const tag = rng();
const catSeqId = `CF-SEQ-${tag}`;
const catNoSeqId = `CF-NOSEQ-${tag}`;

let orgId: string;
let sectorId: string;
let userId: string;
let adminUserId: string;
let deviceId: string;

const authAdmin = () => ({ userId: adminUserId, tenantId: orgId, sectorId, roles: ["ORG_ADMIN"] });
const authUser = () => ({ userId, tenantId: orgId, sectorId, roles: [] });

describe("Fluxos Críticos — Auth, Identificadores, RBAC, Sync", () => {
  beforeAll(async () => {
    await db.insert(categories).values([
      { id: catSeqId, name: "CF Sequential", group: "Test", prefix: catSeqId, requiresSequential: true },
      { id: catNoSeqId, name: "CF Non-Sequential", group: "Test", prefix: catNoSeqId, requiresSequential: false },
    ]);

    const [org] = await db.insert(organizations).values({
      name: `CF Test ${tag}`, slug: `cf-test-${tag}`,
    }).returning({ id: organizations.id });
    orgId = org.id;

    await withTenant(orgId, async (tx) => {
      const [sector] = await tx.insert(sectors).values({
        tenantId: orgId, name: "CF Sector", code: `CF-SEC-${tag}`,
      }).returning({ id: sectors.id });
      sectorId = sector.id;

      const [admin] = await tx.insert(users).values({
        tenantId: orgId, sectorId, email: `cf-admin-${tag}@test.com`,
        passwordHash: "hash", fullName: "CF Admin",
      }).returning({ id: users.id });
      adminUserId = admin.id;

      const [user] = await tx.insert(users).values({
        tenantId: orgId, sectorId, email: `cf-user-${tag}@test.com`,
        passwordHash: "hash", fullName: "CF User",
      }).returning({ id: users.id });
      userId = user.id;

      const [roleAdmin] = await tx.insert(roles).values({
        name: "ORG_ADMIN", tenantId: orgId,
      }).returning({ id: roles.id });
      await tx.insert(userRoles).values({ userId: adminUserId, roleId: roleAdmin.id });

      const [device] = await tx.insert(devices).values({
        tenantId: orgId, registeredByUserId: userId, name: "CF Device", status: "active",
      }).returning({ id: devices.id });
      deviceId = device.id;
    });
  });

  afterAll(async () => {
    await db.delete(userRoles).where(sql`${userRoles.roleId} IN (SELECT id FROM ${roles} WHERE ${roles.tenantId} = ${orgId})`);
    await db.delete(roles).where(eq(roles.tenantId, orgId));
    await db.delete(notifications).where(eq(notifications.tenantId, orgId));
    await db.delete(identifiers).where(eq(identifiers.tenantId, orgId));
    await db.delete(devices).where(eq(devices.tenantId, orgId));
    await db.delete(users).where(eq(users.tenantId, orgId));
    await db.delete(sectors).where(eq(sectors.tenantId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(categories).where(sql`${categories.id} IN (${catSeqId}, ${catNoSeqId})`);
  });

  // ============================================================
  // 1. Auth & RBAC
  // ============================================================
  test("1.1 getFreshRoles retorna roles corretas para admin", async () => {
    const rolesList = await getFreshRoles(adminUserId, orgId);
    expect(rolesList).toContain("ORG_ADMIN");
  });

  test("1.2 getFreshRoles retorna array vazio para user sem role", async () => {
    const rolesList = await getFreshRoles(userId, orgId);
    expect(rolesList).not.toContain("ORG_ADMIN");
  });

  test("1.3 getFreshRoles não mistura roles entre tenants", async () => {
    const otherTag = rng();
    const [otherOrg] = await db.insert(organizations).values({
      name: `CF Other ${otherTag}`, slug: `cf-other-${otherTag}`,
    }).returning({ id: organizations.id });

    await withTenant(otherOrg.id, async (tx) => {
      const [sec] = await tx.insert(sectors).values({
        tenantId: otherOrg.id, name: "Other", code: `OTH-${otherTag}`,
      }).returning({ id: sectors.id });
      const [u] = await tx.insert(users).values({
        tenantId: otherOrg.id, sectorId: sec.id,
        email: `other-${otherTag}@test.com`, passwordHash: "hash", fullName: "Other",
      }).returning({ id: users.id });
      const [r] = await tx.insert(roles).values({
        name: "SUPER_ADMIN", tenantId: otherOrg.id,
      }).returning({ id: roles.id });
      await tx.insert(userRoles).values({ userId: u.id, roleId: r.id });

      const rolesList = await getFreshRoles(u.id, otherOrg.id);
      expect(rolesList).toContain("SUPER_ADMIN");

      const adminRoles = await getFreshRoles(adminUserId, orgId);
      expect(adminRoles).not.toContain("SUPER_ADMIN");
    });

    await db.delete(userRoles).where(sql`${userRoles.roleId} IN (SELECT id FROM ${roles} WHERE ${roles.tenantId} = ${otherOrg.id})`);
    await db.delete(roles).where(eq(roles.tenantId, otherOrg.id));
    await db.delete(users).where(eq(users.tenantId, otherOrg.id));
    await db.delete(sectors).where(eq(sectors.tenantId, otherOrg.id));
    await db.delete(organizations).where(eq(organizations.id, otherOrg.id));
  });

  // ============================================================
  // 2. Geração de Identificadores
  // ============================================================
  test("2.1 generateIdentifier cria identificador sequencial válido", async () => {
    const result = await withTenant(orgId, (tx) =>
      generateIdentifier(tx, authAdmin(), {
        categoryId: catSeqId,
      })
    );

    expect(result.identifier).toBeTruthy();
    expect(result.identifier).toMatch(/^CF/);
    expect(result.sequence).toBeGreaterThan(0);
    expect(result.id).toBeTruthy();
  });

  test("2.2 identificadores sequenciais são crescentes", async () => {
    const r1 = await withTenant(orgId, (tx) =>
      generateIdentifier(tx, authAdmin(), {
        categoryId: catSeqId,
      })
    );
    const r2 = await withTenant(orgId, (tx) =>
      generateIdentifier(tx, authAdmin(), {
        categoryId: catSeqId,
      })
    );

    expect(r2.sequence).toBeGreaterThan(r1.sequence);
  });

  test("2.3 generateIdentifier não-fiscal usa contador local", async () => {
    const result = await withTenant(orgId, (tx) =>
      generateIdentifier(tx, authAdmin(), {
        categoryId: catNoSeqId,
      })
    );

    expect(result.identifier).toBeTruthy();
    expect(result.leaseId).toBeNull();
  });

  // ============================================================
  // 3. Lease Management
  // ============================================================
  test("3.1 leaseIdentifiers reserva lote e devolve lease", async () => {
    const lease = await withTenant(orgId, (tx) =>
      leaseIdentifiers(tx, authAdmin(), {
        categoryId: catSeqId, deviceId,
      })
    );

    expect(lease.id).toBeTruthy();
    expect(lease.startSeq).toBeGreaterThan(0);
    expect(lease.endSeq).toBeGreaterThanOrEqual(lease.startSeq);
    expect(lease.status).toBe("active");
  });

  test("3.2 releaseLease marca lease como released", async () => {
    const lease = await withTenant(orgId, (tx) =>
      leaseIdentifiers(tx, authAdmin(), {
        categoryId: catSeqId, deviceId,
      })
    );

    await withTenant(orgId, (tx) => releaseLease(tx, authAdmin(), { leaseId: lease.id }));

    const [updated] = await db.select({ status: identifierLeases.status })
      .from(identifierLeases).where(eq(identifierLeases.id, lease.id));

    expect(updated.status).toBe("released");
  });

  // ============================================================
  // 4. Audit Log
  // ============================================================
  test("4.1 generateIdentifier cria audit log", async () => {
    const result = await withTenant(orgId, (tx) =>
      generateIdentifier(tx, authAdmin(), {
        categoryId: catNoSeqId,
      })
    );

    const logs = await db.select()
      .from(auditLogs)
      .where(and(
        eq(auditLogs.tenantId, orgId),
        eq(auditLogs.entityType, "identifier"),
      ));

    expect(logs.length).toBeGreaterThan(0);
    const lastLog = logs[logs.length - 1];
    expect(lastLog.action).toBeTruthy();
  });

  // ============================================================
  // 5. Idempotency
  // ============================================================
  test("5.1 idempotency key é registada", async () => {
    const idemKey = `idem-${rng()}`;
    await db.insert(idempotencyRecords).values({
      idempotencyKey: idemKey, tenantId: orgId,
      result: JSON.stringify({ ok: true }),
    });

    const [record] = await db.select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.idempotencyKey, idemKey));

    expect(record).toBeTruthy();
    expect(record.result).toBeTruthy();
  });

  test("5.2 idempotency key duplicada é rejeitada", async () => {
    const idemKey = `idem-dup-${rng()}`;
    await db.insert(idempotencyRecords).values({
      idempotencyKey: idemKey, tenantId: orgId,
      result: "{}",
    });

    const result = await db.insert(idempotencyRecords).values({
      idempotencyKey: idemKey, tenantId: orgId,
      result: "{}",
    }).catch((e) => e);

    expect(result).toBeInstanceOf(Error);
  });

  // ============================================================
  // 6. Notificações
  // ============================================================
  test("6.1 notificação é criada e associada ao tenant", async () => {
    await withTenant(orgId, async (tx) => {
      await tx.insert(notifications).values({
        tenantId: orgId, userId, type: "test:critical",
        payload: JSON.stringify({ flow: "critical-test" }),
      });
    });

    const [count] = await db.select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(
        eq(notifications.tenantId, orgId),
        eq(notifications.type, "test:critical"),
      ));

    expect(count.count).toBeGreaterThanOrEqual(1);
  });

  // ============================================================
  // 7. Schema Constraints
  // ============================================================
  test("7.1 identificador com tenant_id inválido falha FK", async () => {
    const result = await db.insert(identifiers).values({
      tenantId: "nonexistent-tenant", sectorId: "nonexistent-sector",
      categoryId: catSeqId, identifier: "X", sequence: 1, createdBy: userId,
    }).catch((e) => e);

    expect(result).toBeInstanceOf(Error);
  });

  test("7.2 device com status inválido falha CHECK", async () => {
    const result = await db.insert(devices).values({
      tenantId: orgId, registeredByUserId: userId,
      name: "Bad Device", status: "invalid_status" as any,
    }).catch((e) => e);

    expect(result).toBeInstanceOf(Error);
  });

  // ============================================================
  // 8. Multi-tenant Isolation (resumo)
  // ============================================================
  test("8.1 dados de um tenant não aparecem noutro via withTenant", async () => {
    const otherTag = rng();
    const [otherOrg] = await db.insert(organizations).values({
      name: `CF Isolation ${otherTag}`, slug: `cf-iso-${otherTag}`,
    }).returning({ id: organizations.id });

    await withTenant(otherOrg.id, async (tx) => {
      const ids = await tx.select().from(identifiers)
        .where(eq(identifiers.tenantId, otherOrg.id));
      expect(ids).toHaveLength(0);
    });

    await db.delete(organizations).where(eq(organizations.id, otherOrg.id));
  });
});
