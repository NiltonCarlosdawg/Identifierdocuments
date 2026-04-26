import fs from "node:fs";
import path from "node:path";
import { sqlite } from "../db";
import { verifyDocumentContainsIdentifier } from "./document.service";
import type { DocumentIdentifier } from "../db/schema";

const UPLOAD_DIR = "./uploads";

// Garante que a pasta de uploads existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export type AttachOptions = {
  identifier:   string;
  file:         File;               // Elysia fornece File directamente
  uploadedBy?:  string;
};

export type AttachResult = {
  success:          boolean;
  identifierFound:  boolean;
  message:          string;
  document?:        Record<string, any>;
  verification?:    Record<string, any>;
};

export async function attachDocument(opts: AttachOptions): Promise<AttachResult> {
  const { identifier, file, uploadedBy } = opts;

  // 1. Verifica se o identificador existe e está em "pending"
  const idRow = sqlite.prepare(
    "SELECT * FROM document_identifiers WHERE identifier = ?"
  ).get(identifier) as DocumentIdentifier | undefined;

  if (!idRow) {
    throw new Error(`Identificador '${identifier}' não encontrado.`);
  }
  if (idRow.status === "cancelled") {
    throw new Error("Não é possível associar um documento a um identificador cancelado.");
  }
  if (idRow.status === "attached") {
    throw new Error("Este identificador já possui um documento associado.");
  }

  // 2. Guarda o ficheiro temporariamente para fazer a verificação
  const arrayBuffer = await file.arrayBuffer();
  const buffer      = Buffer.from(arrayBuffer);
  const ext         = path.extname(file.name) || "";
  const tmpName     = `tmp_${crypto.randomUUID()}${ext}`;
  const tmpPath     = path.join(UPLOAD_DIR, tmpName);

  fs.writeFileSync(tmpPath, buffer);

  let verification: Awaited<ReturnType<typeof verifyDocumentContainsIdentifier>>;

  try {
    // 3. Verifica se o documento contém o identificador
    verification = await verifyDocumentContainsIdentifier(
      tmpPath,
      file.type || "application/octet-stream",
      identifier
    );
  } catch (err: any) {
    fs.unlinkSync(tmpPath); // limpa o temp
    throw new Error(`Erro na verificação do documento: ${err.message}`);
  }

  const now = new Date().toISOString();

  if (!verification.found) {
    // Documento não contém o identificador — rejeita e limpa
    fs.unlinkSync(tmpPath);

    // Log da tentativa falhada
    sqlite.prepare(`
      INSERT INTO audit_log (id, action, identifier_id, detail, created_at)
      VALUES (?, 'ATTACH_FAILED', ?, ?, ?)
    `).run(
      crypto.randomUUID(), idRow.id,
      `Documento '${file.name}' rejeitado: identificador não encontrado no conteúdo`,
      now
    );

    return {
      success:         false,
      identifierFound: false,
      message: `O documento '${file.name}' foi rejeitado porque não contém o identificador '${identifier}'. ` +
               `Certifique-se de que o identificador consta no documento e tente novamente.`,
      verification,
    };
  }

  // 4. Identificador encontrado → move para nome definitivo
  const finalName = `${identifier.replace(/-/g, "_")}_${Date.now()}${ext}`;
  const finalPath = path.join(UPLOAD_DIR, finalName);
  fs.renameSync(tmpPath, finalPath);

  // 5. Persiste na base de dados dentro de uma transacção
  sqlite.transaction(() => {
    const docId = crypto.randomUUID();

    sqlite.prepare(`
      INSERT INTO attached_documents
        (id, identifier_id, original_name, mime_type, file_path,
         file_size_bytes, identifier_found, verified_at, uploaded_at, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      docId, idRow.id, file.name,
      file.type || "application/octet-stream",
      finalPath, file.size, now, now,
      uploadedBy ?? null
    );

    sqlite.prepare(`
      UPDATE document_identifiers
      SET status = 'attached', updated_at = ?
      WHERE id = ?
    `).run(now, idRow.id);

    sqlite.prepare(`
      INSERT INTO audit_log (id, action, identifier_id, detail, created_at)
      VALUES (?, 'ATTACH', ?, ?, ?)
    `).run(
      crypto.randomUUID(), idRow.id,
      `Documento '${file.name}' associado com sucesso (${verification.method})`,
      now
    );
  })();

  const document = sqlite.prepare(`
    SELECT ad.*, di.identifier
    FROM attached_documents ad
    JOIN document_identifiers di ON di.id = ad.identifier_id
    WHERE di.identifier = ?
  `).get(identifier);

  return {
    success:         true,
    identifierFound: true,
    message:         `Documento associado com sucesso ao identificador '${identifier}'.`,
    document,
    verification,
  };
}

export function getDocument(identifier: string) {
  return sqlite.prepare(`
    SELECT ad.*, di.identifier, di.status,
           dc.name AS category_name
    FROM attached_documents ad
    JOIN document_identifiers di ON di.id = ad.identifier_id
    JOIN document_categories  dc ON dc.id = di.category_id
    WHERE di.identifier = ?
  `).get(identifier);
}

export function downloadDocument(identifier: string): { filePath: string; fileName: string } | null {
  const row = sqlite.prepare(`
    SELECT ad.file_path, ad.original_name
    FROM attached_documents ad
    JOIN document_identifiers di ON di.id = ad.identifier_id
    WHERE di.identifier = ?
  `).get(identifier) as { file_path: string; original_name: string } | undefined;

  if (!row || !fs.existsSync(row.file_path)) return null;
  return { filePath: row.file_path, fileName: row.original_name };
}
