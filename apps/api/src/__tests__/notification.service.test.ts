import { describe, expect, test } from "bun:test";
import { notify } from "../services/notification.service";
import { db } from "../db";
import { notifications, organizations, users, sectors } from "../db/schema";
import { eq } from "drizzle-orm";

describe("notification.service", () => {
  test("notify persiste na base de dados", async () => {
    const [org] = await db.insert(organizations).values({
      name: "Test Org Notify",
      slug: `test-notify-${Date.now()}`,
    }).returning({ id: organizations.id });

    const [sector] = await db.insert(sectors).values({
      tenantId: org.id,
      name: "Test Sector",
      code: `TST-${Date.now()}`,
    }).returning({ id: sectors.id });

    const [user] = await db.insert(users).values({
      tenantId: org.id,
      sectorId: sector.id,
      email: `notify-${Date.now()}@test.docid`,
      passwordHash: "hash",
      fullName: "Test User",
    }).returning({ id: users.id });

    await notify(db, {
      type: "test:event",
      userId: user.id,
      tenantId: org.id,
      payload: { foo: "bar" },
    });

    const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id));
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe("test:event");
    expect(JSON.parse(rows[0].payload).foo).toBe("bar");

    await db.delete(notifications).where(eq(notifications.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
    await db.delete(sectors).where(eq(sectors.id, sector.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  });
});
