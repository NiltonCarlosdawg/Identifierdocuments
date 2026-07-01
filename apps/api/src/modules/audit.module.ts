import { Elysia, t } from "elysia";
import { db } from "../db";
import { auditLogs } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

export const auditModule = new Elysia({ prefix: "/audit" })
  .use(requireAuth())
  .use(requireRole("ORG_ADMIN"))

  .get("/", async ({ auth, query }) => {
    const conditions = [eq(auditLogs.tenantId, auth!.tenantId)];
    if (query.action) conditions.push(eq(auditLogs.action, query.action));
    if (query.resource) conditions.push(eq(auditLogs.resource, query.resource));

    const parsedPage = query.page ? parseInt(query.page, 10) : 1;
    const page = Math.max(1, Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1);
    const parsedLimit = query.limit ? parseInt(query.limit, 10) : 50;
    const limit = Math.min(Math.max(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50, 1), 100);
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
