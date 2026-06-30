import { Elysia } from "elysia";
import { db } from "../db";
import { identifiers, documents, auditLogs, categories } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

export const statsModule = new Elysia({ prefix: "/stats" })
  .use(requireAuth())
  .use(requireRole("ORG_ADMIN"))

  .get("/", async ({ auth }) => {
    const tenantId = auth!.tenantId;

    const [totalIds] = await db
      .select({ total: sql`COUNT(*)` })
      .from(identifiers)
      .where(eq(identifiers.tenantId, tenantId));

    const byStatus = await db
      .select({ status: identifiers.status, cnt: sql`COUNT(*)` })
      .from(identifiers)
      .where(eq(identifiers.tenantId, tenantId))
      .groupBy(identifiers.status);

    const byCategory = await db
      .select({ category: categories.name, cnt: sql<number>`COUNT(${identifiers.id})` })
      .from(identifiers)
      .innerJoin(categories, eq(categories.id, identifiers.categoryId))
      .where(eq(identifiers.tenantId, tenantId))
      .groupBy(categories.name)
      .orderBy(sql`count DESC`)
      .limit(10);

    const [totalDocs] = await db
      .select({ total: sql`COUNT(*)` })
      .from(documents)
      .where(eq(documents.tenantId, tenantId));

    const [failedAttach] = await db
      .select({ total: sql`COUNT(*)` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, "ATTACH_FAILED")
        )
      );

    return {
      data: {
        identifiers: {
          total: Number(totalIds.total),
          byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.cnt)])),
          byCategory,
        },
        documents: {
          total: Number(totalDocs.total),
          verificationFailures: Number(failedAttach.total),
        },
      },
    };
  }, {
    detail: { summary: "Estatísticas do tenant", tags: ["Estatísticas"] },
  });
