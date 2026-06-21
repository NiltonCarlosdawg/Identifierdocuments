import { Elysia, t } from "elysia";
import { db } from "../db";
import { auditLogs } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

export const auditModule = new Elysia({ prefix: "/audit" })
  .use(requireAuth())

  .get("/", async ({ auth, query }) => {
    const conditions = [eq(auditLogs.tenantId, auth!.tenantId)];
    if (query.action) conditions.push(eq(auditLogs.action, query.action));
    if (query.resource) conditions.push(eq(auditLogs.resource, query.resource));

    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 50;
    const offset = (page - 1) * limit;

    const rows = await db.query.auditLogs.findMany({
      where: and(...conditions),
      orderBy: desc(auditLogs.createdAt),
      limit, offset,
    });

    const [totalResult] = await db
      .select({ total: sql<number>`count(*)` })
      .from(auditLogs)
      .where(and(...conditions));

    return { data: rows, meta: { total: Number(totalResult.total), page, limit } };
  }, {
    query: t.Object({
      action: t.Optional(t.String()),
      resource: t.Optional(t.String()),
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
    detail: { summary: "Listar logs de auditoria", tags: ["Auditoria"] },
  });
