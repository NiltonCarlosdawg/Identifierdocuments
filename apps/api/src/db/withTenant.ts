import { db } from "./index";
import { sql } from "drizzle-orm";
import type { DB } from "./index";

export async function withTenant<T>(tenantId: string, fn: (tx: DB) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
    return fn(tx as unknown as DB);
  });
}
