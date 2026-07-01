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
  // CORREÇÃO: lista alinhada com o que verifyDocumentContainsIdentifier (document.service.ts)
  // consegue extrair como TEXTO hoje (.pdf, .docx, e os tipos de texto puro). .doc,
  // .xls/.xlsx, .ppt/.pptx e .odt foram removidos — estavam aqui mas nunca chegavam a
  // esta função, porque a verificação falhava sempre antes (código morto que sugeria
  // suporte inexistente).
  // As extensões de imagem ficam por agora, mas atenção: também elas falham sempre na
  // verificação (não há OCR implementado em document.service.ts) — ver nota lá. Não as
  // removi porque, ao contrário dos formatos de escritório, gerar thumbnail de uma
  // imagem não depende de extracção de texto; mas o anexo desse ficheiro vai falhar de
  // qualquer forma na verificação antes de chegar aqui, até existir OCR.
  const supported = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".docx"];
  const ext = path.extname(filePath).toLowerCase();
  if (!supported.includes(ext)) return;

  const thumbPath = path.join(THUMBNAIL_DIR, `${docId}.png`);
  const scriptPath = path.resolve(THUMBNAIL_SCRIPT);

  // CORREÇÃO CRÍTICA: antes, stdio era totalmente ignorado ("ignore" nos 3 canais) e o
  // processo era "detached + unref" sem qualquer acompanhamento — qualquer falha
  // (script em falta, dependência Python ausente, erro de conversão) desaparecia sem
  // deixar rasto nenhum. O sintoma visível era sempre o mesmo: thumbnail nunca
  // aparece, endpoint /thumbnail devolve 204 para sempre, e não há forma de saber
  // porquê. Agora verificamos primeiro se o script existe (falha mais comum e mais
  // fácil de diagnosticar) e capturamos stderr/exit code do processo, para que uma
  // falha real apareça nos logs do servidor em vez de desaparecer silenciosamente.
  // Continua "fire and forget" do ponto de vista de quem chama (attachDocument não
  // espera por isto), mas deixa de ser uma caixa preta.
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
  auth: AuthPayload,
  opts: { identifier: string; file: File; uploadSource?: "manual" | "scanner" | "sync" },
  ip: string = "unknown",
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
      metadata: JSON.stringify({ filename: file.name, reason: "identifier_not_found" }), ip,
    });
    return { success: false, message: `O documento não contém o identificador '${identifier}'.`, verification };
  }

  // CORREÇÃO: insere o documento e marca o identificador como "attached" numa única
  // transacção. Antes, entre a verificação de `idRow.status === "attached"` e este
  // insert havia uma janela de corrida: dois attaches concorrentes para o mesmo
  // identificador podiam ambos passar a verificação e colidir na FK única
  // documents.identifierId, deixando o segundo pedido rebentar com uma excepção não
  // tratada e o ficheiro já escrito em disco a ficar órfão (nunca seria apagado).
  // Com a transacção, se o insert falhar (ex.: corrida), apanhamos o erro aqui,
  // limpamos o ficheiro e devolvemos uma mensagem clara em vez de deixar lixo em disco.
  let doc: typeof documents.$inferSelect;
  try {
    [doc] = await db.transaction(async (tx) => {
      const inserted = await tx.insert(documents).values({
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
      await tx.update(identifiers).set({ status: "attached" }).where(eq(identifiers.id, idRow.id));
      return inserted;
    });
  } catch (err: any) {
    fs.unlinkSync(finalPath);
    await db.insert(auditLogs).values({
      tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH_FAILED",
      resource: "documents", resourceId: idRow.id,
      metadata: JSON.stringify({ filename: file.name, reason: "concurrent_attach_or_db_error" }), ip,
    });
    throw new Error("Este identificador já foi associado a um documento entretanto. Tente novamente.");
  }

  generateThumbnailAsync(finalPath, doc.id);

  await db.insert(auditLogs).values({
    tenantId: auth.tenantId, userId: auth.userId, action: "ATTACH",
    resource: "documents", resourceId: doc.id,
    metadata: JSON.stringify({ identifier, filename: safeName, method: verification.method }), ip,
  });

  const fullDoc = await db.query.documents.findFirst({
    where: eq(documents.id, doc.id),
    with: { identifier: true },
  });

  return { success: true, message: "Documento associado com sucesso.", document: fullDoc, verification };
}

export async function canAccessDocument(auth: AuthPayload, sectorId: string | null, visibility: string | null, docId: string | null, uploadedBy: string | null = null): Promise<{ allowed: boolean; restricted: boolean }> {
  const v = visibility ?? "public";

  // Nível 0 — dono do documento tem sempre acesso, independentemente de sector ou
  // visibilidade actuais. CORREÇÃO: esta verificação faltava aqui, apesar de já
  // existir tanto em canShareDocument como na antiga canViewDocument do módulo de
  // rotas — inconsistência que podia deixar o próprio uploader sem acesso ao seu
  // documento (ex.: se for movido de sector depois de o ter enviado).
  if (uploadedBy && auth.userId === uploadedBy) return { allowed: true, restricted: false };

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
      // CORREÇÃO CRÍTICA: faltava este filtro. Sem ele, uma partilha cross-sector
      // ainda "pending_approval" (à espera do supervisor aprovar) já concedia acesso
      // total ao download e à metadata, contornando por completo o fluxo de aprovação.
      eq(documentShares.status, "active"),
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

// CORREÇÃO: ambas as funções abaixo recebiam "identifier" (o código legível,
// identifiers.identifier) e resolviam o documento a partir daí. Mas o resto da API
// (GET /documents, thumbnail) já trabalha com documents.id (UUID) — e era exactamente
// esse UUID que o módulo de rotas estava a passar para aqui, o que fazia o lookup por
// identifiers.identifier nunca dar match. Resultado: /:id e /:id/download devolviam
// sempre 404, mesmo para documentos existentes e acessíveis. Agora ambas resolvem
// directamente por documents.id, alinhado com o resto da API.
export async function getDocumentMeta(auth: AuthPayload, docId: string) {
  const doc = await db.query.documents.findFirst({
    where: and(eq(documents.id, docId), eq(documents.tenantId, auth.tenantId)),
    with: { identifier: { with: { category: true } } },
  });
  if (!doc) return null;

  const { allowed, restricted } = await canAccessDocument(
    auth, doc.identifier?.sectorId ?? null, doc.identifier?.visibility ?? null, doc.id, doc.uploadedBy,
  );
  if (!allowed && !restricted) return null;

  return { ...doc, restricted };
}

export async function downloadDocument(auth: AuthPayload, docId: string): Promise<{ filePath: string; fileName: string } | { error: "NOT_FOUND" | "ACCESS_REQUIRED" }> {
  const doc = await db.query.documents.findFirst({
    where: and(eq(documents.id, docId), eq(documents.tenantId, auth.tenantId)),
    with: { identifier: true },
  });
  if (!doc || !fs.existsSync(doc.filePath)) return { error: "NOT_FOUND" };

  const { allowed, restricted } = await canAccessDocument(
    auth, doc.identifier?.sectorId ?? null, doc.identifier?.visibility ?? null, doc.id, doc.uploadedBy,
  );
  if (!allowed && restricted) return { error: "ACCESS_REQUIRED" };
  if (!allowed) return { error: "NOT_FOUND" };

  const resolvedPath = path.resolve(doc.filePath);
  if (!resolvedPath.startsWith(RESOLVED_UPLOAD_DIR)) {
    return { error: "NOT_FOUND" };
  }

  return { filePath: resolvedPath, fileName: doc.filename };
}