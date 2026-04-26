import { Elysia, t } from "elysia";
import { sqlite } from "../db";

export const auditModule = new Elysia({ prefix: "/audit" })

  // ── Listar logs de auditoria ─────────────────────────────────────────────
  .get("/", ({ query }) => {
    const { action, identifierId, limit = "50", offset = "0" } = query;

    let where = "WHERE 1=1";
    const params: any[] = [];

    if (action)       { where += " AND action = ?";        params.push(action); }
    if (identifierId) { where += " AND identifier_id = ?"; params.push(identifierId); }

    const rows = sqlite.prepare(`
      SELECT al.*, di.identifier
      FROM audit_log al
      LEFT JOIN document_identifiers di ON di.id = al.identifier_id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, Number(limit), Number(offset));

    const total = (sqlite.prepare(`
      SELECT COUNT(*) AS cnt FROM audit_log ${where}
    `).get(...params) as { cnt: number }).cnt;

    return { total, limit: Number(limit), offset: Number(offset), rows };
  }, {
    query: t.Object({
      action:       t.Optional(t.String({ description: "GENERATE | ATTACH | ATTACH_FAILED | CANCEL | QUERY" })),
      identifierId: t.Optional(t.String()),
      limit:        t.Optional(t.String()),
      offset:       t.Optional(t.String()),
    }),
    detail: {
      summary: "Listar logs de auditoria",
      tags: ["Auditoria"],
    },
  });
