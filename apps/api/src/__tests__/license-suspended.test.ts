/** Suspensão de licença pela plataforma (PATCH /platform/licenses/:n): avisa os administradores uma vez. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";

process.env.PLATFORM_ADMIN_TOKEN = "t".repeat(40);

import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { emailLogs, licenses, organizations, plans, roles, userRoles, users } from "../db/schema";
import { issueLicense, trialLicenseInput } from "../services/license.service";
import { platformModule } from "../modules/platform.module";

const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let orgId = "";
let adminId = "";
let licenseNumber = "";

const patch = (body: Record<string, unknown>) => platformModule.handle(new Request(`http://localhost/platform/licenses/${encodeURIComponent(licenseNumber)}`, {
  method: "PATCH",
  headers: { "content-type": "application/json", "x-platform-admin-token": process.env.PLATFORM_ADMIN_TOKEN! },
  body: JSON.stringify(body),
}));
const mails = () => withTenant(orgId, (tx) => tx.select().from(emailLogs)
  .where(and(eq(emailLogs.tenantId, orgId), eq(emailLogs.eventType, "license_alert"))));

beforeAll(async () => {
  const [plan] = await db.select().from(plans).where(eq(plans.isFree, true)).limit(1);
  const [org] = await db.insert(organizations).values({
    name: `LS ${tag}`, slug: `ls-${tag}`, identifierPrefix: "LS", planId: plan.id,
  }).returning({ id: organizations.id });
  orgId = org.id;
  await withTenant(orgId, async (tx) => {
    await issueLicense(tx, trialLicenseInput(orgId, plan));
    const [u] = await tx.insert(users).values({ tenantId: orgId, email: `ls-${tag}@test.com`, passwordHash: "x", fullName: "Admin LS" }).returning();
    adminId = u.id;
    const [role] = await tx.insert(roles).values({ name: "ORG_ADMIN", tenantId: orgId }).returning();
    await tx.insert(userRoles).values({ userId: u.id, roleId: role.id });
  });
  const [row] = await db.select({ n: organizations.licenseNumber }).from(organizations).where(eq(organizations.id, orgId));
  licenseNumber = row.n!;
});

afterAll(async () => {
  await withTenant(orgId, async (tx) => {
    await tx.delete(emailLogs).where(eq(emailLogs.tenantId, orgId));
    await tx.execute(sql`DELETE FROM audit_logs WHERE tenant_id = ${orgId}`);
    await tx.delete(userRoles).where(eq(userRoles.userId, adminId));
    await tx.delete(roles).where(eq(roles.tenantId, orgId));
    await tx.delete(users).where(eq(users.tenantId, orgId));
    await tx.delete(licenses).where(eq(licenses.tenantId, orgId));
  });
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("licença suspensa pela plataforma", () => {
  test("avisa os administradores na passagem para suspensa, e só uma vez", async () => {
    expect(licenseNumber).toBeTruthy();
    const r1 = await patch({ status: "suspended" });
    expect(r1.status).toBe(200);
    let m = await mails();
    expect(m.map((x) => x.recipientUserId)).toEqual([adminId]);
    expect(m[0].subject).toBe("A licença do DocID foi suspensa");

    expect((await patch({ status: "suspended" })).status).toBe(200); // de novo: já estava suspensa
    expect(await mails()).toHaveLength(1);

    expect((await patch({ extendDays: 30 })).status).toBe(200); // outra alteração qualquer
    expect(await mails()).toHaveLength(1);
  });
});
