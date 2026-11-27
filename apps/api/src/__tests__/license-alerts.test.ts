/** Avisos de licença aos administradores (verificação diária). Regra pura + PostgreSQL real. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { emailLogs, organizations, plans, roles, userRoles, users } from "../db/schema";
import { licenseMilestone, milestoneKey, runLicenseAlerts } from "../jobs/license-alerts";

const DAY = 24 * 3600 * 1000;
const now = new Date("2026-12-01T08:00:00Z");
const lic = (days: number, status = "active") => ({ licenseValidUntil: new Date(now.getTime() + days * DAY), licenseStatus: status });

describe("momento do aviso de licença", () => {
  test("faltam 14, 7, 3 e 1 dias (≤, para não perder um aviso se a verificação falhar um dia)", () => {
    expect(licenseMilestone(lic(20), now, 7)).toBeNull();
    expect(milestoneKey(licenseMilestone(lic(14), now, 7)!)).toBe("expiring-14");
    expect(milestoneKey(licenseMilestone(lic(10), now, 7)!)).toBe("expiring-14");
    expect(milestoneKey(licenseMilestone(lic(5), now, 7)!)).toBe("expiring-7");
    expect(milestoneKey(licenseMilestone(lic(2), now, 7)!)).toBe("expiring-3");
    expect(milestoneKey(licenseMilestone(lic(0.5), now, 7)!)).toBe("expiring-1");
  });
  test("tolerância, último dia e só consulta", () => {
    expect(licenseMilestone(lic(-1), now, 7)?.kind).toBe("grace");
    expect(licenseMilestone(lic(-6.5), now, 7)?.kind).toBe("grace_last");
    expect(licenseMilestone(lic(-8), now, 7)?.kind).toBe("read_only");
    expect(licenseMilestone(lic(-60), now, 7)).toBeNull(); // organização abandonada: não insistir
  });
  test("sem prazo ou suspensa pela provedora: sem aviso", () => {
    expect(licenseMilestone({ licenseValidUntil: null, licenseStatus: "active" }, now, 7)).toBeNull();
    expect(licenseMilestone(lic(2, "suspended"), now, 7)).toBeNull();
  });
});

describe("runLicenseAlerts com PostgreSQL", () => {
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const orgIds: string[] = [];
  let soon: string, mutedAdmin: string;

  const mkOrg = async (name: string, validUntil: Date | null) => {
    const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.isFree, true)).limit(1);
    const [org] = await db.insert(organizations).values({
      name: `LA ${name} ${tag}`, slug: `la-${name}-${tag}`, identifierPrefix: "LA", planId: plan.id,
      licenseValidUntil: validUntil, licenseStatus: "active",
    }).returning({ id: organizations.id });
    orgIds.push(org.id);
    return org.id;
  };
  const mkAdmin = (tenantId: string, n: string, prefs: Record<string, unknown> = {}) => withTenant(tenantId, async (tx) => {
    const [u] = await tx.insert(users).values({ tenantId, email: `la-${n}-${tag}@test.com`, passwordHash: "x", fullName: n, notificationPreferences: prefs }).returning();
    let [role] = await tx.select().from(roles).where(and(eq(roles.name, "ORG_ADMIN"), eq(roles.tenantId, tenantId)));
    if (!role) [role] = await tx.insert(roles).values({ name: "ORG_ADMIN", tenantId }).returning();
    await tx.insert(userRoles).values({ userId: u.id, roleId: role.id });
    return u.id;
  });
  const logs = (tenantId: string) => withTenant(tenantId, (tx) =>
    tx.select().from(emailLogs).where(and(eq(emailLogs.tenantId, tenantId), eq(emailLogs.eventType, "license_alert"))));

  beforeAll(async () => {
    soon = await mkOrg("soon", new Date(now.getTime() + 5 * DAY));
    await mkAdmin(soon, "a1");
    mutedAdmin = await mkAdmin(soon, "a2", { email: false }); // obrigatório: recebe na mesma
    await mkOrg("far", new Date(now.getTime() + 90 * DAY));
  });

  afterAll(async () => {
    for (const id of orgIds) {
      await withTenant(id, async (tx) => {
        await tx.delete(emailLogs).where(eq(emailLogs.tenantId, id));
        await tx.delete(userRoles).where(sql`${userRoles.userId} IN (SELECT id FROM ${users} WHERE ${users.tenantId} = ${id})`);
        await tx.delete(roles).where(eq(roles.tenantId, id));
        await tx.delete(users).where(eq(users.tenantId, id));
      });
      await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  test("avisa todos os administradores uma vez por momento", async () => {
    await runLicenseAlerts(now);
    const first = await logs(soon);
    expect(first).toHaveLength(2);
    expect(first.map((r) => r.recipientUserId)).toContain(mutedAdmin);
    expect(first[0].subject).toBe("A licença do DocID termina daqui a 5 dias");

    await runLicenseAlerts(new Date(now.getTime() + 3600_000)); // nova execução, mesmo momento
    expect(await logs(soon)).toHaveLength(2);

    await runLicenseAlerts(new Date(now.getTime() + 3 * DAY)); // faltam 2 dias → momento "3"
    const after = await logs(soon);
    expect(after).toHaveLength(4);
    expect(after.some((r) => r.subject === "A licença do DocID termina daqui a 2 dias")).toBe(true);
  });

  test("organização com licença longa não recebe nada", async () => {
    expect(await logs(orgIds[1])).toHaveLength(0);
  });
});
