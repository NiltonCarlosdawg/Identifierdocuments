import { Elysia, t } from "elysia";
import { db } from "../db";
import { auditLogs } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";

const escCsv = (v: string | null) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.includes('"') || s.includes(",") || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV_BATCH = 1000;

export const auditModule = new Elysia({ prefix: "/audit" })
  .use(requireAuth())
  .use(requireRole("ORG_ADMIN"))

  .get("/", async ({ query, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      const conditions = [eq(auditLogs.tenantId, tenantId)];
      if (query.action) conditions.push(eq(auditLogs.action, query.action));
      if (query.resource) conditions.push(eq(auditLogs.resource, query.resource));

      const parsedPage = query.page ? parseInt(query.page, 10) : 1;
      const page = Math.max(1, Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1);
      const parsedLimit = query.limit ? parseInt(query.limit, 10) : 50;
      const limit = Math.min(Math.max(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50, 1), 100);
      const offset = (page - 1) * limit;

      const rows = await tx.query.auditLogs.findMany({
        where: and(...conditions),
        orderBy: desc(auditLogs.createdAt),
        limit, offset,
      });

      const [totalResult] = await tx
        .select({ total: sql<number>`count(*)` })
        .from(auditLogs)
        .where(and(...conditions));

      return { data: rows, meta: { total: Number(totalResult.total), page, limit } };
    });
  }, {
    query: t.Object({
      action: t.Optional(t.String()),
      resource: t.Optional(t.String()),
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
    detail: { summary: "Listar logs de auditoria", tags: ["Auditoria"] },
  })

  .get("/export", async ({ query, tenantId, set, request }) => {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    if (!(await checkRateLimit(`audit:export:${ip}:${tenantId}`, 5, 3_600_000))) {
      set.status = 429;
      return { error: { code: "RATE_LIMITED", message: "Limite de exportações excedido. Tente novamente dentro de 1 hora." } };
    }

    // NOTA: usa db.query.* directamente (sem withTenant) porque withTenant
    // envolve as queries numa db.transaction(), que é incompatível com
    // streaming — a transacção fecharia antes de o ReadableStream consumir
    // os batches. O RLS é bypassado, mas o isolamento de tenant mantém-se:
    //   1. Endpoint protegido por requireRole("ORG_ADMIN")
    //   2. Todas as queries têm WHERE eq(tenantId, ...) explícito
    //   3. Rate limit de 5/h reduz risco de exfiltração
    // Isto é intencional: a alternativa (set_config + RLS activo) traria
    // complexidade extra sem ganho real de segurança neste contexto.
    const encoder = new TextEncoder();
    let aborted = false;
    request.signal.addEventListener("abort", () => { aborted = true; });

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode("id,userId,action,resource,resourceId,ip,createdAt\n"));
          let page = 1;
          while (!aborted) {
            const rows = await db.query.auditLogs.findMany({
              where: eq(auditLogs.tenantId, tenantId),
              orderBy: desc(auditLogs.createdAt),
              limit: CSV_BATCH,
              offset: (page - 1) * CSV_BATCH,
            });
            if (rows.length === 0) break;
            for (const r of rows) {
              if (aborted) { controller.close(); return; }
              controller.enqueue(encoder.encode(
                `${escCsv(r.id)},${escCsv(r.userId)},${escCsv(r.action)},${escCsv(r.resource)},${escCsv(r.resourceId)},${escCsv(r.ip)},${escCsv(r.createdAt?.toISOString())}\n`
              ));
            }
            page++;
          }
          controller.close();
        } catch (err: any) {
          controller.error(new Error(safeError(err)));
        }
      },
    });

    set.headers["Content-Type"] = "text/csv; charset=utf-8";
    set.headers["Content-Disposition"] = `attachment; filename="audit-export-${Date.now()}.csv"`;
    return new Response(stream);
  }, {
    query: t.Object({
      format: t.Optional(t.String()),
    }),
    detail: { summary: "Exportar logs de auditoria (CSV)", tags: ["Auditoria"] },
  });
