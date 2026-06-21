import { describe, expect, test } from "bun:test";
import { notify } from "../services/notification.service";
import { db } from "../db";
import { notifications } from "../db/schema";
import { eq } from "drizzle-orm";

describe("notification.service", () => {
  test("notify persiste na base de dados", async () => {
    const userId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();

    await notify({
      type: "test:event",
      userId,
      tenantId,
      payload: { foo: "bar" },
    });

    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe("test:event");
    expect(JSON.parse(rows[0].payload).foo).toBe("bar");

    await db.delete(notifications).where(eq(notifications.userId, userId));
  });
});
