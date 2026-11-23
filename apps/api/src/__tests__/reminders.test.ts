// apps/api/src/__tests__/reminders.test.ts
import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { db } from "../db";
import { organizations, sectors, users } from "../db/schema";
import { and, eq, inArray, lt } from "drizzle-orm";
import {
  findExpiringTenants, flipExpiredTenants, runRenewalSweep,
} from "../jobs/subscription-reminders";
import { getFreePlan } from "../services/subscription.service";
import { logger } from "../lib/logger";

const DAY = 24 * 60 * 60 * 1000;
const tag = `rem-${Date.now()}`;
const now = new Date("2026-11-23T08:00:00.000Z");
const orgIds: string[] = [];
let freePlanId: string;

async function mkOrg(name: string, daysFromNow: number): Promise<{ id: string; email: string }> {
  const slug = `${name}-${tag}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const [org] = await db.insert(organizations).values({
    name: `${name}-${tag}`, slug, planId: freePlanId,
    subscriptionStatus: "paid",
    subscriptionExpiresAt: new Date(now.getTime() + daysFromNow * DAY),
  }).returning();
  orgIds.push(org.id);
  const email = `${name}-${tag}@t.io`;
  const [sec] = await db.insert(sectors).values({
    tenantId: org.id, name: "S", code: `R${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  }).returning();
  await db.insert(users).values({
    tenantId: org.id, sectorId: sec.id, email, passwordHash: "x", fullName: name,
  });
  return { id: org.id, email };
}

beforeAll(async () => {
  freePlanId = (await getFreePlan()).id;
});

afterAll(async () => {
  if (!orgIds.length) return;
  await db.delete(users).where(inArray(users.tenantId, orgIds));
  await db.delete(sectors).where(inArray(sectors.tenantId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
});

describe("lembretes de renovação", () => {
  test("findExpiringTenants devolve 30/14/2 com contacto do criador, não +7", async () => {
    const d30 = await mkOrg("d30", 30);
    const d14 = await mkOrg("d14", 14);
    const d2 = await mkOrg("d2", 2);
    const d7 = await mkOrg("d7", 7);

    const found = (await findExpiringTenants(now)).filter((r) => orgIds.includes(r.tenantId));
    const byId = new Map(found.map((r) => [r.tenantId, r]));

    expect(byId.get(d30.id)?.daysLeft).toBe(30);
    expect(byId.get(d14.id)?.daysLeft).toBe(14);
    expect(byId.get(d2.id)?.daysLeft).toBe(2);
    expect(byId.has(d7.id)).toBe(false);
    expect(byId.get(d30.id)?.contactEmail).toBe(d30.email);
    expect(byId.get(d14.id)?.contactEmail).toBe(d14.email);
    expect(byId.get(d2.id)?.contactEmail).toBe(d2.email);
  });

  test("flipExpiredTenants passa paid vencido a expired e devolve a contagem", async () => {
    const past = await mkOrg("past", -1);
    const future = await mkOrg("future", 30);

    const flipped = await flipExpiredTenants(now);
    expect(flipped).toBeGreaterThanOrEqual(1);

    const [pastRow] = await db.select({ status: organizations.subscriptionStatus })
      .from(organizations).where(eq(organizations.id, past.id));
    const [futureRow] = await db.select({ status: organizations.subscriptionStatus })
      .from(organizations).where(eq(organizations.id, future.id));
    expect(pastRow.status).toBe("expired");
    expect(futureRow.status).toBe("paid");
  });

  test("runRenewalSweep sem SMTP não lança, conta lembretes/expirações e alerta a provedora", async () => {
    await mkOrg("sw30", 30);
    await mkOrg("sw14", 14);
    await mkOrg("sw2", 2);
    await mkOrg("sw7", 7);
    const today = await mkOrg("swalert", -0.02); // expirou hoje às ~07:31 UTC → daysLeft 0
    await mkOrg("swold", -2); // expirou anteontem → daysLeft -2

    const expectedReminded = (await findExpiringTenants(now)).filter((r) => orgIds.includes(r.tenantId)).length;
    const expectedDue = (await db.select({ id: organizations.id }).from(organizations).where(and(
      inArray(organizations.id, orgIds),
      eq(organizations.subscriptionStatus, "paid"),
      lt(organizations.subscriptionExpiresAt, now),
    ))).length;
    expect(expectedReminded).toBeGreaterThanOrEqual(3);
    expect(expectedDue).toBeGreaterThanOrEqual(2);

    const infoSpy = spyOn(logger, "info");
    let result: { reminded: number; expired: number };
    let alerted = false;
    try {
      result = await runRenewalSweep(now);
      // Prova que o alerta à provedora foi gerado para a org vencida,
      // capturada antes do flip a "expired".
      alerted = infoSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes(today.id)));
    } finally {
      infoSpy.mockRestore();
    }

    expect(result.reminded).toBe(expectedReminded);
    expect(result.expired).toBeGreaterThanOrEqual(expectedDue);
    expect(alerted).toBe(true);
  });

  test("alerta a provedora na execução seguinte mesmo quando o dia UTC já virou", async () => {
    const later = await mkOrg("swlater", 10 / 24); // expira às 18:00 UTC do mesmo dia
    const laterNow = new Date(now.getTime() + 24 * 60 * 60 * 1000); // próxima execução 08:00: daysLeft = -1

    const spyBefore = spyOn(logger, "info");
    let alertedBefore = false;
    try {
      await runRenewalSweep(now); // 08:00: ainda não venceu
      alertedBefore = spyBefore.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes(later.id)));
    } finally {
      spyBefore.mockRestore();
    }
    expect(alertedBefore).toBe(false);
    const [rowBefore] = await db.select({ status: organizations.subscriptionStatus })
      .from(organizations).where(eq(organizations.id, later.id));
    expect(rowBefore.status).toBe("paid");

    const spyAfter = spyOn(logger, "info");
    let alertedAfter = false;
    let sweep: { reminded: number; expired: number };
    try {
      sweep = await runRenewalSweep(laterNow); // dia seguinte: venceu às 18:00 de ontem
      alertedAfter = spyAfter.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes(later.id)));
    } finally {
      spyAfter.mockRestore();
    }
    expect(alertedAfter).toBe(true);
    expect(sweep.expired).toBeGreaterThanOrEqual(1);
    const [rowAfter] = await db.select({ status: organizations.subscriptionStatus })
      .from(organizations).where(eq(organizations.id, later.id));
    expect(rowAfter.status).toBe("expired");
  });
});
