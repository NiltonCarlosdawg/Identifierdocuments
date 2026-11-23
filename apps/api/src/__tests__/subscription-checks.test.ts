// apps/api/src/__tests__/subscription-checks.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { plans, organizations, users, identifiers, documents, sectors } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  getSubscriptionContext, checkUserLimit, checkIdentifierQuota,
  checkUploadLimit, getFreePlan,
} from "../services/subscription.service";

const tag = `chk-${Date.now()}`;
let freePlan: any, paidPlan: any;
const orgs: string[] = [];

async function mkOrg(name: string, overrides: any = {}) {
  const id = crypto.randomUUID();
  orgs.push(id);
  await db.insert(organizations).values({
    id, name: `${name}-${tag}`, slug: `${name}-${tag}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    planId: overrides.planId ?? freePlan.id,
    subscriptionStatus: overrides.status ?? "free",
    subscriptionExpiresAt: overrides.expiresAt,
  });
  return id;
}

beforeAll(async () => {
  freePlan = await getFreePlan();
  const [p] = await db.insert(plans).values({
    name: `paid-${tag}`, price: 100000, maxUsers: 2,
    monthlyOnlineIdentifiers: 2, offlineBudgetPerMachine: 100,
  }).returning();
  paidPlan = p;
});

afterAll(async () => {
  for (const id of orgs) {
    await withTenant(id, async (tx) => {
      await tx.delete(documents).where(eq(documents.tenantId, id));
      await tx.delete(identifiers).where(eq(identifiers.tenantId, id));
      await tx.delete(users).where(eq(users.tenantId, id)); // antes de sectors: FK users.sector_id
      await tx.delete(sectors).where(eq(sectors.tenantId, id));
      await tx.delete(organizations).where(eq(organizations.id, id));
    });
  }
  await db.delete(plans).where(eq(plans.name, `paid-${tag}`));
});

describe("subscription.service", () => {
  test("expiração lazy: paid com data de ontem é tratado como expired", async () => {
    const id = await mkOrg("lazy", { planId: paidPlan.id, status: "paid",
      expiresAt: new Date(Date.now() - 86400000) });
    const ctx = await getSubscriptionContext(id);
    expect(ctx.status).toBe("expired");
    expect(await checkUploadLimit(id, crypto.randomUUID())).toBeNull(); // 0 uploads hoje; o bloqueio em si está provado no teste "upload"
  });

  test("checkUserLimit bloqueia acima do limite sem apagar utilizadores (migração over-limit)", async () => {
    const id = await mkOrg("over", { planId: paidPlan.id }); // maxUsers: 2
    await withTenant(id, async (tx) => {
      const [sec] = await tx.insert(sectors).values({ tenantId: id, name: "S", code: "SO" }).returning();
      for (let i = 0; i < 3; i++) await tx.insert(users).values({
        tenantId: id, sectorId: sec.id, email: `u${i}-${tag}@t.io`, passwordHash: "x", fullName: `U${i}`,
      });
      expect(await checkUserLimit(id, tx)).toMatchObject({ code: "SUBSCRIPTION_USER_LIMIT" });
      const n = await tx.select().from(users).where(eq(users.tenantId, id));
      expect(n.length).toBe(3); // nada foi apagado
    });
  });

  test("checkUserLimit permite abaixo do limite", async () => {
    const id = await mkOrg("under", { planId: paidPlan.id }); // 1 user de 2
    await withTenant(id, async (tx) => {
      const [sec] = await tx.insert(sectors).values({ tenantId: id, name: "S", code: "SU" }).returning();
      await tx.insert(users).values({ tenantId: id, sectorId: sec.id, email: `only-${tag}@t.io`, passwordHash: "x", fullName: "Only" });
      expect(await checkUserLimit(id, tx)).toBeNull();
    });
  });

  test("quota mensal de identificadores", async () => {
    const id = await mkOrg("quota", { planId: paidPlan.id }); // monthlyOnlineIdentifiers: 2
    await withTenant(id, async (tx) => {
      expect(await checkIdentifierQuota(id, tx)).toBeNull();
      // fixture mínima: sector + 2 identifiers; espelhar os campos obrigatórios
      // usados em critical-flow.test.ts (categoria do seed, ex. "PROP")
      const [sec] = await tx.insert(sectors).values({ tenantId: id, name: "S", code: "SQ" }).returning();
      for (let i = 0; i < 2; i++) await tx.insert(identifiers).values({
        tenantId: id, sectorId: sec.id, categoryId: "PROP", createdBy: null,
        identifier: `${tag}-q${i}`, sequence: i + 1,
      });
      expect(await checkIdentifierQuota(id, tx)).toMatchObject({ code: "IDENTIFIER_QUOTA_EXCEEDED" });
    });
  });

  test("upload: 0 hoje permite, 1 hoje bloqueia (só em expired/suspended)", async () => {
    const uid = crypto.randomUUID();
    const active = await mkOrg("up", { planId: paidPlan.id, status: "paid",
      expiresAt: new Date(Date.now() + 86400000) });
    expect(await checkUploadLimit(active, uid)).toBeNull(); // ativo não limita

    const suspended = await mkOrg("up2", { planId: paidPlan.id, status: "suspended" });
    expect(await checkUploadLimit(suspended, uid)).toBeNull(); // sem uploads hoje → pode

    await withTenant(suspended, async (tx) => {
      const [sec] = await tx.insert(sectors).values({ tenantId: suspended, name: "S", code: "SU2" }).returning();
      // uid real: documents.uploadedBy é FK → users.id
      await tx.insert(users).values({
        id: uid, tenantId: suspended, sectorId: sec.id,
        email: `up-${tag}@t.io`, passwordHash: "x", fullName: "Uploader",
      });
      const [ident] = await tx.insert(identifiers).values({
        tenantId: suspended, sectorId: sec.id, categoryId: "PROP", createdBy: null,
        identifier: `${tag}-up`, sequence: 1,
      }).returning();
      await tx.insert(documents).values({ tenantId: suspended, identifierId: ident.id, uploadedBy: uid });
    });
    expect(await checkUploadLimit(suspended, uid)).toMatchObject({ code: "UPLOAD_LIMIT_REACHED" });
    expect(await checkUploadLimit(suspended, crypto.randomUUID())).toBeNull(); // outro user não é afetado
  });
});
