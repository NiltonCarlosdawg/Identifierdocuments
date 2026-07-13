import fs from "node:fs";
import path from "node:path";
import type { DB } from "../db";
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
  const supported = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".docx"];
  const ext = path.extname(filePath).toLowerCase();
  if (!supported.includes(ext)) return;

  const thumbPath = path.join(THUMBNAIL_DIR, `${docId}.png`);
  const scriptPath = path.resolve(THUMBNAIL_SCRIPT);

  if (!fs.existsSync(scriptPath)) {
    console.error(`[THUMBNAIL] Script não encontrado em ${scriptPath}. Verifique THUMBNAIL_SCRIPT. docId=${docId}`);
    return;
  }

  const child = Bun.spawn(["python3", scriptPath, filePath, thumbPath], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  (async () => {
    const stderrText = await new Response(child.stderr).text().catch(() => "");
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      console.error(
        `[THUMBNAIL] Falha ao gerar thumbnail para docId=${docId} (exit code ${exitCode}).` +
        (stderrText ? ` stderr: ${stderrText.slice(0, 2000)}` : " Sem output em stderr — verifique se python3 e as dependências do script estão instaladas neste ambiente."),
      );
      return;
    }
    if (!fs.existsSync(thumbPath)) {
      console.error(`[THUMBNAIL] Script terminou com sucesso (exit 0) mas não criou ${thumbPath}. docId=${docId}`);
    }
  })().catch((err) => {
    console.error(`[THUMBNAIL] Erro inesperado ao acompanhar geração de thumbnail para docId=${docId}:`, err);
  });
}

function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 255);
}

export async function attachDocument(
  tx: DB,
  auth: AuthPayload,
  opts: { identifier: string; file: File; uploadSource?: "manual" | "scanner" | "sync" },
  ip: string = "unknown",
) {
  const { identifier, file, uploadSource = "manual" } = opts;
  const safeName = sanitizeFilename(file.name);

  const idRow = await tx.query.identifiers.findFirst({
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
    await tx.insert(auditLogs).values({
      tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH_FAILED",
      resource: "documents", resourceId: idRow.id,
      metadata: JSON.stringify({ filename: file.name, reason: "identifier_not_found" }), ip,
    });
    return { success: false, message: `O documento não contém o identificador '${identifier}'.`, verification };
  }

  let doc: typeof documents.$inferSelect;
  try {
    [doc] = await tx.transaction(async (tx2) => {
      const inserted = await tx2.insert(documents).values({
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
      await tx2.update(identifiers).set({ status: "attached" }).where(eq(identifiers.id, idRow.id));
      return inserted;
    });
  } catch (err: any) {
    fs.unlinkSync(finalPath);
    await tx.insert(auditLogs).values({
      tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH_FAILED",
      resource: "documents", resourceId: idRow.id,
      metadata: JSON.stringify({ filename: file.name, reason: "concurrent_attach_or_db_error" }), ip,
    });
    throw new Error("Este identificador já foi associado a um documento entretanto. Tente novamente.");
  }

  generateThumbnailAsync(finalPath, doc.id);

  await tx.insert(auditLogs).values({
    tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH",
    resource: "documents", resourceId: doc.id,
    metadata: JSON.stringify({ identifier, filename: safeName, method: verification.method }), ip,
  });

  const fullDoc = await tx.query.documents.findFirst({
    where: eq(documents.id, doc.id),
    with: { identifier: true },
  });

  return { success: true, message: "Documento associado com sucesso.", document: fullDoc, verification };
}

export async function canAccessDocument(tx: DB, auth: AuthPayload, sectorId: string | null, visibility: string | null, docId: string | null, uploadedBy: string | null = null): Promise<{ allowed: boolean; restricted: boolean }> {
  const v = visibility ?? "public";

  if (uploadedBy && auth.userId === uploadedBy) return { allowed: true, restricted: false };

  if (v === "public") return { allowed: true, restricted: false };

  if (sectorId != null && sectorId === auth.sectorId) {
    return { allowed: true, restricted: false };
  }

  if (docId) {
    const shareConditions = [
      eq(documentShares.documentId, docId),
      isNull(documentShares.revokedAt),
      eq(documentShares.status, "active"),
    ];

    const userShareConditions = auth.sectorId
      ? or(
          eq(documentShares.sharedWithUserId, auth.userId),
          eq(documentShares.sharedWithSectorId, auth.sectorId),
        )
      : eq(documentShares.sharedWithUserId, auth.userId);

    const share = await tx.query.documentShares.findFirst({
      where: and(...shareConditions, userShareConditions),
    });

    if (share) return { allowed: true, restricted: false };
  }

  // CORREÇÃO: antes só ORG_ADMIN recebia { restricted: true } aqui; qualquer
  // outro user caía sempre em { allowed:false, restricted:false } (→ 404),
  // mesmo quando o documento existe e é apenas sector_only. Isso impedia o
  // user de perceber que podia pedir acesso (POST /documents/:param/request-access).
  // Qualquer user autenticado do tenant que chegue a este ponto está perante um
  // documento que existe, não é público, não é do seu sector, e não tem
  // partilha activa — deve ver restricted:true (→ 403 ACCESS_REQUIRED).
  return { allowed: false, restricted: true };
}

export async function getDocumentMeta(tx: DB, auth: AuthPayload, docId: string) {
  const doc = await tx.query.documents.findFirst({
    where: and(eq(documents.id, docId), eq(documents.tenantId, auth.tenantId)),
    with: { identifier: { with: { category: true } } },
  });
  if (!doc) return null;

  const { allowed, restricted } = await canAccessDocument(
    tx, auth, doc.identifier?.sectorId ?? null, doc.identifier?.visibility ?? null, doc.id, doc.uploadedBy,
  );
  if (!allowed && !restricted) return null;

  return { ...doc, restricted };
}

export async function downloadDocument(tx: DB, auth: AuthPayload, docId: string): Promise<{ filePath: string; fileName: string } | { error: "NOT_FOUND" | "ACCESS_REQUIRED" }> {
  const doc = await tx.query.documents.findFirst({
    where: and(eq(documents.id, docId), eq(documents.tenantId, auth.tenantId)),
    with: { identifier: true },
  });
  if (!doc || !fs.existsSync(doc.filePath)) return { error: "NOT_FOUND" };

  const { allowed, restricted } = await canAccessDocument(
    tx, auth, doc.identifier?.sectorId ?? null, doc.identifier?.visibility ?? null, doc.id, doc.uploadedBy,
  );
  if (!allowed && restricted) return { error: "ACCESS_REQUIRED" };
  if (!allowed) return { error: "NOT_FOUND" };

  const resolvedPath = path.resolve(doc.filePath);
  if (!resolvedPath.startsWith(RESOLVED_UPLOAD_DIR)) {
    return { error: "NOT_FOUND" };
  }

  return { filePath: resolvedPath, fileName: doc.filename };
}
