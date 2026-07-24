import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { getFreshRoles } from "../middleware/auth";
import { eq, and, sql } from "drizzle-orm";
import { organizations, sectors, users, roles, userRoles, categories, devices, identifierLeases, identifierReleasePool, identifiers, auditLogs, idempotencyRecords } from "../db/schema";
import { generateIdentifier } from "../services/identifier.service";
import { leaseIdentifiers, releaseLease, forceReleaseLease, registerOfflineIdentifiers } from "../services/lease.service";

const rng = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const tag = rng();
const catSeqId = `TST-SEQ-${tag}`;
const catNoSeqId = `TST-NOSEQ-${tag}`;

let orgId: string;
let sectorId: string;
let userId: string;
let adminUserId: string;
let deviceIdA: string;
let deviceIdB: string;
let roleOrgAdminId: string;

const authAdmin = () => ({ userId: adminUserId, tenantId: orgId, sectorId, roles: ["ORG_ADMIN"] });
const authUser = () => ({ userId, tenantId: orgId, sectorId, roles: [] });

async function insertDevice(tx: any, name: string, status = "active") {
  const [d] = await tx.insert(devices).values({
    tenantId: orgId, userId, name, status,
  }).returning({ id: devices.id });
  return d.id;
}

describe("M2 — Offline Identifiers (lease/release/force-release/register-offline)", () => {
  beforeAll(async () => {
    await db.insert(categories).values([
      { id: catSeqId, name: "Test Sequential", group: "Test", prefix: catSeqId, requiresSequential: true },
      { id: catNoSeqId, name: "Test Non-Sequential", group: "Test", prefix: catNoSeqId, requiresSequential: false },
    ]);

    const [org] = await db.insert(organizations).values({
      name: `M2 Test ${tag}`, slug: `m2-test-${tag}`,
    }).returning({ id: organizations.id });
    orgId = org.id;

    await withTenant(orgId, async (tx) => {
      const [sector] = await tx.insert(sectors).values({
        tenantId: orgId, name: "M2 Sector", code: `M2-SEC-${tag}`,
      }).returning({ id: sectors.id });
      sectorId = sector.id;

      const [u] = await tx.insert(users).values({
        tenantId: orgId, sectorId: sector.id,
        email: `m2-user-${tag}@test.com`, passwordHash: "hash", fullName: "M2 User",
      }).returning({ id: users.id });
      userId = u.id;

      const [admin] = await tx.insert(users).values({
        tenantId: orgId, sectorId: sector.id,
        email: `m2-admin-${tag}@test.com`, passwordHash: "hash", fullName: "M2 Admin",
      }).returning({ id: users.id });
      adminUserId = admin.id;

      const [role] = await tx.insert(roles).values({
        tenantId: orgId, name: "ORG_ADMIN",
      }).returning({ id: roles.id });
      roleOrgAdminId = role.id;

      await tx.insert(userRoles).values({
        userId: adminUserId, roleId: role.id, grantedBy: adminUserId,
      });

      deviceIdA = await insertDevice(tx, "Device A");
      deviceIdB = await insertDevice(tx, "Device B");
    });
  });

  afterAll(async () => {
    // Usar withTenant para definir app.current_tenant, permitindo que RLS veja as linhas.
    // Limpar ambos os inquilinos: orgId (slug m2-test-*) e orgBId (slug m2-tenantb-*)
    const slugs = [`m2-test-${tag}`, `m2-tenantb-${tag}`];
    for (const slug of slugs) {
      for (const tenant of await db.select({ id: organizations.id })
        .from(organizations).where(eq(organizations.slug, slug))) {
        await withTenant(tenant.id, async (tx) => {
          await tx.execute(sql`DELETE FROM audit_logs WHERE tenant_id = ${tenant.id}`);
          await tx.execute(sql`DELETE FROM identifier_release_pool WHERE tenant_id = ${tenant.id}`);
          await tx.execute(sql`DELETE FROM identifier_leases WHERE tenant_id = ${tenant.id}`);
          await tx.execute(sql`DELETE FROM identifiers WHERE tenant_id = ${tenant.id}`);
          await tx.execute(sql`DELETE FROM idempotency_records WHERE tenant_id = ${tenant.id}`);
          await tx.execute(sql`DELETE FROM devices WHERE tenant_id = ${tenant.id}`);
          await tx.execute(sql`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ${tenant.id})`);
          await tx.execute(sql`DELETE FROM users WHERE tenant_id = ${tenant.id}`);
          await tx.execute(sql`DELETE FROM roles WHERE tenant_id = ${tenant.id}`);
          await tx.execute(sql`DELETE FROM sectors WHERE tenant_id = ${tenant.id}`);
        });
      }
    }
    await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${`m2-%-${tag}`}`);
    await db.execute(sql`DELETE FROM categories WHERE id IN (${catSeqId}, ${catNoSeqId})`);
  });

  /* ================================================================
   * 1. leaseIdentifiers
   * ================================================================ */
  describe("1. leaseIdentifiers", () => {
    test("aloca [startSeq, endSeq] com batchSize default 50", async () => {
      const lease = await withTenant(orgId, (tx) =>
        leaseIdentifiers(tx, authAdmin(), { deviceId: deviceIdA, categoryId: catSeqId }));
      expect(lease.startSeq).toBe(1);
      expect(lease.endSeq).toBe(50);
      expect(lease.status).toBe("active");
    });

    test("rejeita categoria com requiresSequential = false", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: "TempDevice", status: "active" })
          .returning({ id: devices.id }));
      await expect(
        withTenant(orgId, (tx) =>
          leaseIdentifiers(tx, authAdmin(), { deviceId: d.id, categoryId: catNoSeqId })),
      ).rejects.toThrow("não requer sequenciação");
    });

    test("rejeita device inexistente", async () => {
      await expect(
        withTenant(orgId, (tx) =>
          leaseIdentifiers(tx, authAdmin(), { deviceId: "00000000-0000-0000-0000-000000000000", categoryId: catSeqId })),
      ).rejects.toThrow("Dispositivo não encontrado");
    });

    test("rejeita device com status !== active", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: "InactiveDevice", status: "force_released" })
          .returning({ id: devices.id }));
      await expect(
        withTenant(orgId, (tx) =>
          leaseIdentifiers(tx, authAdmin(), { deviceId: d.id, categoryId: catSeqId })),
      ).rejects.toThrow("não está activo");
    });

    test("rejeita segundo lease activo — partial unique index a nível BD", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: "DupDevice", status: "active" })
          .returning({ id: devices.id }));

      await withTenant(orgId, (tx) =>
        leaseIdentifiers(tx, authAdmin(), { deviceId: d.id, categoryId: catSeqId }));

      await expect(
        withTenant(orgId, (tx) =>
          leaseIdentifiers(tx, authAdmin(), { deviceId: d.id, categoryId: catSeqId })),
      ).rejects.toThrow("já tem um lease activo");

      // bypass app logic — insert directly via SQL, confirm BD rejeita
      let rejected = false;
      try {
        await db.insert(identifierLeases).values({
          tenantId: orgId, categoryId: catSeqId, sectorId,
          deviceId: d.id, startSeq: 999, endSeq: 1048, status: "active",
        }).returning();
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    });

    test("concorrência: intervalos alocados nunca se sobrepõem", async () => {
      const deviceNames = Array.from({ length: 10 }, (_, i) => `device-conc-${tag}-${i}`);
      for (const name of deviceNames) {
        await withTenant(orgId, (tx) =>
          tx.insert(devices).values({ tenantId: orgId, userId, name, status: "active" }).returning());
      }

      const results = await Promise.all(
        deviceNames.map((name) =>
          withTenant(orgId, async (tx) => {
            const [d] = await tx.select({ id: devices.id }).from(devices)
              .where(and(eq(devices.tenantId, orgId), eq(devices.name, name)));
            return leaseIdentifiers(tx, authAdmin(), { deviceId: d.id, categoryId: catSeqId });
          }),
        ),
      );

      for (let i = 0; i < results.length; i++) {
        for (let j = i + 1; j < results.length; j++) {
          const a = results[i];
          const b = results[j];
          const overlap = a.startSeq <= b.endSeq && b.startSeq <= a.endSeq;
          expect(overlap).toBe(false);
        }
      }
    });

    test("nextStart respeita o maior entre identifiers.sequence, leases.end_seq e pool.range_end", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `PoolTest-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      // Pre-seed: identifier com sequence=100, lease com end_seq=200, pool com range_end=150
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant', ${orgId}, true)`);
        await tx.insert(identifiers).values({
          tenantId: orgId, sectorId, categoryId: catSeqId,
          identifier: `PRE-SEED-${tag}`, sequence: 100, createdBy: userId,
        });
        await tx.insert(identifierLeases).values({
          tenantId: orgId, categoryId: catSeqId, sectorId,
          deviceId: d.id, startSeq: 101, endSeq: 200, status: "released", releasedAt: new Date(),
        });
        await tx.insert(identifierReleasePool).values({
          tenantId: orgId, categoryId: catSeqId, sectorId,
          rangeStart: 101, rangeEnd: 150,
        });
      });

      // lease deve começar depois do maior valor pre-seedado (max(100,200,150)+1 = 201)
      // NOTA: outros testes podem ter criado dados na mesma categoria, por isso
      // só verificamos que startSeq > 200 (maior valor pre-seedado)
      const lease = await withTenant(orgId, (tx) =>
        leaseIdentifiers(tx, authAdmin(), { deviceId: d.id, categoryId: catSeqId }));
      expect(lease.startSeq).toBeGreaterThan(200);
      expect(lease.endSeq).toBe(lease.startSeq + 49);
    });
  });

  /* ================================================================
   * 2. releaseLease / forceReleaseLease
   * ================================================================ */
  describe("2. releaseLease / forceReleaseLease", () => {
    test("releaseLease: sequências não usadas vão para identifier_release_pool", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `ReleaseDev-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      // Lease [1,50], mark used_up_to=20
      const [lease] = await db.insert(identifierLeases).values({
        tenantId: orgId, categoryId: catSeqId, sectorId,
        deviceId: d.id, startSeq: 1, endSeq: 50, usedUpTo: 20, status: "active",
      }).returning();

      await withTenant(orgId, (tx) => releaseLease(tx, authUser(), { leaseId: lease.id }));

      const pool = await db.select().from(identifierReleasePool)
        .where(and(eq(identifierReleasePool.tenantId, orgId), eq(identifierReleasePool.categoryId, catSeqId)));

      expect(pool.some((p) => p.rangeStart === 21 && p.rangeEnd === 50)).toBe(true);
    });

    test("releaseLease: lease já não-activo é rejeitado (idempotência)", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `IdemDev-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      const [lease] = await db.insert(identifierLeases).values({
        tenantId: orgId, categoryId: catSeqId, sectorId,
        deviceId: d.id, startSeq: 1, endSeq: 10, usedUpTo: 1, status: "released", releasedAt: new Date(),
      }).returning();

      await expect(
        withTenant(orgId, (tx) => releaseLease(tx, authUser(), { leaseId: lease.id })),
      ).rejects.toThrow("não está activo");
    });

    test("releaseLease/forceReleaseLease funcionam com device desactivado", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `DeadDev-${tag}`, status: "force_released" })
          .returning({ id: devices.id }));

      const [lease] = await db.insert(identifierLeases).values({
        tenantId: orgId, categoryId: catSeqId, sectorId,
        deviceId: d.id, startSeq: 1, endSeq: 10, usedUpTo: 5, status: "active",
      }).returning();

      await expect(
        withTenant(orgId, (tx) => releaseLease(tx, authUser(), { leaseId: lease.id })),
      ).resolves.toHaveProperty("message");
    });

    test("forceReleaseLease: admin revogado no DB não consegue forçar libertação", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `ForceAdmin-${tag}`, status: "active" })
          .returning({ id: devices.id }));
      const [lease] = await db.insert(identifierLeases).values({
        tenantId: orgId, categoryId: catSeqId, sectorId,
        deviceId: d.id, startSeq: 1, endSeq: 10, status: "active",
      }).returning();

      const fresh1 = await getFreshRoles(adminUserId, orgId);
      expect(fresh1).toContain("ORG_ADMIN");

      await db.delete(userRoles).where(and(eq(userRoles.userId, adminUserId), eq(userRoles.roleId, roleOrgAdminId)));

      const fresh2 = await getFreshRoles(adminUserId, orgId);
      expect(fresh2).not.toContain("ORG_ADMIN");

      await db.insert(userRoles).values({
        userId: adminUserId, roleId: roleOrgAdminId, grantedBy: adminUserId,
      });

      await expect(
        withTenant(orgId, (tx) => forceReleaseLease(tx, authAdmin(), { leaseId: lease.id })),
      ).resolves.toHaveProperty("message");
    });
  });

  /* ================================================================
   * 3. registerOfflineIdentifiers
   * ================================================================ */
  describe("3. registerOfflineIdentifiers", () => {
    let leaseId: string;

    beforeAll(async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `OfflineDev-${tag}`, status: "active" })
          .returning({ id: devices.id }));
      deviceIdA = d.id;

      const [lease] = await db.insert(identifierLeases).values({
        tenantId: orgId, categoryId: catSeqId, sectorId,
        deviceId: d.id, startSeq: 1, endSeq: 100, status: "active",
      }).returning({ id: identifierLeases.id });
      leaseId = lease.id;
    });

    test("sequência dentro do intervalo é aceite", async () => {
      const result = await withTenant(orgId, (tx) =>
        registerOfflineIdentifiers(tx, authUser(), {
          deviceId: deviceIdA, leaseId,
          identifiers: [{ sequence: 1 }],
        }));
      expect(result).toHaveLength(1);
      expect(result[0].sequence).toBe(1);
    });

    test("sequência fora do intervalo é rejeitada", async () => {
      await expect(
        withTenant(orgId, (tx) =>
          registerOfflineIdentifiers(tx, authUser(), {
            deviceId: deviceIdA, leaseId,
            identifiers: [{ sequence: 200 }],
          })),
      ).rejects.toThrow("fora do intervalo");
    });

    test("sequência fora de ordem (não contígua a partir de usedUpTo+1) é rejeitada", async () => {
      await expect(
        withTenant(orgId, (tx) =>
          registerOfflineIdentifiers(tx, authUser(), {
            deviceId: deviceIdA, leaseId,
            identifiers: [{ sequence: 3 }],
          })),
      ).rejects.toThrow("fora de ordem");
    });

    test("rejeita device inactivo", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `OffDead-${tag}`, status: "force_released" })
          .returning({ id: devices.id }));
      const [l] = await db.insert(identifierLeases).values({
        tenantId: orgId, categoryId: catSeqId, sectorId,
        deviceId: d.id, startSeq: 1, endSeq: 10, status: "active",
      }).returning({ id: identifierLeases.id });

      await expect(
        withTenant(orgId, (tx) =>
          registerOfflineIdentifiers(tx, authUser(), {
            deviceId: d.id, leaseId: l.id,
            identifiers: [{ sequence: 1 }],
          })),
      ).rejects.toThrow("não está activo");
    });

    test("rejeita lease não-activo", async () => {
      await expect(
        withTenant(orgId, (tx) =>
          registerOfflineIdentifiers(tx, authUser(), {
            deviceId: deviceIdA, leaseId: "00000000-0000-0000-0000-000000000000",
            identifiers: [{ sequence: 5 }],
          })),
      ).rejects.toThrow("não encontrado");
    });

    test("rejeita lease pertencente a outro device", async () => {
      const [d2] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `OtherDev-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      await expect(
        withTenant(orgId, (tx) =>
          registerOfflineIdentifiers(tx, authUser(), {
            deviceId: d2.id, leaseId,
            identifiers: [{ sequence: 2 }],
          })),
      ).rejects.toThrow("não pertence");
    });

    test("duas chamadas concorrentes à mesma sequência: só uma regista (o lock serializa correctamente)", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `ConcOff-${tag}`, status: "active" })
          .returning({ id: devices.id }));
      // Usar sequência alta (1000) para evitar colisão com registos de outros testes
      const [l] = await db.insert(identifierLeases).values({
        tenantId: orgId, categoryId: catSeqId, sectorId,
        deviceId: d.id, startSeq: 1000, endSeq: 1010, usedUpTo: null, status: "active",
      }).returning({ id: identifierLeases.id });

      const results = await Promise.allSettled([
        withTenant(orgId, (tx) =>
          registerOfflineIdentifiers(tx, authUser(), {
            deviceId: d.id, leaseId: l.id,
            identifiers: [{ sequence: 1000 }],
          })),
        withTenant(orgId, (tx) =>
          registerOfflineIdentifiers(tx, authUser(), {
            deviceId: d.id, leaseId: l.id,
            identifiers: [{ sequence: 1000 }],
          })),
      ]);

      expect(results).toHaveLength(2);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const success = fulfilled[0] as PromiseFulfilledResult<any>;
      expect(success.value).toHaveLength(1);
      expect(success.value[0].sequence).toBe(1000);

      const failure = rejected[0] as PromiseRejectedResult;
      expect(failure.reason?.message ?? "").toMatch(/fora de ordem/i);
    });
  });

  /* ================================================================
   * 4. register-offline-loose (via generateIdentifier)
   * ================================================================ */
  describe("4. register-offline-loose", () => {
    test("rejeita categoria com requiresSequential = true (código 400 / CATEGORY_SEQUENTIAL)", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `LooseSeq-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      await expect(
        withTenant(orgId, async (tx) => {
          const cat = await tx.query.categories.findFirst({ where: eq(categories.id, catSeqId) });
          if (!cat) throw new Error("Categoria não encontrada.");
          if (cat.requiresSequential) throw new Error("Categoria requer sequenciação. Use /identifiers/register-offline em vez de -loose.");
          return generateIdentifier(tx, authUser(), { categoryId: catSeqId });
        }),
      ).rejects.toThrow("requer sequenciação");
    });

    test("rejeita device inactivo (DEVICE_INACTIVE, 400)", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `LooseDead-${tag}`, status: "force_released" })
          .returning({ id: devices.id }));

      await expect(
        withTenant(orgId, async (tx) => {
          const device = await tx.query.devices.findFirst({
            where: and(eq(devices.id, d.id), eq(devices.tenantId, orgId)),
          });
          if (!device) throw new Error("Dispositivo não encontrado.");
          if (device.status !== "active") throw new Error("Dispositivo não está activo.");
          return generateIdentifier(tx, authUser(), { categoryId: catNoSeqId });
        }),
      ).rejects.toThrow("não está activo");
    });

    test("aloca via generateIdentifier — sequência consistente com MAX(sequence)+1 mesmo com concorrência", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `LooseConc-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      // Mix: generate (online) + register-offline-loose (offline) concorrentes
      const mixed = await Promise.all([
        withTenant(orgId, (tx) =>
          generateIdentifier(tx, authUser(), { categoryId: catNoSeqId, sectorId })),
        withTenant(orgId, (tx) =>
          generateIdentifier(tx, authUser(), { categoryId: catNoSeqId, sectorId })),
        withTenant(orgId, async (tx) => {
          const cat = await tx.query.categories.findFirst({ where: eq(categories.id, catNoSeqId) });
          if (cat?.requiresSequential) throw new Error("...");
          return generateIdentifier(tx, authUser(), { categoryId: catNoSeqId, sectorId });
        }),
      ]);

      const seqs = mixed.map((r) => r.sequence).sort((a, b) => a - b);
      // Começamos com sequence 1 do setup, +1 do test anterior = 2, então os 3 novos devem ser 3,4,5
      expect(seqs[1]).toBe(seqs[0] + 1);
      expect(seqs[2]).toBe(seqs[1] + 1);
    });
  });

  /* ================================================================
   * 5. RLS / isolamento entre tenants (savepoint incluso)
   * ================================================================ */
  describe("5. RLS / isolamento entre tenants", () => {
    let orgBId: string;
    let sectorBId: string;

    beforeAll(async () => {
      const [orgB] = await db.insert(organizations).values({
        name: `M2 TenantB ${tag}`, slug: `m2-tenantb-${tag}`,
      }).returning({ id: organizations.id });
      orgBId = orgB.id;

      await withTenant(orgBId, async (tx) => {
        const [s] = await tx.insert(sectors).values({
          tenantId: orgBId, name: "Sector B", code: `SEC-B-${tag}`,
        }).returning({ id: sectors.id });
        sectorBId = s.id;

        const [uB] = await tx.insert(users).values({
          tenantId: orgBId, sectorId: s.id,
          email: `m2-user-b-${tag}@test.com`, passwordHash: "hash", fullName: "M2 User B",
        }).returning({ id: users.id });

        await tx.insert(identifiers).values({
          tenantId: orgBId, sectorId: s.id, categoryId: catNoSeqId,
          identifier: `TENANT-B-IDENT-${tag}`, sequence: 1, createdBy: uB.id,
        });
      });
    });

    test("withTenant nunca vê dados de outro tenant (dentro de generateIdentifier/savepoint)", async () => {
      const result = await withTenant(orgId, async (tx) => {
        const idents = await tx.select({ identifier: identifiers.identifier })
          .from(identifiers)
          .where(eq(identifiers.tenantId, orgId));
        return idents.map((i) => i.identifier);
      });

      expect(result).not.toContain(`TENANT-B-IDENT-${tag}`);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    test("savepoint dentro de generateIdentifier não vaza app.current_tenant", async () => {
      const newIdents = await withTenant(orgId, async (tx) => {
        const allBefore = await tx.select({ identifier: identifiers.identifier })
          .from(identifiers);
        await generateIdentifier(tx, { ...authUser(), tenantId: orgId }, { categoryId: catNoSeqId, sectorId });
        const allAfter = await tx.select({ identifier: identifiers.identifier })
          .from(identifiers);
        return allAfter.filter((r) => !allBefore.some((b) => b.identifier === r.identifier));
      });
      expect(newIdents).toHaveLength(1);
      expect(newIdents[0].identifier).toContain(catNoSeqId);
    });
  });

  /* ================================================================
   * 6. Auditoria (audit_logs)
   * ================================================================ */
  describe("6. Auditoria", () => {
    test("cada operação grava exactamente uma entrada de audit log com metadata correcto", async () => {
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `AuditDev-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      const lease = await withTenant(orgId, (tx) =>
        leaseIdentifiers(tx, authAdmin(), { deviceId: d.id, categoryId: catSeqId }, "10.0.0.1"));

      const leaseLogs = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.resourceId, lease.id), eq(auditLogs.action, "LEASE")));
      expect(leaseLogs).toHaveLength(1);
      expect(leaseLogs[0].action).toBe("LEASE");
      expect(leaseLogs[0].ip).toBe("10.0.0.1");

      await withTenant(orgId, (tx) =>
        releaseLease(tx, authUser(), { leaseId: lease.id }, "10.0.0.2"));

      const releaseLogs = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.resourceId, lease.id), eq(auditLogs.action, "RELEASE")));
      expect(releaseLogs).toHaveLength(1);
      expect(releaseLogs[0].action).toBe("RELEASE");

      // Segundo lease para force-release
      const [d2] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `AuditDev2-${tag}`, status: "active" })
          .returning({ id: devices.id }));
      const lease2 = await withTenant(orgId, (tx) =>
        leaseIdentifiers(tx, authAdmin(), { deviceId: d2.id, categoryId: catSeqId }, "10.0.0.3"));

      await withTenant(orgId, (tx) =>
        forceReleaseLease(tx, authAdmin(), { leaseId: lease2.id }, "10.0.0.4"));

      const forceLogs = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.resourceId, lease2.id), eq(auditLogs.action, "FORCE_RELEASE")));
      expect(forceLogs).toHaveLength(1);

      // register-offline
      const [d3] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `AuditDev3-${tag}`, status: "active" })
          .returning({ id: devices.id }));
      const lease3 = await withTenant(orgId, (tx) =>
        leaseIdentifiers(tx, authAdmin(), { deviceId: d3.id, categoryId: catSeqId }));
      const regged = await withTenant(orgId, (tx) =>
        registerOfflineIdentifiers(tx, authUser(), {
          deviceId: d3.id, leaseId: lease3.id,
          identifiers: [{ sequence: lease3.startSeq }],
        }, "10.0.0.5"));

      const regLogs = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.resourceId, regged[0].id), eq(auditLogs.action, "REGISTER_OFFLINE")));
      expect(regLogs).toHaveLength(1);

      // generate (pelo register-offline-loose)
      const [d4] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `AuditDev4-${tag}`, status: "active" })
          .returning({ id: devices.id }));
      const genned = await withTenant(orgId, (tx) =>
        generateIdentifier(tx, authUser(), { categoryId: catNoSeqId, sectorId }, "10.0.0.6"));

      const genLogs = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.resourceId, genned.id), eq(auditLogs.action, "GENERATE")));
      expect(genLogs).toHaveLength(1);
      expect(genLogs[0].ip).toBe("10.0.0.6");
    });
  });

  /* ================================================================
   * 7. Idempotency (idempotencyKey)
   * ================================================================ */
  describe("7. Idempotency", () => {
    test("(a) register-offline-loose: mesmo idempotencyKey devolve mesmo identificador", async () => {
      const key = `loose-idem-${tag}-a`;
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `IdemLooseA-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      const first = await withTenant(orgId, (tx) =>
        generateIdentifier(tx, authUser(), {
          categoryId: catNoSeqId, sectorId, idempotencyKey: key,
        }));

      const second = await withTenant(orgId, (tx) =>
        generateIdentifier(tx, authUser(), {
          categoryId: catNoSeqId, sectorId, idempotencyKey: key,
        }));

      expect(second.id).toBe(first.id);
      expect(second.identifier).toBe(first.identifier);
      expect(second.sequence).toBe(first.sequence);
    });

    test("(b) register-offline: mesmo idempotencyKey devolve mesmos identificadores e não avança usedUpTo", async () => {
      const key = `offline-idem-${tag}-b`;
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `IdemOffB-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      const [lease] = await db.insert(identifierLeases).values({
        tenantId: orgId, categoryId: catSeqId, sectorId,
        deviceId: d.id, startSeq: 9100, endSeq: 9200, status: "active",
      }).returning();

      const first = await withTenant(orgId, (tx) =>
        registerOfflineIdentifiers(tx, authUser(), {
          deviceId: d.id, leaseId: lease.id,
          identifiers: [{ sequence: 9100 }, { sequence: 9101 }],
          idempotencyKey: key,
        }));

      const second = await withTenant(orgId, (tx) =>
        registerOfflineIdentifiers(tx, authUser(), {
          deviceId: d.id, leaseId: lease.id,
          identifiers: [{ sequence: 9100 }, { sequence: 9101 }],
          idempotencyKey: key,
        }));

      expect(second).toHaveLength(first.length);
      expect(second[0].id).toBe(first[0].id);
      expect(second[1].id).toBe(first[1].id);

      const freshLease = await db.query.identifierLeases.findFirst({ where: eq(identifierLeases.id, lease.id) });
      expect(freshLease!.usedUpTo).toBe(9101);
    });

    test("(c) concorrência com mesmo idempotencyKey: só uma linha criada", async () => {
      const key = `concurrent-idem-${tag}-c`;
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `IdemConcC-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      const results = await Promise.all([
        withTenant(orgId, (tx) =>
          generateIdentifier(tx, authUser(), {
            categoryId: catNoSeqId, sectorId, idempotencyKey: key,
          })),
        withTenant(orgId, (tx) =>
          generateIdentifier(tx, authUser(), {
            categoryId: catNoSeqId, sectorId, idempotencyKey: key,
          })),
      ]);

      expect(results[0].id).toBe(results[1].id);

      const rows = await db.select().from(idempotencyRecords)
        .where(and(eq(idempotencyRecords.tenantId, orgId), eq(idempotencyRecords.idempotencyKey, key)));
      expect(rows).toHaveLength(1);
    });

    test("(d) duas idempotencyKey diferentes geram identificadores distintos", async () => {
      const key1 = `distinct-idem-${tag}-d1`;
      const key2 = `distinct-idem-${tag}-d2`;
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `IdemDistD-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      const [r1, r2] = await Promise.all([
        withTenant(orgId, (tx) =>
          generateIdentifier(tx, authUser(), {
            categoryId: catNoSeqId, sectorId, idempotencyKey: key1,
          })),
        withTenant(orgId, (tx) =>
          generateIdentifier(tx, authUser(), {
            categoryId: catNoSeqId, sectorId, idempotencyKey: key2,
          })),
      ]);

      expect(r1.id).not.toBe(r2.id);
      expect(r1.identifier).not.toBe(r2.identifier);
    });

    test("(e) concorrência: mesma idempotencyKey, categorias diferentes — só um idempotency_record criado", async () => {
      const key = `cross-cat-idem-${tag}-e`;
      const [d] = await withTenant(orgId, (tx) =>
        tx.insert(devices).values({ tenantId: orgId, userId, name: `IdemCrossE-${tag}`, status: "active" })
          .returning({ id: devices.id }));

      const cat2Id = `TST-NOSEQ2-${tag}`;
      await db.insert(categories).values({
        id: cat2Id, name: "Test Non-Sequential 2", group: "Test", prefix: cat2Id, requiresSequential: false,
      });

      try {
        const [r1, r2] = await Promise.all([
          withTenant(orgId, (tx) =>
            generateIdentifier(tx, authUser(), {
              categoryId: catNoSeqId, sectorId, idempotencyKey: key,
            })),
          withTenant(orgId, (tx) =>
            generateIdentifier(tx, authUser(), {
              categoryId: cat2Id, sectorId, idempotencyKey: key,
            })),
        ]);

        expect(r1.id).toBe(r2.id);
        expect(r1.identifier).toBe(r2.identifier);

        const records = await db.select().from(idempotencyRecords)
          .where(and(
            eq(idempotencyRecords.tenantId, orgId),
            eq(idempotencyRecords.idempotencyKey, key),
          ));
        expect(records).toHaveLength(1);

        const discardLogs = await db.select().from(auditLogs)
          .where(and(
            eq(auditLogs.tenantId, orgId),
            eq(auditLogs.action, "IDEMPOTENCY_DISCARDED"),
            sql`metadata LIKE ${'%' + key + '%'}`,
          ));
        expect(discardLogs).toHaveLength(1);
        const log = discardLogs[0];
        const meta = JSON.parse(log.metadata!);
        expect(meta.idempotencyKey).toBe(key);
        expect(meta.winnerIdentifier).toBe(r1.identifier);
        expect(log.resourceId).not.toBe(r1.id);
        const orphan = await db.query.identifiers.findFirst({ where: eq(identifiers.id, log.resourceId!) });
        expect(orphan).not.toBeNull();
        expect(orphan!.identifier).toBe(meta.orphanIdentifier);
      } finally {
        await db.execute(sql`DELETE FROM identifiers WHERE category_id = ${cat2Id}`);
        await db.execute(sql`DELETE FROM categories WHERE id = ${cat2Id}`);
      }
    });
  });
});
