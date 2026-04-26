import { db, sqlite } from "../db";
import type { DocumentIdentifier } from "../db/schema";

const COMPANY_PREFIX = "VL";

/**
 * Gera o próximo número de sequência para uma categoria + ano.
 * Usa uma transacção para evitar colisões em ambiente concorrente.
 */
function nextSequence(categoryId: string, year: number): number {
  const row = sqlite.prepare(`
    SELECT COALESCE(MAX(sequence), 0) + 1 AS next
    FROM document_identifiers
    WHERE category_id = ? AND year = ?
  `).get(categoryId, year) as { next: number };
  return row.next;
}

/**
 * Formata o identificador no padrão:
 *   VL-{PREFIX}-{YYYY}-{MMDD}-{SEQ:03d}
 *
 * Exemplo: VL-PROP-2026-0424-001
 */
function buildIdentifier(
  prefix: string,
  year: number,
  month: number,
  day: number,
  seq: number
): string {
  const mm  = String(month).padStart(2, "0");
  const dd  = String(day).padStart(2, "0");
  const seq3 = String(seq).padStart(3, "0");
  return `${COMPANY_PREFIX}-${prefix}-${year}-${mm}${dd}-${seq3}`;
}

export type GenerateOptions = {
  categoryId:  string;
  issuedTo?:   string;
  description?: string;
};

export function generateIdentifier(opts: GenerateOptions) {
  const { categoryId, issuedTo, description } = opts;

  // Obter categoria
  const cat = sqlite.prepare(
    "SELECT * FROM document_categories WHERE id = ?"
  ).get(categoryId) as { id: string; prefix: string; name: string } | undefined;

  if (!cat) throw new Error(`Categoria '${categoryId}' não encontrada.`);

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const day   = now.getDate();

  // Transacção para garantir sequência única
  const result = sqlite.transaction(() => {
    const seq        = nextSequence(categoryId, year);
    const identifier = buildIdentifier(cat.prefix, year, month, day, seq);
    const id         = crypto.randomUUID();

    sqlite.prepare(`
      INSERT INTO document_identifiers
        (id, identifier, category_id, status, issued_to, description,
         sequence, year, month, day, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, identifier, categoryId,
      issuedTo ?? null, description ?? null,
      seq, year, month, day,
      now.toISOString(), now.toISOString()
    );

    // Log de auditoria
    sqlite.prepare(`
      INSERT INTO audit_log (id, action, identifier_id, detail, created_at)
      VALUES (?, 'GENERATE', ?, ?, ?)
    `).run(
      crypto.randomUUID(), id,
      `Identificador ${identifier} gerado para categoria ${cat.name}`,
      now.toISOString()
    );

    return sqlite.prepare(
      "SELECT * FROM document_identifiers WHERE id = ?"
    ).get(id) as DocumentIdentifier;
  })();

  return result;
}

export function getIdentifier(identifier: string) {
  const row = sqlite.prepare(`
    SELECT
      di.*,
      dc.name  AS category_name,
      dc.grp   AS category_group,
      ad.original_name  AS doc_name,
      ad.mime_type      AS doc_mime,
      ad.file_size_bytes AS doc_size,
      ad.uploaded_at    AS doc_uploaded_at,
      ad.identifier_found AS doc_verified
    FROM document_identifiers di
    JOIN document_categories dc ON dc.id = di.category_id
    LEFT JOIN attached_documents ad ON ad.identifier_id = di.id
    WHERE di.identifier = ?
  `).get(identifier);

  if (!row) return null;

  // Audit log de consulta
  sqlite.prepare(`
    INSERT INTO audit_log (id, action, identifier_id, detail, created_at)
    VALUES (?, 'QUERY', ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    (row as any).id,
    `Consulta ao identificador ${identifier}`,
    new Date().toISOString()
  );

  return row;
}

export function listIdentifiers(filters: {
  categoryId?: string;
  status?: string;
  year?: number;
  issuedTo?: string;
  limit?: number;
  offset?: number;
}) {
  const { categoryId, status, year, issuedTo, limit = 50, offset = 0 } = filters;

  let where = "WHERE 1=1";
  const params: any[] = [];

  if (categoryId) { where += " AND di.category_id = ?"; params.push(categoryId); }
  if (status)     { where += " AND di.status = ?";      params.push(status); }
  if (year)       { where += " AND di.year = ?";        params.push(year); }
  if (issuedTo)   { where += " AND di.issued_to LIKE ?"; params.push(`%${issuedTo}%`); }

  const rows = sqlite.prepare(`
    SELECT
      di.*,
      dc.name AS category_name,
      dc.grp  AS category_group,
      CASE WHEN ad.id IS NOT NULL THEN 1 ELSE 0 END AS has_document
    FROM document_identifiers di
    JOIN document_categories dc ON dc.id = di.category_id
    LEFT JOIN attached_documents ad ON ad.identifier_id = di.id
    ${where}
    ORDER BY di.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = (sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM document_identifiers di
    ${where}
  `).get(...params) as { cnt: number }).cnt;

  return { rows, total, limit, offset };
}

export function cancelIdentifier(identifier: string, reason: string) {
  const row = sqlite.prepare(
    "SELECT * FROM document_identifiers WHERE identifier = ?"
  ).get(identifier) as DocumentIdentifier | undefined;

  if (!row) throw new Error(`Identificador '${identifier}' não encontrado.`);
  if (row.status === "attached") throw new Error("Não é possível cancelar um identificador com documento associado.");
  if (row.status === "cancelled") throw new Error("Identificador já está cancelado.");

  const now = new Date().toISOString();
  sqlite.prepare(`
    UPDATE document_identifiers
    SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ?
    WHERE identifier = ?
  `).run(now, reason, now, identifier);

  sqlite.prepare(`
    INSERT INTO audit_log (id, action, identifier_id, detail, created_at)
    VALUES (?, 'CANCEL', ?, ?, ?)
  `).run(crypto.randomUUID(), row.id, `Cancelado: ${reason}`, now);

  return sqlite.prepare(
    "SELECT * FROM document_identifiers WHERE identifier = ?"
  ).get(identifier);
}
