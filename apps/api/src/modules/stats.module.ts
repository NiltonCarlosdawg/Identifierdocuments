import { Elysia, t } from "elysia";
import { db } from "../db";
import { identifiers, documents, auditLogs, categories, users } from "../db/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { requireAuth, getFreshRoles } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";

async function collectStats(tenantId: string, sectorId?: string) {
  return withTenant(tenantId, async (tx) => {
    const idConditions = [eq(identifiers.tenantId, tenantId)];
    if (sectorId) idConditions.push(eq(identifiers.sectorId, sectorId));
    const idWhere = and(...idConditions);

    const [totalIds] = await tx
      .select({ total: sql`COUNT(*)` })
      .from(identifiers)
      .where(idWhere);

    const byStatus = await tx
      .select({ status: identifiers.status, cnt: sql`COUNT(*)` })
      .from(identifiers)
      .where(idWhere)
      .groupBy(identifiers.status);

    const byCategory = await tx
      .select({ category: categories.name, cnt: sql<number>`COUNT(${identifiers.id})` })
      .from(identifiers)
      .innerJoin(categories, eq(categories.id, identifiers.categoryId))
      .where(idWhere)
      .groupBy(categories.name)
      .orderBy(sql`count DESC`)
      .limit(10);

    let totalDocs: { total: number } = { total: 0 };
    let failedAttach: { total: number } = { total: 0 };
    if (sectorId) {
      const [docs] = await tx
        .select({ total: sql<number>`COUNT(DISTINCT ${documents.id})` })
        .from(documents)
        .innerJoin(identifiers, eq(documents.identifierId, identifiers.id))
        .where(and(eq(identifiers.sectorId, sectorId), eq(identifiers.tenantId, tenantId)));
      totalDocs = docs;

      const [audit] = await tx
        .select({ total: sql<number>`COUNT(*)` })
        .from(auditLogs)
        .innerJoin(documents, sql`${auditLogs.resourceId} = ${documents.id}::text`)
        .innerJoin(identifiers, eq(documents.identifierId, identifiers.id))
        .where(and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, "ATTACH_FAILED"),
          eq(identifiers.sectorId, sectorId),
          eq(identifiers.tenantId, tenantId),
        ));
      failedAttach = audit;
    } else {
      const [docs] = await tx
        .select({ total: sql<number>`COUNT(*)` })
        .from(documents)
        .where(eq(documents.tenantId, tenantId));
      totalDocs = docs;

      const [audit] = await tx
        .select({ total: sql<number>`COUNT(*)` })
        .from(auditLogs)
        .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "ATTACH_FAILED")));
      failedAttach = audit;
    }

    return {
      identifiers: {
        total: Number(totalIds.total),
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.cnt)])),
        byCategory,
      },
      documents: {
        total: Number(totalDocs.total),
        verificationFailures: Number(failedAttach.total),
      },
    };
  });
}

export const statsModule = new Elysia({ prefix: "/stats" })
  .use(requireAuth())

  .get("/", async ({ tenantId, auth }) => {
    try {
      const roleNames = await getFreshRoles(auth!.userId, tenantId);
      let sectorId: string | undefined;
      if (!roleNames.includes("ORG_ADMIN")) {
        const me = await withTenant(tenantId, async (tx) => {
          const u = await tx.query.users.findFirst({
            where: eq(users.id, auth!.userId),
            columns: { sectorId: true },
          });
          return u?.sectorId;
        });
        if (!me) return { data: { identifiers: { total: 0, byStatus: {}, byCategory: [] }, documents: { total: 0, verificationFailures: 0 } } };
        sectorId = me;
      }
      const stats = await collectStats(tenantId, sectorId);
      return { data: stats };
    } catch (err: any) {
      return { error: { code: "STATS_ERROR", message: safeError(err) } };
    }
  }, {
    detail: { summary: "Estatísticas (filtradas por sector conforme role)", tags: ["Estatísticas"] },
  })

  .get("/export", async ({ query, tenantId, set, request }) => {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    if (!(await checkRateLimit(`stats:export:${ip}:${tenantId}`, 5, 3_600_000))) {
      set.status = 429;
      return { error: { code: "RATE_LIMITED", message: "Limite de exportações excedido. Tente novamente dentro de 1 hora." } };
    }

    try {
      const data = await collectStats(tenantId);
      const body = JSON.stringify({ exportedAt: new Date().toISOString(), tenantId, ...data }, null, 2);
      set.headers["Content-Type"] = "application/json; charset=utf-8";
      set.headers["Content-Disposition"] = `attachment; filename="stats-export-${Date.now()}.json"`;
      return new Response(body);
    } catch (err: any) {
      set.status = 500;
      return { error: { code: "EXPORT_ERROR", message: safeError(err) } };
    }
  }, {
    query: t.Object({
      format: t.Optional(t.String()),
    }),
    detail: { summary: "Exportar estatísticas (JSON)", tags: ["Estatísticas"] },
  });
