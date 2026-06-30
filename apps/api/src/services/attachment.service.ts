import fs from "node:fs";
import path from "node:path";
import { db } from "../db";
import { identifiers, documents, documentShares, auditLogs } from "../db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { verifyDocumentContainsIdentifier } from "./document.service";
import type { AuthPayload } from "../middleware/auth";

const APP_ROOT = path.resolve(import.meta.dir, "../..");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(APP_ROOT, "uploads");
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || path.join(APP_ROOT, "thumbnails");
const THUMBNAIL_SCRIPT = process.env.THUMBNAIL_SCRIPT || path.join(APP_ROOT, "scripts", "generate_thumbnail.py");
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 52_428_800;

const RESOLVED_UPLOAD_DIR = path.resolve(UPLOAD_DIR);
const RESOLVED_THUMBNAIL_DIR = path.resolve(THUMBNAIL_DIR);

if (!fs.existsSync(RESOLVED_UPLOAD_DIR)) fs.mkdirSync(RESOLVED_UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(RESOLVED_THUMBNAIL_DIR)) fs.mkdirSync(RESOLVED_THUMBNAIL_DIR, { recursive: true });

export function generateThumbnailAsync(filePath: string, docId: string) {
  const supported = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".doc", ".docx", ".odt", ".xls", ".xlsx", ".ppt", ".pptx"];
  const ext = path.extname(filePath).toLowerCase();
  if (!supported.includes(ext)) return;

  const thumbPath = path.join(THUMBNAIL_DIR, `${docId}.png`);
  const scriptPath = path.resolve(THUMBNAIL_SCRIPT);

  const child = Bun.spawn(["python3", scriptPath, filePath, thumbPath], {
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  child.unref();
}

function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 255);
}

export async function attachDocument(
  auth: AuthPayload,
  opts: { identifier: string; file: File; uploadSource?: "manual" | "scanner" | "sync" }
) {
  const { identifier, file, uploadSource = "manual" } = opts;
  const safeName = sanitizeFilename(file.name);

  const idRow = await db.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifier), eq(identifiers.tenantId, auth.tenantId)),
  });
  if (!idRow) throw new Error(`Identificador '${identifier}' não encontrado.`);
  if (idRow.status === "cancelled") throw new Error("Não é possível associar a um identificador cancelado.");
  if (idRow.status === "attached") throw new Error("Este identificador já possui um documento associado.");

  if (file.size > MAX_FILE_SIZE) throw new Error(`Ficheiro demasiado grande. Máximo: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const ext = path.extname(file.name) || "";
  const finalName = `${identifier.replace(/-/g, "_")}_${Date.now()}${ext}`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  const fd = fs.openSync(finalPath, "wx");
  fs.writeSync(fd, buffer);
  fs.closeSync(fd);

  let verification: Awaited<ReturnType<typeof verifyDocumentContainsIdentifier>>;
  try {
    verification = await verifyDocumentContainsIdentifier(finalPath, file.type || "application/octet-stream", identifier);
  } catch (err: any) {
    fs.unlinkSync(finalPath);
    throw new Error(`Erro na verificação: ${err.message}`);
  }

  if (!verification.found) {
    fs.unlinkSync(finalPath);
    await db.insert(auditLogs).values({
      tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH_FAILED",
      resource: "documents", resourceId: idRow.id,
      metadata: JSON.stringify({ filename: file.name, reason: "identifier_not_found" }), ip: "unknown",
    });
    return { success: false, message: `O documento não contém o identificador '${identifier}'.`, verification };
  }

  const [doc] = await db.insert(documents).values({
    tenantId: auth.tenantId,
    identifierId: idRow.id,
    filename: safeName,
    mimeType: file.type || "application/octet-stream",
    filePath: finalPath,
    fileSize: file.size,
    extractedText: verification.excerpt ?? null,
    uploadedBy: auth.userId,
    uploadSource,
  }).returning();

  await db.update(identifiers).set({ status: "attached" }).where(eq(identifiers.id, idRow.id));

  generateThumbnailAsync(finalPath, doc.id);

  await db.insert(auditLogs).values({
    tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH",
    resource: "documents", resourceId: doc.id,
    metadata: JSON.stringify({ identifier, filename: safeName, method: verification.method }), ip: "unknown",
  });

  const fullDoc = await db.query.documents.findFirst({
    where: eq(documents.id, doc.id),
    with: { identifier: true },
  });

  return { success: true, message: "Documento associado com sucesso.", document: fullDoc, verification };
}

async function canAccessDocument(auth: AuthPayload, identifierId: string, sectorId: string | null, visibility: string | null, docId: string | null): Promise<{ allowed: boolean; restricted: boolean }> {
  const v = visibility ?? "public";

  // Nível 1 — público
  if (v === "public") return { allowed: true, restricted: false };

  // Nível 2 — mesmo sector que emitiu o documento
  if (sectorId != null && sectorId === auth.sectorId) {
    return { allowed: true, restricted: false };
  }

  // Nível 3 — partilha activa (userId directo OU sector do utilizador)
  if (docId) {
    const shareConditions = [
      eq(documentShares.documentId, docId),
      isNull(documentShares.revokedAt),
    ];

    const userShareConditions = auth.sectorId
      ? or(
          eq(documentShares.sharedWithUserId, auth.userId),
          eq(documentShares.sharedWithSectorId, auth.sectorId),
        )
      : eq(documentShares.sharedWithUserId, auth.userId);

    const share = await db.query.documentShares.findFirst({
      where: and(...shareConditions, userShareConditions),
    });

    if (share) return { allowed: true, restricted: false };
  }

  // Nível 4 — ORG_ADMIN sem partilha: vê mas não descarrega
  if (auth.roles.includes("ORG_ADMIN")) {
    return { allowed: false, restricted: true };
  }

  // Nível 5 — sem acesso
  return { allowed: false, restricted: false };
}

export async function getDocumentMeta(auth: AuthPayload, identifier: string) {
  const idRow = await db.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifier), eq(identifiers.tenantId, auth.tenantId)),
    with: { document: { with: { identifier: { with: { category: true } } } } },
  });
  if (!idRow?.document) return null;

  const { allowed, restricted } = await canAccessDocument(
    auth, idRow.id, idRow.sectorId, idRow.visibility, idRow.document.id,
  );
  if (!allowed && !restricted) return null;

  return { ...idRow.document, restricted };
}

export async function downloadDocument(auth: AuthPayload, identifier: string): Promise<{ filePath: string; fileName: string } | { error: "NOT_FOUND" | "ACCESS_REQUIRED" }> {
  const idRow = await db.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifier), eq(identifiers.tenantId, auth.tenantId)),
    with: { document: true },
  });
  if (!idRow?.document || !fs.existsSync(idRow.document.filePath)) return { error: "NOT_FOUND" };

  const { allowed, restricted } = await canAccessDocument(
    auth, idRow.id, idRow.sectorId, idRow.visibility, idRow.document.id,
  );
  if (!allowed && restricted) return { error: "ACCESS_REQUIRED" };
  if (!allowed) return { error: "NOT_FOUND" };

  const resolvedPath = path.resolve(idRow.document.filePath);
  if (!resolvedPath.startsWith(RESOLVED_UPLOAD_DIR)) {
    return { error: "NOT_FOUND" };
  }

  return { filePath: resolvedPath, fileName: idRow.document.filename };
}
