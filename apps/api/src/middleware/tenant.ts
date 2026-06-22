import { Elysia } from "elysia";
import { db } from "../db";
import { sql } from "drizzle-orm";

export const tenantMiddleware = new Elysia()
  .onBeforeHandle({ as: "global" }, async (ctx: any) => {
    if (ctx.auth?.tenantId) {
      await db.execute(
        sql`SELECT set_config('app.current_tenant', ${ctx.auth.tenantId}, true)`
      );
    }
  });
