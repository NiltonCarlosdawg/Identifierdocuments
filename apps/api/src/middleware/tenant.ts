import { Elysia } from "elysia";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NULL_TENANT = "00000000-0000-0000-0000-000000000000";

export const tenantMiddleware = new Elysia()
  .derive({ as: "global" }, async (ctx: any) => {
    const tid = ctx.auth?.tenantId;
    const tenantId = typeof tid === "string" && tid.length > 0 && UUID_REGEX.test(tid) ? tid : NULL_TENANT;
    return { tenantId };
  });
