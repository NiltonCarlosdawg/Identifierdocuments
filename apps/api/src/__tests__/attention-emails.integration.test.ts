/**
 * Avisos por e-mail de acções que pedem atenção (migração 0031): com PostgreSQL real,
 * confirma quem recebe cada aviso, as preferências e que a fila aceita os novos tipos.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { emailLogs, organizations, plans, roles, sectors, userRoles, users } from "../db/schema";
import {
  onDeviceRegistered, onIdentifierCancelled, onPasswordChanged, onRoleGranted,
} from "../services/email/tenant-email.service";

const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let orgId: string;
let sectorId: string;
let adminA: string;
let adminB: string;
let member: string;
let mutedMember: string;
let supervisorRoleId: string;

const logsFor = (event: string) => withTenant(orgId, (tx) =>
  tx.select().from(emailLogs).where(and(eq(emailLogs.tenantId, orgId), eq(emailLogs.eventType, event as any))));

beforeAll(async () => {
  const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.isFree, true)).limit(1);
  const [org] = await db.insert(organizations).values({
    name: `AE Org ${tag}`, slug: `ae-${tag}`, identifierPrefix: "AE", planId: plan.id,
  }).returning({ id: organizations.id });
  orgId = org.id;

  await withTenant(orgId, async (tx) => {
    const [sector] = await tx.insert(sectors).values({ tenantId: orgId, name: "Finanças", code: `AE-${tag}` }).returning();
    sectorId = sector.id;
    const mk = async (name: string, prefs: Record<string, unknown> = {}) => (await tx.insert(users).values({
      tenantId: orgId, sectorId, email: `ae-${name}-${tag}@test.com`, passwordHash: "x", fullName: name,
      notificationPreferences: prefs,
    }).returning({ id: users.id }))[0].id;
    adminA = await mk("AdminA");
    adminB = await mk("AdminB");
    member = await mk("Membro");
    mutedMember = await mk("Silencioso", { email: false });
    const [adminRole] = await tx.insert(roles).values({ name: "ORG_ADMIN", tenantId: orgId }).returning();
    const [supRole] = await tx.insert(roles).values({ name: "SECTOR_SUPERVISOR", tenantId: orgId }).returning();
    supervisorRoleId = supRole.id;
    await tx.insert(userRoles).values([{ userId: adminA, roleId: adminRole.id }, { userId: adminB, roleId: adminRole.id }]);
  });
});

afterAll(async () => {
  await withTenant(orgId, async (tx) => {
    await tx.delete(emailLogs).where(eq(emailLogs.tenantId, orgId));
    await tx.delete(userRoles).where(sql`${userRoles.userId} IN (SELECT id FROM ${users} WHERE ${users.tenantId} = ${orgId})`);
    await tx.delete(roles).where(eq(roles.tenantId, orgId));
    await tx.delete(users).where(eq(users.tenantId, orgId));
    await tx.delete(sectors).where(eq(sectors.tenantId, orgId));
  });
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("avisos de acções que pedem atenção", () => {
  test("novo computador: avisa os administradores, menos quem o registou", async () => {
    const n = await withTenant(orgId, (tx) => onDeviceRegistered(tx, {
      tenantId: orgId, deviceId: crypto.randomUUID(), deviceName: "PC-Contabilidade", userId: adminA, ip: "197.149.0.1",
    }));
    expect(n).toBe(1);
    const rows = await logsFor("device_registered");
    expect(rows.map((r) => r.recipientUserId)).toEqual([adminB]);
    expect(rows[0].status).toBe("queued");
    expect(rows[0].subject).toContain("PC-Contabilidade");
  });

  test("identificador anulado: avisa os administradores com o motivo", async () => {
    const n = await withTenant(orgId, (tx) => onIdentifierCancelled(tx, {
      tenantId: orgId, identifier: `AE-FT-${tag}`, userId: member, reason: "Factura emitida em duplicado",
    }));
    expect(n).toBe(2);
    const rows = await logsFor("identifier_cancelled");
    expect(new Set(rows.map((r) => r.recipientUserId))).toEqual(new Set([adminA, adminB]));
    expect(JSON.stringify(rows[0].templateData)).toContain("Factura emitida em duplicado");
  });

  test("password alterada: sai mesmo com os e-mails desligados", async () => {
    const n = await withTenant(orgId, (tx) => onPasswordChanged(tx, { tenantId: orgId, userId: mutedMember, via: "change" }));
    expect(n).toBe(1);
    const rows = await logsFor("password_changed");
    expect(rows[0].recipientUserId).toBe(mutedMember);
  });

  test("nova função: respeita as preferências e não avisa quem se atribui a si próprio", async () => {
    const grant = (userId: string, grantedBy: string) => withTenant(orgId, (tx) => onRoleGranted(tx, {
      tenantId: orgId, userId, roleId: supervisorRoleId, grantedBy, sectorId, userRoleId: crypto.randomUUID(),
    }));
    expect(await grant(member, adminA)).toBe(1);
    expect(await grant(mutedMember, adminA)).toBe(0);
    expect(await grant(adminA, adminA)).toBe(0);
    const rows = await logsFor("role_granted");
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe("Tem uma nova função no DocID: Supervisor de sector");
  });

  test("a chave de dedupe impede o mesmo aviso duas vezes", async () => {
    const deviceId = crypto.randomUUID();
    const send = () => withTenant(orgId, (tx) => onDeviceRegistered(tx, {
      tenantId: orgId, deviceId, deviceName: "PC-Duplicado", userId: member,
    }));
    await send();
    await send();
    const rows = (await logsFor("device_registered")).filter((r) => r.subject.includes("PC-Duplicado"));
    expect(rows).toHaveLength(2); // um por administrador, não quatro
  });
});
