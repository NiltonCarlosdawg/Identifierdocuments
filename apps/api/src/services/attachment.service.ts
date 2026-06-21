import fs from "node:fs";
import path from "node:path";
import { db } from "../db";
import { identifiers, documents, auditLogs } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { verifyDocumentContainsIdentifier } from "./document.service";
import type { AuthPayload } from "../middleware/auth";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export async function attachDocument(
  auth: AuthPayload,
  opts: { identifier: string; file: File; uploadSource?: "manual" | "scanner" | "sync" }
) {
  const { identifier, file, uploadSource = "manual" } = opts;

  const idRow = await db.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifier), eq(identifiers.tenantId, auth.tenantId)),
  });
  if (!idRow) throw new Error(`Identificador '${identifier}' não encontrado.`);
  if (idRow.status === "cancelled") throw new Error("Não é possível associar a um identificador cancelado.");
  if (idRow.status === "attached") throw new Error("Este identificador já possui um documento associado.");

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const ext = path.extname(file.name) || "";
  const tmpName = `tmp_${crypto.randomUUID()}${ext}`;
  const tmpPath = path.join(UPLOAD_DIR, tmpName);
  fs.writeFileSync(tmpPath, buffer);

  let verification: Awaited<ReturnType<typeof verifyDocumentContainsIdentifier>>;
  try {
    verification = await verifyDocumentContainsIdentifier(tmpPath, file.type || "application/octet-stream", identifier);
  } catch (err: any) {
    fs.unlinkSync(tmpPath);
    throw new Error(`Erro na verificação: ${err.message}`);
  }

  if (!verification.found) {
    fs.unlinkSync(tmpPath);
    await db.insert(auditLogs).values({
      tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH_FAILED",
      resource: "documents", resourceId: idRow.id,
      metadata: JSON.stringify({ filename: file.name, reason: "identifier_not_found" }), ip: null,
    });
    return { success: false, message: `O documento não contém o identificador '${identifier}'.`, verification };
  }

  const finalName = `${identifier.replace(/-/g, "_")}_${Date.now()}${ext}`;
  const finalPath = path.join(UPLOAD_DIR, finalName);
  fs.renameSync(tmpPath, finalPath);

  const [doc] = await db.insert(documents).values({
    tenantId: auth.tenantId,
    identifierId: idRow.id,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    filePath: finalPath,
    fileSize: file.size,
    extractedText: verification.excerpt ?? null,
    uploadedBy: auth.userId,
    uploadSource,
  }).returning();

  await db.update(identifiers).set({ status: "attached" }).where(eq(identifiers.id, idRow.id));

  await db.insert(auditLogs).values({
    tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH",
    resource: "documents", resourceId: doc.id,
    metadata: JSON.stringify({ identifier, filename: file.name, method: verification.method }), ip: null,
  });

  const fullDoc = await db.query.documents.findFirst({
    where: eq(documents.id, doc.id),
    with: { identifier: true },
  });

  return { success: true, message: "Documento associado com sucesso.", document: fullDoc, verification };
}

export async function getDocumentMeta(auth: AuthPayload, identifier: string) {
  return db.query.documents.findFirst({
    where: and(eq(documents.tenantId, auth.tenantId)),
    with: { identifier: { with: { category: true } } },
  });
}

export async function downloadDocument(auth: AuthPayload, identifier: string) {
  const doc = await db.query.documents.findFirst({
    where: and(eq(documents.tenantId, auth.tenantId)),
    with: { identifier: true },
  });
  if (!doc || !fs.existsSync(doc.filePath)) return null;
  return { filePath: doc.filePath, fileName: doc.filename };
}
