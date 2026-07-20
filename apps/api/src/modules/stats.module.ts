import { Elysia, t } from "elysia";
import { db } from "../db";
import { identifiers, documents, auditLogs, categories } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";

async function collectStats(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [totalIds] = await tx
      .select({ total: sql`COUNT(*)` })
      .from(identifiers)
      .where(eq(identifiers.tenantId, tenantId));

    const byStatus = await tx
      .select({ status: identifiers.status, cnt: sql`COUNT(*)` })
      .from(identifiers)
      .where(eq(identifiers.tenantId, tenantId))
      .groupBy(identifiers.status);

    const byCategory = await tx
      .select({ category: categories.name, cnt: sql<number>`COUNT(${identifiers.id})` })
      .from(identifiers)
      .innerJoin(categories, eq(categories.id, identifiers.categoryId))
      .where(eq(identifiers.tenantId, tenantId))
      .groupBy(categories.name)
      .orderBy(sql`count DESC`)
      .limit(10);

    const [totalDocs] = await tx
      .select({ total: sql`COUNT(*)` })
      .from(documents)
      .where(eq(documents.tenantId, tenantId));

    const [failedAttach] = await tx
      .select({ total: sql`COUNT(*)` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, "ATTACH_FAILED")
        )
      );

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
  .use(requireRole("ORG_ADMIN"))

  .get("/", async ({ tenantId }) => {
    try {
      const data = await collectStats(tenantId);
      return { data };
    } catch (err: any) {
      return { error: { code: "STATS_ERROR", message: safeError(err) } };
    }
  }, {
    detail: { summary: "Estatísticas do tenant", tags: ["Estatísticas"] },
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
