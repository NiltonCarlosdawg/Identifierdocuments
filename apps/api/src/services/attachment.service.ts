import fs from "node:fs";
import path from "node:path";
import type { DB } from "../db";
import { identifiers, documents, documentVersions, documentShares, auditLogs } from "../db/schema";
import { eq, and, or, isNull, desc } from "drizzle-orm";
import { verifyDocumentContainsIdentifier } from "./document.service";
import { getSharedDocIds } from "./identifier.service";
import type { AuthPayload } from "../middleware/auth";
import { getFreshRoles } from "../middleware/auth";
import { tryEnqueueThumbnail } from "../jobs/queues";
import { withIdempotency } from "../lib/idempotency";

const APP_ROOT = path.resolve(import.meta.dir, "../..");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(APP_ROOT, "uploads");
const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || path.join(APP_ROOT, "thumbnails");
const THUMBNAIL_SCRIPT = process.env.THUMBNAIL_SCRIPT || path.join(APP_ROOT, "scripts", "generate_thumbnail.py");
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 52_428_800;

const RESOLVED_UPLOAD_DIR = path.resolve(UPLOAD_DIR);
const RESOLVED_THUMBNAIL_DIR = path.resolve(THUMBNAIL_DIR);

/** True se `candidate` está exactamente no dir ou num subcaminho (evita `/uploads` vs `/uploads_evil`). */
export function isPathInsideDir(candidate: string, dir: string): boolean {
  try {
    const resolved = fs.realpathSync(path.resolve(candidate));
    const root = fs.realpathSync(path.resolve(dir));
    return resolved === root || resolved.startsWith(root + path.sep);
  } catch {
    return false;
  }
}

if (!fs.existsSync(RESOLVED_UPLOAD_DIR)) fs.mkdirSync(RESOLVED_UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(RESOLVED_THUMBNAIL_DIR)) fs.mkdirSync(RESOLVED_THUMBNAIL_DIR, { recursive: true });

export type DocumentKind = "primary" | "attachment";

export function pickPrimaryDocument<T extends { kind: string }>(docs: T[] | null | undefined): T | undefined {
  if (!docs?.length) return undefined;
  return docs.find((d) => d.kind === "primary") ?? undefined;
}

export function generateThumbnailAsync(filePath: string, docId: string): void {
  void runThumbnailJob(filePath, docId);
}

/** Gera thumbnail e espera o processo terminar (usado pelo worker BullMQ). */
export async function runThumbnailJob(filePath: string, docId: string): Promise<void> {
  if (!isPathInsideDir(filePath, RESOLVED_UPLOAD_DIR)) {
    console.error(`[THUMBNAIL] filePath fora de UPLOAD_DIR — recusado. docId=${docId}`);
    return;
  }
  // UUID v4-ish: só caracteres seguros no nome do ficheiro de saída
  if (!/^[0-9a-f-]{36}$/i.test(docId)) {
    console.error(`[THUMBNAIL] docId inválido — recusado. docId=${docId}`);
    return;
  }

  const supported = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".docx"];
  const ext = path.extname(filePath).toLowerCase();
  if (!supported.includes(ext)) return;

  const thumbPath = path.join(RESOLVED_THUMBNAIL_DIR, `${docId}.png`);
  if (!isPathInsideDir(thumbPath, RESOLVED_THUMBNAIL_DIR)) {
    console.error(`[THUMBNAIL] thumbPath inválido — recusado. docId=${docId}`);
    return;
  }
  const scriptPath = path.resolve(THUMBNAIL_SCRIPT);

  if (!fs.existsSync(scriptPath)) {
    console.error(`[THUMBNAIL] Script não encontrado em ${scriptPath}. Verifique THUMBNAIL_SCRIPT. docId=${docId}`);
    return;
  }

  const child = Bun.spawn(["python3", scriptPath, path.resolve(filePath), thumbPath], {
    stdio: ["ignore", "ignore", "pipe"],
  });

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
}

/** Preferência: fila BullMQ; fallback spawn local. */
export function scheduleThumbnail(filePath: string, docId: string): void {
  void tryEnqueueThumbnail(filePath, docId).then((queued) => {
    if (!queued) generateThumbnailAsync(filePath, docId);
  });
}

export function parseDocumentTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export function serializeDocumentTags(tags: string[]): string {
  const unique = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 24);
  return JSON.stringify(unique);
}

function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 255);
}

async function writeUploadFile(file: File, identifier: string): Promise<{ finalPath: string; safeName: string; buffer: Buffer }> {
  if (file.size > MAX_FILE_SIZE) throw new Error(`Ficheiro demasiado grande. Máximo: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  const safeName = sanitizeFilename(file.name);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const ext = path.extname(safeName) || "";
  const finalName = `${identifier.replace(/[^a-zA-Z0-9_-]/g, "_")}_${Date.now()}${ext}`;
  const finalPath = path.join(RESOLVED_UPLOAD_DIR, finalName);
  if (!isPathInsideDir(finalPath, RESOLVED_UPLOAD_DIR)) {
    throw new Error("Caminho de upload inválido.");
  }
  const fd = fs.openSync(finalPath, "wx");
  fs.writeSync(fd, buffer);
  fs.closeSync(fd);
  return { finalPath, safeName, buffer };
}

function hydrateDocument(
  doc: typeof documents.$inferSelect,
  current: typeof documentVersions.$inferSelect | null | undefined,
  extra?: Record<string, unknown>,
) {
  const { tags: tagsRaw, ...rest } = doc;
  return {
    ...rest,
    tags: parseDocumentTags(tagsRaw),
    filename: current?.filename ?? null,
    mimeType: current?.mimeType ?? null,
    // Nunca expor caminho absoluto do filesystem ao cliente
    fileSize: current?.fileSize ?? null,
    extractedText: current?.extractedText ?? null,
    uploadSource: current?.uploadSource ?? null,
    currentVersion: current?.version ?? null,
    ...extra,
  };
}

/**
 * Escrita (attach/version): criador do identificador, mesmo sector, ou ORG_ADMIN.
 * Partilha só concede leitura — não permite versionar/anexar.
 */
export async function canWriteIdentifier(
  auth: AuthPayload,
  idRow: { sectorId: string | null; createdBy?: string | null },
): Promise<boolean> {
  if (idRow.createdBy && idRow.createdBy === auth.userId) return true;
  if (idRow.sectorId != null && idRow.sectorId === auth.sectorId) return true;
  const roles = await getFreshRoles(auth.userId, auth.tenantId);
  return roles.includes("ORG_ADMIN");
}

async function getCurrentVersion(tx: DB, documentId: string) {
  return tx.query.documentVersions.findFirst({
    where: and(eq(documentVersions.documentId, documentId), eq(documentVersions.isCurrent, true)),
  });
}

/** Primary attach: creates document kind=primary + version 1. Rejects if primary already exists. */
export async function attachDocument(
  tx: DB,
  auth: AuthPayload,
  opts: { identifier: string; file: File; uploadSource?: "manual" | "scanner" | "sync"; idempotencyKey?: string },
  ip: string = "unknown",
) {
  const { identifier, file, uploadSource = "manual", idempotencyKey } = opts;

  return await withIdempotency(tx, auth.tenantId, idempotencyKey, async () => {
    const idRow = await tx.query.identifiers.findFirst({
      where: and(eq(identifiers.identifier, identifier), eq(identifiers.tenantId, auth.tenantId)),
      with: { documents: true },
    });
    if (!idRow) throw new Error(`Identificador '${identifier}' não encontrado.`);
    if (idRow.status === "cancelled") throw new Error("Não é possível associar a um identificador cancelado.");
    if (!(await canWriteIdentifier(auth, idRow as any))) {
      throw new Error("Sem permissão para associar documentos a este identificador.");
    }

    const existingPrimary = pickPrimaryDocument(idRow.documents);
    if (existingPrimary || idRow.status === "attached") {
      throw new Error("Este identificador já possui um documento principal. Use uma nova versão ou um anexo.");
    }

    const { finalPath, safeName } = await writeUploadFile(file, identifier);

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
      } as any);
      return { success: false, message: `O documento não contém o identificador '${identifier}'.`, verification };
    }

    let doc: typeof documents.$inferSelect;
    let version: typeof documentVersions.$inferSelect;
    try {
      const inserted = await tx.transaction(async (tx2) => {
        const [newDoc] = await tx2.insert(documents).values({
          tenantId: auth.tenantId,
          identifierId: idRow.id,
          kind: "primary",
          uploadedBy: auth.userId,
        }).returning();

        const [newVersion] = await tx2.insert(documentVersions).values({
          tenantId: auth.tenantId,
          documentId: newDoc.id,
          version: 1,
          filename: safeName,
          mimeType: file.type || "application/octet-stream",
          filePath: finalPath,
          fileSize: file.size,
          extractedText: verification.excerpt ?? null,
          uploadedBy: auth.userId,
          uploadSource,
          isCurrent: true,
        }).returning();

        await tx2.update(identifiers).set({ status: "attached" }).where(eq(identifiers.id, idRow.id));
        return { newDoc, newVersion };
      });
      doc = inserted.newDoc;
      version = inserted.newVersion;
    } catch (err: any) {
      fs.unlinkSync(finalPath);
      await tx.insert(auditLogs).values({
        tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH_FAILED",
        resource: "documents", resourceId: idRow.id,
        metadata: JSON.stringify({ filename: file.name, reason: "concurrent_attach_or_db_error" }), ip,
      } as any);
      throw new Error("Este identificador já foi associado a um documento entretanto. Tente novamente.");
    }

    scheduleThumbnail(finalPath, doc.id);

    await tx.insert(auditLogs).values({
      tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH",
      resource: "documents", resourceId: doc.id,
      metadata: JSON.stringify({ identifier, filename: safeName, method: verification.method }), ip,
    } as any);

    const fullDoc = await tx.query.documents.findFirst({
      where: eq(documents.id, doc.id),
      with: { identifier: true },
    });

    return {
      success: true,
      message: "Documento associado com sucesso.",
      document: hydrateDocument(fullDoc!, version),
      verification,
    };
  });
}

/** Attachment: creates document kind=attachment + version 1. Identifier must already have a primary. */
export async function attachAttachment(
  tx: DB,
  auth: AuthPayload,
  opts: { identifier: string; file: File; label?: string; uploadSource?: "manual" | "scanner" | "sync" },
  ip: string = "unknown",
) {
  const { identifier, file, label, uploadSource = "manual" } = opts;

  const idRow = await tx.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifier), eq(identifiers.tenantId, auth.tenantId)),
    with: { documents: true },
  });
  if (!idRow) throw new Error(`Identificador '${identifier}' não encontrado.`);
  if (idRow.status === "cancelled") throw new Error("Não é possível associar a um identificador cancelado.");
  if (!(await canWriteIdentifier(auth, idRow as any))) {
    throw new Error("Sem permissão para adicionar anexos a este identificador.");
  }

  const primary = pickPrimaryDocument(idRow.documents);
  if (!primary) throw new Error("O identificador ainda não tem documento principal. Associe o documento principal primeiro.");

  const { finalPath, safeName } = await writeUploadFile(file, identifier);

  const [doc] = await tx.insert(documents).values({
    tenantId: auth.tenantId,
    identifierId: idRow.id,
    kind: "attachment",
    label: label?.trim() || null,
    uploadedBy: auth.userId,
  }).returning();

  const [version] = await tx.insert(documentVersions).values({
    tenantId: auth.tenantId,
    documentId: doc.id,
    version: 1,
    filename: safeName,
    mimeType: file.type || "application/octet-stream",
    filePath: finalPath,
    fileSize: file.size,
    extractedText: null,
    uploadedBy: auth.userId,
    uploadSource,
    isCurrent: true,
  }).returning();

  scheduleThumbnail(finalPath, doc.id);

  await tx.insert(auditLogs).values({
    tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH_ATTACHMENT",
    resource: "documents", resourceId: doc.id,
    metadata: JSON.stringify({ identifier, filename: safeName, label: label ?? null }), ip,
  });

  const fullDoc = await tx.query.documents.findFirst({
    where: eq(documents.id, doc.id),
    with: { identifier: true },
  });

  return {
    success: true,
    message: "Anexo associado com sucesso.",
    document: hydrateDocument(fullDoc!, version),
  };
}

/** New version of an existing document (primary or attachment). */
export async function createDocumentVersion(
  tx: DB,
  auth: AuthPayload,
  opts: { documentId: string; file: File; uploadSource?: "manual" | "scanner" | "sync" },
  ip: string = "unknown",
) {
  const { documentId, file, uploadSource = "manual" } = opts;

  const doc = await tx.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.tenantId, auth.tenantId)),
    with: { identifier: true },
  });
  if (!doc) throw new Error("Documento não encontrado.");
  if (!doc.identifier) throw new Error("Identificador do documento não encontrado.");
  if (doc.identifier.status === "cancelled") throw new Error("Não é possível versionar um documento de identificador cancelado.");
  if (!(await canWriteIdentifier(auth, doc.identifier as any))) {
    throw new Error("Sem permissão para criar versões deste documento.");
  }

  const identifier = doc.identifier.identifier;
  const { finalPath, safeName } = await writeUploadFile(file, identifier);

  let verification: Awaited<ReturnType<typeof verifyDocumentContainsIdentifier>> | null = null;
  if (doc.kind === "primary") {
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
    let version: typeof documentVersions.$inferSelect;
    try {
      const inserted = await tx.transaction(async (tx2) => {
        const [newDoc] = await tx2.insert(documents).values({
          tenantId: auth.tenantId,
          identifierId: idRow.id,
          kind: "primary",
          uploadedBy: auth.userId,
        }).returning();

        const [newVersion] = await tx2.insert(documentVersions).values({
          tenantId: auth.tenantId,
          documentId: newDoc.id,
          version: 1,
          filename: safeName,
          mimeType: file.type || "application/octet-stream",
          filePath: finalPath,
          fileSize: file.size,
          extractedText: verification.excerpt ?? null,
          uploadedBy: auth.userId,
          uploadSource,
          isCurrent: true,
        }).returning();

        await tx2.update(identifiers).set({ status: "attached" }).where(eq(identifiers.id, idRow.id));
        return { newDoc, newVersion };
      });
      doc = inserted.newDoc;
      version = inserted.newVersion;
    } catch (err: any) {
      fs.unlinkSync(finalPath);
      await tx.insert(auditLogs).values({
        tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH_FAILED",
        resource: "documents", resourceId: idRow.id,
        metadata: JSON.stringify({ filename: file.name, reason: "concurrent_attach_or_db_error" }), ip,
      });
      throw new Error("Este identificador já foi associado a um documento entretanto. Tente novamente.");
    }

    scheduleThumbnail(finalPath, doc.id);

    await tx.insert(auditLogs).values({
      tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH",
      resource: "documents", resourceId: doc.id,
      metadata: JSON.stringify({ identifier, filename: safeName, method: verification.method }), ip,
    });

    const fullDoc = await tx.query.documents.findFirst({
      where: eq(documents.id, doc.id),
      with: { identifier: true },
    });

    return {
      success: true,
      message: "Documento associado com sucesso.",
      document: hydrateDocument(fullDoc!, version),
      verification,
    };
  });
}

/** Attachment: creates document kind=attachment + version 1. Identifier must already have a primary. */
export async function attachAttachment(
  tx: DB,
  auth: AuthPayload,
  opts: { identifier: string; file: File; label?: string; uploadSource?: "manual" | "scanner" | "sync"; idempotencyKey?: string },
  ip: string = "unknown",
) {
  const { identifier, file, label, uploadSource = "manual", idempotencyKey } = opts;

  return await withIdempotency(tx, auth.tenantId, idempotencyKey, async () => {
    const idRow = await tx.query.identifiers.findFirst({
      where: and(eq(identifiers.identifier, identifier), eq(identifiers.tenantId, auth.tenantId)),
      with: { documents: true },
    });
    if (!idRow) throw new Error(`Identificador '${identifier}' não encontrado.`);
    if (idRow.status === "cancelled") throw new Error("Não é possível associar a um identificador cancelado.");
    if (!(await canWriteIdentifier(auth, idRow))) {
      throw new Error("Sem permissão para adicionar anexos a este identificador.");
    }

    const primary = pickPrimaryDocument(idRow.documents);
    if (!primary) throw new Error("O identificador ainda não tem documento principal. Associe o documento principal primeiro.");

    const { finalPath, safeName } = await writeUploadFile(file, identifier);

    const [doc] = await tx.insert(documents).values({
      tenantId: auth.tenantId,
      identifierId: idRow.id,
      kind: "attachment",
      label: label?.trim() || null,
      uploadedBy: auth.userId,
    }).returning();

    const [version] = await tx.insert(documentVersions).values({
      tenantId: auth.tenantId,
      documentId: doc.id,
      version: 1,
      filename: safeName,
      mimeType: file.type || "application/octet-stream",
      filePath: finalPath,
      fileSize: file.size,
      extractedText: null,
      uploadedBy: auth.userId,
      uploadSource,
      isCurrent: true,
    }).returning();

    scheduleThumbnail(finalPath, doc.id);

    await tx.insert(auditLogs).values({
      tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH_ATTACHMENT",
      resource: "documents", resourceId: doc.id,
      metadata: JSON.stringify({ identifier, filename: safeName, label: label ?? null }), ip,
    });

    const fullDoc = await tx.query.documents.findFirst({
      where: eq(documents.id, doc.id),
      with: { identifier: true },
    });

    return {
      success: true,
      message: "Anexo associado com sucesso.",
      document: hydrateDocument(fullDoc!, version),
    };
  });
}

/** New version of an existing document (primary or attachment). */
export async function createDocumentVersion(
  tx: DB,
  auth: AuthPayload,
  opts: { documentId: string; file: File; uploadSource?: "manual" | "scanner" | "sync"; idempotencyKey?: string },
  ip: string = "unknown",
) {
  const { documentId, file, uploadSource = "manual", idempotencyKey } = opts;

  return await withIdempotency(tx, auth.tenantId, idempotencyKey, async () => {
    const doc = await tx.query.documents.findFirst({
      where: and(eq(documents.id, documentId), eq(documents.tenantId, auth.tenantId)),
      with: { identifier: true },
    });
    if (!doc) throw new Error("Documento não encontrado.");
    if (!doc.identifier) throw new Error("Identificador do documento não encontrado.");
    if (doc.identifier.status === "cancelled") throw new Error("Não é possível versionar um documento de identificador cancelado.");
    if (!(await canWriteIdentifier(auth, doc.identifier))) {
      throw new Error("Sem permissão para criar versões deste documento.");
    }

    const identifier = doc.identifier.identifier;
    const { finalPath, safeName } = await writeUploadFile(file, identifier);

    let verification: Awaited<ReturnType<typeof verifyDocumentContainsIdentifier>> | null = null;
    if (doc.kind === "primary") {
      try {
        verification = await verifyDocumentContainsIdentifier(finalPath, file.type || "application/octet-stream", identifier);
      } catch (err: any) {
        fs.unlinkSync(finalPath);
        throw new Error(`Erro na verificação: ${err.message}`);
      }
      if (!verification.found) {
        fs.unlinkSync(finalPath);
        await tx.insert(auditLogs).values({
          tenantId: auth.tenantId, userId: auth.userId, action: "VERSION_FAILED",
          resource: "documents", resourceId: doc.id,
          metadata: JSON.stringify({ filename: file.name, reason: "identifier_not_found" }), ip,
        });
        return { success: false, message: `O documento não contém o identificador '${identifier}'.`, verification };
      }
    }

    let version: typeof documentVersions.$inferSelect;
    try {
      version = await tx.transaction(async (tx2) => {
        const latest = await tx2.query.documentVersions.findFirst({
          where: eq(documentVersions.documentId, doc.id),
          orderBy: [desc(documentVersions.version)],
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        await tx2.update(documentVersions)
          .set({ isCurrent: false })
          .where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.isCurrent, true)));

        const [newVersion] = await tx2.insert(documentVersions).values({
          tenantId: auth.tenantId,
          documentId: doc.id,
          version: nextVersion,
          filename: safeName,
          mimeType: file.type || "application/octet-stream",
          filePath: finalPath,
          fileSize: file.size,
          extractedText: verification?.excerpt ?? null,
          uploadedBy: auth.userId,
          uploadSource,
          isCurrent: true,
        }).returning();
        return newVersion;
      });
    } catch (err: any) {
      fs.unlinkSync(finalPath);
      throw new Error(`Erro ao criar versão: ${err.message}`);
    }

    scheduleThumbnail(finalPath, doc.id);

    await tx.insert(auditLogs).values({
      tenantId: auth.tenantId, userId: auth.userId, action: "VERSION",
      resource: "documents", resourceId: doc.id,
      metadata: JSON.stringify({
        identifier,
        filename: safeName,
        version: version.version,
        kind: doc.kind,
        method: verification?.method ?? null,
      }), ip,
    });

    return {
      success: true,
      message: `Versão ${version.version} criada com sucesso.`,
      document: hydrateDocument(doc, version),
      version,
      verification,
    };
  });
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

  return { allowed: false, restricted: true };
}

export async function getDocumentMeta(tx: DB, auth: AuthPayload, docId: string) {
  const doc = await tx.query.documents.findFirst({
    where: and(eq(documents.id, docId), eq(documents.tenantId, auth.tenantId)),
    with: {
      identifier: { with: { category: true } },
      versions: {
        orderBy: [desc(documentVersions.version)],
        with: { uploader: true },
      },
    },
  });
  if (!doc) return null;

  const { allowed, restricted } = await canAccessDocument(
    tx, auth, doc.identifier?.sectorId ?? null, doc.identifier?.visibility ?? null, doc.id, doc.uploadedBy,
  );
  if (!allowed && !restricted) return null;

  const current = doc.versions.find((v) => v.isCurrent) ?? doc.versions[0];
  const versions = doc.versions.map((v) => ({
    id: v.id,
    version: v.version,
    filename: v.filename,
    fileSize: v.fileSize,
    mimeType: v.mimeType,
    isCurrent: v.isCurrent,
    createdAt: v.createdAt,
    uploadedBy: v.uploader?.fullName || null,
    uploadSource: v.uploadSource,
  }));

  const siblings = await tx.query.documents.findMany({
    where: and(eq(documents.identifierId, doc.identifierId), eq(documents.tenantId, auth.tenantId)),
    with: {
      versions: {
        where: eq(documentVersions.isCurrent, true),
      },
    },
    orderBy: [desc(documents.createdAt)],
  });

  const attachments = siblings
    .filter((s) => s.kind === "attachment" && s.id !== doc.id)
    .map((s) => {
      const cur = s.versions[0];
      return {
        id: s.id,
        kind: s.kind,
        label: s.label,
        filename: cur?.filename ?? null,
        fileSize: cur?.fileSize ?? null,
        mimeType: cur?.mimeType ?? null,
        createdAt: s.createdAt,
      };
    });

  const primarySibling = siblings.find((s) => s.kind === "primary");

  return {
    ...hydrateDocument(doc, current, { versions, attachments, primaryDocumentId: primarySibling?.id ?? null }),
    restricted,
  };
}

export async function downloadDocument(
  tx: DB,
  auth: AuthPayload,
  docId: string,
  versionNumber?: number,
): Promise<{ filePath: string; fileName: string } | { error: "NOT_FOUND" | "ACCESS_REQUIRED" }> {
  const doc = await tx.query.documents.findFirst({
    where: and(eq(documents.id, docId), eq(documents.tenantId, auth.tenantId)),
    with: { identifier: true },
  });
  if (!doc) return { error: "NOT_FOUND" };

  const version = versionNumber != null
    ? await tx.query.documentVersions.findFirst({
        where: and(eq(documentVersions.documentId, docId), eq(documentVersions.version, versionNumber)),
      })
    : await getCurrentVersion(tx, docId);

  if (!version || !fs.existsSync(version.filePath)) return { error: "NOT_FOUND" };

  const { allowed, restricted } = await canAccessDocument(
    tx, auth, doc.identifier?.sectorId ?? null, doc.identifier?.visibility ?? null, doc.id, doc.uploadedBy,
  );
  if (!allowed && restricted) return { error: "ACCESS_REQUIRED" };
  if (!allowed) return { error: "NOT_FOUND" };

  const resolvedPath = path.resolve(version.filePath);
  if (!isPathInsideDir(resolvedPath, RESOLVED_UPLOAD_DIR)) {
    return { error: "NOT_FOUND" };
  }

  return { filePath: resolvedPath, fileName: version.filename };
}

export async function updateDocumentTags(
  tx: DB,
  auth: AuthPayload,
  docId: string,
  tags: string[],
) {
  const doc = await tx.query.documents.findFirst({
    where: and(eq(documents.id, docId), eq(documents.tenantId, auth.tenantId)),
    with: { identifier: true },
  });
  if (!doc) return { error: "NOT_FOUND" as const };

  if (!(await canWriteIdentifier(auth, {
    sectorId: doc.identifier?.sectorId ?? null,
    createdBy: doc.identifier?.createdBy ?? doc.uploadedBy,
  } as any))) {
    return { error: "FORBIDDEN" as const };
  }

  const serialized = serializeDocumentTags(tags);
  await tx.update(documents).set({ tags: serialized }).where(eq(documents.id, docId));

  return { success: true as const, tags: parseDocumentTags(serialized) };
}

export async function listDocumentsForApi(
  tx: DB,
  auth: AuthPayload,
  opts: { tenantId: string; identifierId?: string; page: number; limit: number },
) {
  const conditions = [eq(documents.tenantId, opts.tenantId)];
  if (opts.identifierId) conditions.push(eq(documents.identifierId, opts.identifierId));

  const allRows = await tx.query.documents.findMany({
    where: and(...conditions),
    with: {
      identifier: { with: { category: true } },
      uploader: true,
      versions: {
        where: eq(documentVersions.isCurrent, true),
      },
    },
    orderBy: [desc(documents.createdAt)],
  });

  const sharedDocIds = await getSharedDocIds(tx, auth);
  const visibleRows = allRows.filter((d) => {
    const visibility = d.identifier?.visibility ?? "public";
    if (d.uploadedBy === auth.userId) return true;
    if (visibility === "public") return true;
    if (d.identifier?.sectorId != null && d.identifier.sectorId === auth.sectorId) return true;
    if (sharedDocIds.has(d.id)) return true;
    return false;
  });

  // Default listing: one row per identifier (primary). When filtering by identifierId, return all kinds.
  const filtered = opts.identifierId
    ? visibleRows
    : visibleRows.filter((d) => d.kind === "primary");

  const total = filtered.length;
  const offset = (opts.page - 1) * opts.limit;
  const paginated = filtered.slice(offset, offset + opts.limit);

  const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  const safe = paginated.map((d) => {
    const current = d.versions[0];
    return {
      id: d.id,
      kind: d.kind,
      label: d.label,
      tags: parseDocumentTags(d.tags),
      filename: current?.filename ?? null,
      fileSize: current?.fileSize ?? null,
      mimeType: current?.mimeType ?? null,
      status: d.identifier?.status || "active",
      createdAt: d.createdAt,
      fileUrl: `${baseUrl}/documents/${d.id}/download`,
      thumbnailUrl: `${baseUrl}/documents/${d.id}/thumbnail`,
      identifier: d.identifier ? {
        id: d.identifier.id,
        identifier: d.identifier.identifier,
        categoryId: d.identifier.category?.id,
        categoryName: d.identifier.category?.name,
      } : null,
      uploadedBy: d.uploader?.fullName || null,
    };
  });

  return { data: safe, meta: { total, page: opts.page, limit: opts.limit } };
}
