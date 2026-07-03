import { describe, expect, test } from "bun:test";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { organizations, sectors, users, identifiers, notifications, categories } from "../db/schema";
import { eq, sql } from "drizzle-orm";

const rng = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

describe("withTenant — isolamento entre tenants", () => {
  const tagA = rng();
  const tagB = rng();
  const catId = `TST-${rng()}`;

  test("setup: criar dois tenants com dados isolados", async () => {
    await db.insert(categories).values({
      id: catId, name: "Test Category", group: "Test", prefix: catId,
    });

    const [orgA] = await db.insert(organizations).values({
      name: `Tenant A ${tagA}`, slug: `tenant-a-${tagA}`,
    }).returning({ id: organizations.id });

    const [orgB] = await db.insert(organizations).values({
      name: `Tenant B ${tagB}`, slug: `tenant-b-${tagB}`,
    }).returning({ id: organizations.id });

    expect(orgA.id).toBeTruthy();
    expect(orgB.id).toBeTruthy();

    await withTenant(orgA.id, async (tx) => {
      const [sector] = await tx.insert(sectors).values({
        tenantId: orgA.id, name: "Sector A", code: `SEC-A-${tagA}`,
      }).returning({ id: sectors.id });

      const [user] = await tx.insert(users).values({
        tenantId: orgA.id, sectorId: sector.id,
        email: `user-a-${tagA}@test.com`, passwordHash: "hash", fullName: "User A",
      }).returning({ id: users.id });

      await tx.insert(identifiers).values({
        tenantId: orgA.id, sectorId: sector.id, categoryId: catId,
        identifier: `ID-A-${tagA}`, sequence: 1, createdBy: user.id,
      });

      await tx.insert(notifications).values({
        tenantId: orgA.id, userId: user.id, type: "test:a",
        payload: JSON.stringify({ secret: "dados-do-tenant-A", tag: tagA }),
      });
    });

    await withTenant(orgB.id, async (tx) => {
      const [sector] = await tx.insert(sectors).values({
        tenantId: orgB.id, name: "Sector B", code: `SEC-B-${tagB}`,
      }).returning({ id: sectors.id });

      const [user] = await tx.insert(users).values({
        tenantId: orgB.id, sectorId: sector.id,
        email: `user-b-${tagB}@test.com`, passwordHash: "hash", fullName: "User B",
      }).returning({ id: users.id });

      await tx.insert(identifiers).values({
        tenantId: orgB.id, sectorId: sector.id, categoryId: catId,
        identifier: `ID-B-${tagB}`, sequence: 1, createdBy: user.id,
      });

      await tx.insert(notifications).values({
        tenantId: orgB.id, userId: user.id, type: "test:b",
        payload: JSON.stringify({ secret: "dados-do-tenant-B", tag: tagB }),
      });
    });
  });

  test("cada tenant vê apenas os seus próprios sectores", async () => {
    const [orgA] = await db.select({ id: organizations.id })
      .from(organizations).where(eq(organizations.slug, `tenant-a-${tagA}`));
    const [orgB] = await db.select({ id: organizations.id })
      .from(organizations).where(eq(organizations.slug, `tenant-b-${tagB}`));

    const [sectorsA, sectorsB] = await Promise.all([
      withTenant(orgA.id, (tx) => tx.select().from(sectors).where(eq(sectors.tenantId, orgA.id))),
      withTenant(orgB.id, (tx) => tx.select().from(sectors).where(eq(sectors.tenantId, orgB.id))),
    ]);

    expect(sectorsA).toHaveLength(1);
    expect(sectorsA[0].name).toBe("Sector A");
    expect(sectorsB).toHaveLength(1);
    expect(sectorsB[0].name).toBe("Sector B");
  });

  test("cada tenant vê apenas as suas próprias notificações", async () => {
    const [orgA] = await db.select({ id: organizations.id })
      .from(organizations).where(eq(organizations.slug, `tenant-a-${tagA}`));
    const [orgB] = await db.select({ id: organizations.id })
      .from(organizations).where(eq(organizations.slug, `tenant-b-${tagB}`));

    const [notesA, notesB] = await Promise.all([
      withTenant(orgA.id, (tx) => tx.select().from(notifications).where(eq(notifications.tenantId, orgA.id))),
      withTenant(orgB.id, (tx) => tx.select().from(notifications).where(eq(notifications.tenantId, orgB.id))),
    ]);

    notesA.forEach((n) => {
      expect(JSON.parse(n.payload).secret).toBe("dados-do-tenant-A");
    });
    notesB.forEach((n) => {
      expect(JSON.parse(n.payload).secret).toBe("dados-do-tenant-B");
    });

    const secretsA = notesA.map((n) => JSON.parse(n.payload).secret);
    const secretsB = notesB.map((n) => JSON.parse(n.payload).secret);

    expect(secretsA).not.toContain("dados-do-tenant-B");
    expect(secretsB).not.toContain("dados-do-tenant-A");
  });

  test("paralelismo: queries simultâneas com filtro tenantId não se misturam", async () => {
    const [orgA] = await db.select({ id: organizations.id })
      .from(organizations).where(eq(organizations.slug, `tenant-a-${tagA}`));
    const [orgB] = await db.select({ id: organizations.id })
      .from(organizations).where(eq(organizations.slug, `tenant-b-${tagB}`));

    const [idsA, idsB] = await Promise.all([
      withTenant(orgA.id, (tx) =>
        tx.select({ id: identifiers.id, identifier: identifiers.identifier })
          .from(identifiers).where(eq(identifiers.tenantId, orgA.id))),
      withTenant(orgB.id, (tx) =>
        tx.select({ id: identifiers.id, identifier: identifiers.identifier })
          .from(identifiers).where(eq(identifiers.tenantId, orgB.id))),
    ]);

    expect(idsA).toHaveLength(1);
    expect(idsA[0].identifier).toContain("ID-A");
    expect(idsB).toHaveLength(1);
    expect(idsB[0].identifier).toContain("ID-B");
  });

  test("SET LOCAL é revertido após fim da transacção", async () => {
    const [orgA] = await db.select({ id: organizations.id })
      .from(organizations).where(eq(organizations.slug, `tenant-a-${tagA}`));

    await withTenant(orgA.id, async (tx) => {
      const a = await tx.select().from(sectors).where(eq(sectors.tenantId, orgA.id));
      expect(a.length).toBeGreaterThanOrEqual(1);
    });

    const allSectors = await db.select({ count: sql<number>`count(*)::int` }).from(sectors);
    expect(allSectors[0].count).toBeGreaterThanOrEqual(2);
  });

  test("cleanup: remover dados de teste", async () => {
    const tenants = await db.select({ id: organizations.id })
      .from(organizations)
      .where(sql`slug IN (${`tenant-a-${tagA}`}, ${`tenant-b-${tagB}`})`);

    for (const t of tenants) {
      await db.delete(notifications).where(eq(notifications.tenantId, t.id));
      await db.delete(identifiers).where(eq(identifiers.tenantId, t.id));
      await db.delete(users).where(eq(users.tenantId, t.id));
      await db.delete(sectors).where(eq(sectors.tenantId, t.id));
    }
    await db.delete(organizations).where(sql`slug IN (${`tenant-a-${tagA}`}, ${`tenant-b-${tagB}`})`);
    await db.delete(categories).where(eq(categories.id, catId));
  });
});
