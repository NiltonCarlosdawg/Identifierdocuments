import { Elysia } from "elysia";

export const tenantMiddleware = new Elysia()
  .onBeforeHandle({ as: "global" }, (ctx: any) => {
    if (ctx.auth?.tenantId) {
      ctx.set.headers["X-Tenant-Id"] = ctx.auth.tenantId;
    }
  });
