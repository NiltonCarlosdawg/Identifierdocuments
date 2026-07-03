import { db } from "../../src/db";
import { organizations, sectors, users, identifiers, notifications, categories } from "../../src/db/schema";
import { eq, sql } from "drizzle-orm";
import { signToken } from "../../src/middleware/auth";

const TAG = Date.now().toString(36);

export interface TenantSeed {
  org: { id: string; slug: string };
  sector: { id: string };
  user: { id: string; email: string };
  token: string;
}

export async function seedTenants(): Promise<TenantSeed[]> {
  const cats = await db.select({ id: categories.id }).from(categories).limit(5);
  if (cats.length === 0) throw new Error("Nenhuma categoria encontrada — seed necessário primeiro");
  const catId = cats[0].id;

  const tenants: TenantSeed[] = [];

  for (const letter of ["a", "b", "c"]) {
    const tag = `${TAG}-${letter}`;

    const [org] = await db.insert(organizations).values({
      name: `LoadTest Org ${letter} ${TAG}`,
      slug: `loadtest-${letter}-${TAG}`,
    }).returning({ id: organizations.id, slug: organizations.slug });

    const [sector] = await db.insert(sectors).values({
      tenantId: org.id, name: `Sector ${letter}`, code: `SEC-${tag.toUpperCase()}`,
    }).returning({ id: sectors.id });

    const email = `loadtest-${tag}@test.com`;
    const passwordHash = await Bun.password.hash("password123");
    const [user] = await db.insert(users).values({
      tenantId: org.id, sectorId: sector.id, email,
      passwordHash, fullName: `LoadTest User ${letter}`,
      isActive: true,
    }).returning({ id: users.id, email: users.email });

    for (let i = 0; i < 5; i++) {
      await db.insert(identifiers).values({
        tenantId: org.id, sectorId: sector.id, categoryId: catId,
        identifier: `LDT-${tag}-${i}`, sequence: i + 1, createdBy: user.id,
        status: "active",
      });

      await db.insert(notifications).values({
        tenantId: org.id, userId: user.id,
        type: "loadtest:seed",
        payload: JSON.stringify({ tenant: `org-${letter}`, tag }),
      });
    }

    const token = await signToken({
      userId: user.id, tenantId: org.id,
      sectorId: sector.id, roles: ["ORG_ADMIN"],
    });

    tenants.push({ org: { id: org.id, slug: org.slug }, sector: { id: sector.id }, user: { id: user.id, email }, token });
  }

  return tenants;
}

export async function cleanupTenants(tenants: TenantSeed[]): Promise<void> {
  for (const t of tenants) {
    await db.delete(notifications).where(eq(notifications.tenantId, t.org.id));
    await db.delete(identifiers).where(eq(identifiers.tenantId, t.org.id));
    await db.delete(users).where(eq(users.tenantId, t.org.id));
    await db.delete(sectors).where(eq(sectors.tenantId, t.org.id));
    await db.delete(organizations).where(eq(organizations.id, t.org.id));
  }
}
