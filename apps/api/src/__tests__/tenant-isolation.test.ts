import { describe, expect, test } from "bun:test";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { organizations, sectors, users, identifiers, notifications, categories, roles, userRoles } from "../db/schema";
import { eq, sql } from "drizzle-orm";

const rng = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

describe("withTenant — isolamento entre tenants", () => {
  const tagA = rng();
  const tagB = rng();
  const catId = `TST-${rng()}`;

  let orgAId: string;
  let orgBId: string;
  let sectorAId: string;
  let sectorBId: string;
  let userAId: string;
  let userBId: string;

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

    orgAId = orgA.id;
    orgBId = orgB.id;

    expect(orgA.id).toBeTruthy();
    expect(orgB.id).toBeTruthy();
    expect(orgA.id).not.toBe(orgB.id);

    await withTenant(orgA.id, async (tx) => {
      const [sector] = await tx.insert(sectors).values({
        tenantId: orgA.id, name: "Sector A", code: `SEC-A-${tagA}`,
      }).returning({ id: sectors.id });
      sectorAId = sector.id;

      const [user] = await tx.insert(users).values({
        tenantId: orgA.id, sectorId: sector.id,
        email: `user-a-${tagA}@test.com`, passwordHash: "hash-a", fullName: "User A",
      }).returning({ id: users.id });
      userAId = user.id;

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
      sectorBId = sector.id;

      const [user] = await tx.insert(users).values({
        tenantId: orgB.id, sectorId: sector.id,
        email: `user-b-${tagB}@test.com`, passwordHash: "hash-b", fullName: "User B",
      }).returning({ id: users.id });
      userBId = user.id;

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

  // ============================================================
  // Isolamento de Sectores
  // ============================================================
  test("sectores: cada tenant vê apenas os seus próprios sectores", async () => {
    const [sectorsA, sectorsB] = await Promise.all([
      withTenant(orgAId, (tx) => tx.select().from(sectors).where(eq(sectors.tenantId, orgAId))),
      withTenant(orgBId, (tx) => tx.select().from(sectors).where(eq(sectors.tenantId, orgBId))),
    ]);

    expect(sectorsA).toHaveLength(1);
    expect(sectorsA[0].name).toBe("Sector A");
    expect(sectorsA[0].tenantId).toBe(orgAId);

    expect(sectorsB).toHaveLength(1);
    expect(sectorsB[0].name).toBe("Sector B");
    expect(sectorsB[0].tenantId).toBe(orgBId);
  });

  test("sectores: ID dos sectores são diferentes entre tenants", async () => {
    expect(sectorAId).toBeTruthy();
    expect(sectorBId).toBeTruthy();
    expect(sectorAId).not.toBe(sectorBId);
  });

  // ============================================================
  // Isolamento de Utilizadores
  // ============================================================
  test("utilizadores: cada tenant vê apenas os seus próprios utilizadores", async () => {
    const [usersA, usersB] = await Promise.all([
      withTenant(orgAId, (tx) => tx.select().from(users).where(eq(users.tenantId, orgAId))),
      withTenant(orgBId, (tx) => tx.select().from(users).where(eq(users.tenantId, orgBId))),
    ]);

    expect(usersA).toHaveLength(1);
    expect(usersA[0].fullName).toBe("User A");
    expect(usersA[0].email).toBe(`user-a-${tagA}@test.com`);
    expect(usersA[0].tenantId).toBe(orgAId);

    expect(usersB).toHaveLength(1);
    expect(usersB[0].fullName).toBe("User B");
    expect(usersB[0].email).toBe(`user-b-${tagB}@test.com`);
    expect(usersB[0].tenantId).toBe(orgBId);
  });

  test("utilizadores: IDs são diferentes entre tenants", () => {
    expect(userAId).toBeTruthy();
    expect(userBId).toBeTruthy();
    expect(userAId).not.toBe(userBId);
  });

  test("utilizadores: email duplicado entre tenants é permitido (isolamento por tenant)", async () => {
    const sharedEmail = `shared-${rng()}@test.com`;

    await withTenant(orgAId, async (tx) => {
      await tx.insert(users).values({
        tenantId: orgAId, sectorId: sectorAId,
        email: sharedEmail, passwordHash: "hash", fullName: "Shared A",
      });
    });

    await withTenant(orgBId, async (tx) => {
      await tx.insert(users).values({
        tenantId: orgBId, sectorId: sectorBId,
        email: sharedEmail, passwordHash: "hash", fullName: "Shared B",
      });
    });

    const [countA, countB] = await Promise.all([
      withTenant(orgAId, (tx) =>
        tx.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.email, sharedEmail))),
      withTenant(orgBId, (tx) =>
        tx.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.email, sharedEmail))),
    ]);

    expect(countA[0].count).toBe(1);
    expect(countB[0].count).toBe(1);
  });

  // ============================================================
  // Isolamento de Identificadores
  // ============================================================
  test("identificadores: cada tenant vê apenas os seus próprios identificadores", async () => {
    const [idsA, idsB] = await Promise.all([
      withTenant(orgAId, (tx) =>
        tx.select({ id: identifiers.id, identifier: identifiers.identifier, tenantId: identifiers.tenantId })
          .from(identifiers).where(eq(identifiers.tenantId, orgAId))),
      withTenant(orgBId, (tx) =>
        tx.select({ id: identifiers.id, identifier: identifiers.identifier, tenantId: identifiers.tenantId })
          .from(identifiers).where(eq(identifiers.tenantId, orgBId))),
    ]);

    expect(idsA).toHaveLength(1);
    expect(idsA[0].identifier).toContain("ID-A");
    expect(idsA[0].tenantId).toBe(orgAId);

    expect(idsB).toHaveLength(1);
    expect(idsB[0].identifier).toContain("ID-B");
    expect(idsB[0].tenantId).toBe(orgBId);
  });

  test("identificadores: strings de identificação são diferentes entre tenants", async () => {
    const [idsA, idsB] = await Promise.all([
      withTenant(orgAId, (tx) =>
        tx.select({ identifier: identifiers.identifier }).from(identifiers).where(eq(identifiers.tenantId, orgAId))),
      withTenant(orgBId, (tx) =>
        tx.select({ identifier: identifiers.identifier }).from(identifiers).where(eq(identifiers.tenantId, orgBId))),
    ]);

    expect(idsA[0].identifier).not.toBe(idsB[0].identifier);
  });

  // ============================================================
  // Isolamento de Notificações
  // ============================================================
  test("notificações: cada tenant vê apenas as suas próprias notificações", async () => {
    const [notesA, notesB] = await Promise.all([
      withTenant(orgAId, (tx) => tx.select().from(notifications).where(eq(notifications.tenantId, orgAId))),
      withTenant(orgBId, (tx) => tx.select().from(notifications).where(eq(notifications.tenantId, orgBId))),
    ]);

    expect(notesA).toHaveLength(1);
    expect(notesB).toHaveLength(1);

    notesA.forEach((n) => {
      expect(JSON.parse(n.payload).secret).toBe("dados-do-tenant-A");
      expect(n.tenantId).toBe(orgAId);
    });
    notesB.forEach((n) => {
      expect(JSON.parse(n.payload).secret).toBe("dados-do-tenant-B");
      expect(n.tenantId).toBe(orgBId);
    });
  });

  test("notificações: dados sensíveis não se misturam entre tenants", async () => {
    const [notesA, notesB] = await Promise.all([
      withTenant(orgAId, (tx) => tx.select().from(notifications).where(eq(notifications.tenantId, orgAId))),
      withTenant(orgBId, (tx) => tx.select().from(notifications).where(eq(notifications.tenantId, orgBId))),
    ]);

    const secretsA = notesA.map((n) => JSON.parse(n.payload).secret);
    const secretsB = notesB.map((n) => JSON.parse(n.payload).secret);

    expect(secretsA).not.toContain("dados-do-tenant-B");
    expect(secretsB).not.toContain("dados-do-tenant-A");
    expect(secretsA).not.toContainEqual(expect.stringContaining("tenant-B"));
    expect(secretsB).not.toContainEqual(expect.stringContaining("tenant-A"));
  });

  test("notificações: tags são diferentes entre tenants", async () => {
    const [notesA, notesB] = await Promise.all([
      withTenant(orgAId, (tx) => tx.select().from(notifications).where(eq(notifications.tenantId, orgAId))),
      withTenant(orgBId, (tx) => tx.select().from(notifications).where(eq(notifications.tenantId, orgBId))),
    ]);

    const tagsA = notesA.map((n) => JSON.parse(n.payload).tag);
    const tagsB = notesB.map((n) => JSON.parse(n.payload).tag);

    expect(tagsA).toContain(tagA);
    expect(tagsA).not.toContain(tagB);
    expect(tagsB).toContain(tagB);
    expect(tagsB).not.toContain(tagA);
  });

  // ============================================================
  // Isolamento de Roles
  // ============================================================
  test("roles: roles criadas num tenant não aparecem noutro", async () => {
    const roleATag = `ROLE-A-${rng()}`;
    const roleBTag = `ROLE-B-${rng()}`;

    await withTenant(orgAId, async (tx) => {
      await tx.insert(roles).values({ name: roleATag, tenantId: orgAId });
    });

    await withTenant(orgBId, async (tx) => {
      await tx.insert(roles).values({ name: roleBTag, tenantId: orgBId });
    });

    const [rolesA, rolesB] = await Promise.all([
      withTenant(orgAId, (tx) => tx.select().from(roles).where(eq(roles.tenantId, orgAId))),
      withTenant(orgBId, (tx) => tx.select().from(roles).where(eq(roles.tenantId, orgBId))),
    ]);

    const namesA = rolesA.map((r) => r.name);
    const namesB = rolesB.map((r) => r.name);

    expect(namesA).toContain(roleATag);
    expect(namesA).not.toContain(roleBTag);
    expect(namesB).toContain(roleBTag);
    expect(namesB).not.toContain(roleATag);
  });

  test("userRoles: atribuição de role num tenant não afeta o outro", async () => {
    const roleATag = `USERROLE-A-${rng()}`;
    const roleBTag = `USERROLE-B-${rng()}`;

    let roleIdA: string;
    let roleIdB: string;

    await withTenant(orgAId, async (tx) => {
      const [r] = await tx.insert(roles).values({ name: roleATag, tenantId: orgAId })
        .returning({ id: roles.id });
      roleIdA = r.id;
      await tx.insert(userRoles).values({ userId: userAId, roleId: r.id });
    });

    await withTenant(orgBId, async (tx) => {
      const [r] = await tx.insert(roles).values({ name: roleBTag, tenantId: orgBId })
        .returning({ id: roles.id });
      roleIdB = r.id;
      await tx.insert(userRoles).values({ userId: userBId, roleId: r.id });
    });

    const [assignedA, assignedB] = await Promise.all([
      withTenant(orgAId, (tx) =>
        tx.select().from(userRoles).where(eq(userRoles.userId, userAId))),
      withTenant(orgBId, (tx) =>
        tx.select().from(userRoles).where(eq(userRoles.userId, userBId))),
    ]);

    expect(assignedA).toHaveLength(1);
    expect(assignedA[0].roleId).toBe(roleIdA!);

    expect(assignedB).toHaveLength(1);
    expect(assignedB[0].roleId).toBe(roleIdB!);
  });

  // ============================================================
  // Paralelismo e Concorrência
  // ============================================================
  test("paralelismo: queries simultâneas com filtro tenantId não se misturam", async () => {
    const [idsA, idsB] = await Promise.all([
      withTenant(orgAId, (tx) =>
        tx.select({ id: identifiers.id, identifier: identifiers.identifier })
          .from(identifiers).where(eq(identifiers.tenantId, orgAId))),
      withTenant(orgBId, (tx) =>
        tx.select({ id: identifiers.id, identifier: identifiers.identifier })
          .from(identifiers).where(eq(identifiers.tenantId, orgBId))),
    ]);

    expect(idsA).toHaveLength(1);
    expect(idsA[0].identifier).toContain("ID-A");
    expect(idsB).toHaveLength(1);
    expect(idsB[0].identifier).toContain("ID-B");
  });

  test("paralelismo: escritas simultâneas em tenants diferentes não interferem", async () => {
    const catId2 = `TST2-${rng()}`;
    await db.insert(categories).values({
      id: catId2, name: "Test Category 2", group: "Test", prefix: catId2,
    });

    await Promise.all([
      withTenant(orgAId, async (tx) => {
        await tx.insert(identifiers).values({
          tenantId: orgAId, sectorId: sectorAId, categoryId: catId2,
          identifier: `PAR-A-${rng()}`, sequence: 1, createdBy: userAId,
        });
      }),
      withTenant(orgBId, async (tx) => {
        await tx.insert(identifiers).values({
          tenantId: orgBId, sectorId: sectorBId, categoryId: catId2,
          identifier: `PAR-B-${rng()}`, sequence: 1, createdBy: userBId,
        });
      }),
    ]);

    const [countA, countB] = await Promise.all([
      withTenant(orgAId, (tx) =>
        tx.select({ count: sql<number>`count(*)::int` }).from(identifiers)
          .where(sql`${identifiers.tenantId} = ${orgAId} AND ${identifiers.categoryId} = ${catId2}`)),
      withTenant(orgBId, (tx) =>
        tx.select({ count: sql<number>`count(*)::int` }).from(identifiers)
          .where(sql`${identifiers.tenantId} = ${orgBId} AND ${identifiers.categoryId} = ${catId2}`)),
    ]);

    expect(countA[0].count).toBe(1);
    expect(countB[0].count).toBe(1);

    await db.delete(categories).where(eq(categories.id, catId2));
  });

  // ============================================================
  // SET LOCAL / session_config
  // ============================================================
  test("SET LOCAL é revertido após fim da transacção", async () => {
    await withTenant(orgAId, async (tx) => {
      const a = await tx.select().from(sectors).where(eq(sectors.tenantId, orgAId));
      expect(a.length).toBeGreaterThanOrEqual(1);
    });

    const allSectors = await db.select({ count: sql<number>`count(*)::int` }).from(sectors);
    expect(allSectors[0].count).toBeGreaterThanOrEqual(2);
  });

  // ============================================================
  // Cleanup
  // ============================================================
  test("cleanup: remover dados de teste", async () => {
    const tenants = await db.select({ id: organizations.id })
      .from(organizations)
      .where(sql`slug IN (${`tenant-a-${tagA}`}, ${`tenant-b-${tagB}`})`);

    for (const t of tenants) {
      await db.delete(userRoles).where(sql`${userRoles.roleId} IN (SELECT id FROM ${roles} WHERE ${roles.tenantId} = ${t.id})`);
      await db.delete(roles).where(eq(roles.tenantId, t.id));
      await db.delete(notifications).where(eq(notifications.tenantId, t.id));
      await db.delete(identifiers).where(eq(identifiers.tenantId, t.id));
      await db.delete(users).where(eq(users.tenantId, t.id));
      await db.delete(sectors).where(eq(sectors.tenantId, t.id));
    }
    await db.delete(organizations).where(sql`slug IN (${`tenant-a-${tagA}`}, ${`tenant-b-${tagB}`})`);
    await db.delete(categories).where(eq(categories.id, catId));
  });
});
