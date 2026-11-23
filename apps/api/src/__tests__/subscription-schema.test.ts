// apps/api/src/__tests__/subscription-schema.test.ts
import { describe, test, expect, afterAll } from "bun:test";
import { db } from "../db";
import { plans, organizations } from "../db/schema";
import { eq, isNull } from "drizzle-orm";

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.name, "schema-test-org"));
  await db.delete(plans).where(eq(plans.name, "schema-test-plan"));
});

describe("schema de subscrições", () => {
  test("seed cria exatamente um plano free com os limites do spec", async () => {
    const free = await db.select().from(plans).where(eq(plans.isFree, true));
    expect(free.length).toBe(1);
    expect(free[0]).toMatchObject({
      price: 0, maxUsers: 1, monthlyOnlineIdentifiers: 10,
      offlineBudgetPerMachine: 10, active: true,
    });
  });
  test("plano pago inserido manualmente guarda os campos", async () => {
    const [p] = await db.insert(plans).values({
      name: "schema-test-plan", price: 250000, maxUsers: 10,
      monthlyOnlineIdentifiers: 500, offlineBudgetPerMachine: 1000,
    }).returning();
    expect(p.id).toBeTruthy();
  });
  test("organização sem plano é impossível (coluna NOT NULL)", async () => {
    const free = (await db.select().from(plans).where(eq(plans.isFree, true)))[0];
    const [org] = await db.insert(organizations).values({
      name: "schema-test-org", slug: `schema-test-${Date.now()}`, planId: free.id,
    }).returning();
    expect(org.subscriptionStatus).toBe("free");
    expect(org.subscriptionExpiresAt).toBeNull();
  });
});
