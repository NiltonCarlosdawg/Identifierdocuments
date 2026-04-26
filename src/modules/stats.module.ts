import { Elysia } from "elysia";
import { sqlite } from "../db";

export const statsModule = new Elysia({ prefix: "/stats" })

  .get("/", () => {
    const totalIdentifiers = (sqlite.prepare(
      "SELECT COUNT(*) AS cnt FROM document_identifiers"
    ).get() as { cnt: number }).cnt;

    const byStatus = sqlite.prepare(`
      SELECT status, COUNT(*) AS cnt
      FROM document_identifiers
      GROUP BY status
    `).all() as { status: string; cnt: number }[];

    const byCategory = sqlite.prepare(`
      SELECT dc.name AS category, dc.grp AS grp, COUNT(di.id) AS cnt
      FROM document_categories dc
      LEFT JOIN document_identifiers di ON di.category_id = dc.id
      GROUP BY dc.id
      ORDER BY cnt DESC
      LIMIT 10
    `).all();

    const byMonth = sqlite.prepare(`
      SELECT year, month, COUNT(*) AS cnt
      FROM document_identifiers
      GROUP BY year, month
      ORDER BY year DESC, month DESC
      LIMIT 12
    `).all();

    const totalDocuments = (sqlite.prepare(
      "SELECT COUNT(*) AS cnt FROM attached_documents"
    ).get() as { cnt: number }).cnt;

    const verificationFailures = (sqlite.prepare(
      "SELECT COUNT(*) AS cnt FROM audit_log WHERE action = 'ATTACH_FAILED'"
    ).get() as { cnt: number }).cnt;

    return {
      identifiers: {
        total: totalIdentifiers,
        byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.cnt])),
        byCategory,
        byMonth,
      },
      documents: {
        total: totalDocuments,
        verificationFailures,
      },
    };
  }, {
    detail: {
      summary: "Estatísticas gerais do sistema",
      tags: ["Estatísticas"],
    },
  });
