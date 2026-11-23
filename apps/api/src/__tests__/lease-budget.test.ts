// apps/api/src/__tests__/lease-budget.test.ts
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { sql } from "drizzle-orm";
import {
  organizations, plans, sectors, users, roles, userRoles,
  categories, devices, identifierLeases,
  auditLogs, identifierReleasePool, identifiers, idempotencyRecords,
} from "../db/schema";
import { leaseIdentifiers } from "../services/lease.service";
import { getFreePlan, SubscriptionError } from "../services/subscription.service";

const tag = `leasebud-${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const catId = `LBCAT-${tag}`;
const orgIds: string[] = [];
let freePlanId: string;
let paidPlanId: string;

beforeAll(async () => {
  freePlanId = (await getFreePlan()).id;
  const [paid] = await db.insert(plans).values({
    name: `leasebud-paid-${tag}`, price: 100000, maxUsers: 50,
    monthlyOnlineIdentifiers: 100000, offlineBudgetPerMachine: 100,
  }).returning({ id: plans.id });
  paidPlanId = paid.id;
  await db.insert(categories).values({
    id: catId, name: "Lease Budget Cat", group: "Test", prefix: catId, requiresSequential: true,
  });
});

afterAll(async () => {
  for (const orgId of orgIds) {
    await withTenant(orgId, async (tx) => {
      await tx.execute(sql`DELETE FROM audit_logs WHERE tenant_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM identifier_release_pool WHERE tenant_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM identifier_leases WHERE tenant_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM identifiers WHERE tenant_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM idempotency_records WHERE tenant_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM devices WHERE tenant_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ${orgId})`);
      await tx.execute(sql`DELETE FROM users WHERE tenant_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM roles WHERE tenant_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM sectors WHERE tenant_id = ${orgId}`);
    });
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`);
  }
  await db.execute(sql`DELETE FROM plans WHERE id = ${paidPlanId}`);
  await db.execute(sql`DELETE FROM categories WHERE id = ${catId}`);
});

async function setupCase(opts: {
  plan: "free" | "paid";
  expiresAt?: Date;
  admin: boolean;
}) {
  const slug = `${tag}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db.insert(organizations).values({
    name: `Lease Budget ${slug}`, slug,
    planId: opts.plan === "paid" ? paidPlanId : freePlanId,
    subscriptionStatus: opts.plan === "paid" ? "paid" : "free",
    subscriptionExpiresAt: opts.expiresAt,
  }).returning({ id: organizations.id });
  const orgId = org.id;
  orgIds.push(orgId);

  let sectorId!: string;
  let deviceId!: string;
  let adminUserId!: string;
  let memberUserId!: string;
  await withTenant(orgId, async (tx) => {
    const [s] = await tx.insert(sectors).values({
      tenantId: orgId, name: "Sector", code: `SEC-${slug}`,
    }).returning({ id: sectors.id });
    sectorId = s.id;
    const [a] = await tx.insert(users).values({
      tenantId: orgId, sectorId, email: `admin-${slug}@t.io`, passwordHash: "x", fullName: "Admin",
    }).returning({ id: users.id });
    adminUserId = a.id;
    const [m] = await tx.insert(users).values({
      tenantId: orgId, sectorId, email: `member-${slug}@t.io`, passwordHash: "x", fullName: "Member",
    }).returning({ id: users.id });
    memberUserId = m.id;
    const [r] = await tx.insert(roles).values({
      tenantId: orgId, name: "ORG_ADMIN",
    }).returning({ id: roles.id });
    await tx.insert(userRoles).values({ userId: adminUserId, roleId: r.id, grantedBy: adminUserId });
    const [d] = await tx.insert(devices).values({
      tenantId: orgId, sectorId, registeredByUserId: adminUserId, name: `Device-${slug}`, status: "active",
    }).returning({ id: devices.id });
    deviceId = d.id;
  });

  const authAdmin = { userId: adminUserId, tenantId: orgId, sectorId, roles: ["ORG_ADMIN"] };
  const authMember = { userId: memberUserId, tenantId: orgId, sectorId, roles: [] };
  return { orgId, deviceId, authAdmin, authMember };
}

async function seedPastLease(
  orgId: string, deviceId: string, count: number, createdAt: Date,
) {
  await withTenant(orgId, async (tx) => {
    const [d] = await tx.select({ sectorId: devices.sectorId }).from(devices)
      .where(sql`${devices.id} = ${deviceId}`);
    await tx.insert(identifierLeases).values({
      tenantId: orgId, categoryId: catId, sectorId: d.sectorId, deviceId,
      startSeq: 1, endSeq: count, status: "released", releasedAt: new Date(), createdAt,
    });
  });
}

async function captureSubscriptionError(p: Promise<unknown>): Promise<SubscriptionError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(SubscriptionError);
    return err as SubscriptionError;
  }
  throw new Error("Esperava SubscriptionError mas a chamada não falhou");
}

const lease = (ctx: Awaited<ReturnType<typeof setupCase>>, auth: "authAdmin" | "authMember") =>
  withTenant(ctx.orgId, (tx) =>
    leaseIdentifiers(tx, ctx[auth], { deviceId: ctx.deviceId, categoryId: catId }));

describe("Orçamento offline no lease (fonte única = plano)", () => {
  test("1. free + ORG_ADMIN: reserva min(50,10)=10; segundo lease no mesmo dispositivo → LEASE_BUDGET_EXCEEDED", async () => {
    const ctx = await setupCase({ plan: "free", admin: true });
    const first = await lease(ctx, "authAdmin");
    expect(first.endSeq - first.startSeq + 1).toBe(10);
    const err = await captureSubscriptionError(lease(ctx, "authAdmin"));
    expect(err.code).toBe("LEASE_BUDGET_EXCEEDED");
  });

  test("2. free + MEMBER → OFFLINE_ADMIN_ONLY", async () => {
    const ctx = await setupCase({ plan: "free", admin: false });
    const err = await captureSubscriptionError(lease(ctx, "authMember"));
    expect(err.code).toBe("OFFLINE_ADMIN_ONLY");
    expect(err.message).toBe("Geração offline disponível apenas para o administrador no plano Free.");
  });

  test("3. paid: lease de 50 criado o mês passado não conta → reserva 50", async () => {
    const ctx = await setupCase({ plan: "paid", admin: true });
    await seedPastLease(ctx.orgId, ctx.deviceId, 50, new Date(Date.now() - 40 * 86400000));
    const result = await lease(ctx, "authAdmin");
    expect(result.endSeq - result.startSeq + 1).toBe(50);
  });

  test("4. paid com used=100 este mês → LEASE_BUDGET_EXCEEDED", async () => {
    const ctx = await setupCase({ plan: "paid", admin: true });
    await seedPastLease(ctx.orgId, ctx.deviceId, 100, new Date());
    const err = await captureSubscriptionError(lease(ctx, "authAdmin"));
    expect(err.code).toBe("LEASE_BUDGET_EXCEEDED");
  });

  test("5. paid com expiresAt ontem (lazy expired) → SUBSCRIPTION_RESTRICTED", async () => {
    const ctx = await setupCase({ plan: "paid", admin: true, expiresAt: new Date(Date.now() - 86400000) });
    const err = await captureSubscriptionError(lease(ctx, "authAdmin"));
    expect(err.code).toBe("SUBSCRIPTION_RESTRICTED");
  });

  test("6. paid (budget 100, used 80) → reserva min(50,20)=20", async () => {
    const ctx = await setupCase({ plan: "paid", admin: true });
    await seedPastLease(ctx.orgId, ctx.deviceId, 80, new Date());
    const result = await lease(ctx, "authAdmin");
    expect(result.endSeq - result.startSeq + 1).toBe(20);
  });

  test("7. free não repõe: lease antigo (mês passado) continua a contar → LEASE_BUDGET_EXCEEDED", async () => {
    const ctx = await setupCase({ plan: "free", admin: true });
    await seedPastLease(ctx.orgId, ctx.deviceId, 10, new Date(Date.now() - 40 * 86400000));
    const err = await captureSubscriptionError(lease(ctx, "authAdmin"));
    expect(err.code).toBe("LEASE_BUDGET_EXCEEDED");
  });
});
