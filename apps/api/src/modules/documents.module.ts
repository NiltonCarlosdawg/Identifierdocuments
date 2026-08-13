import { Elysia, t } from "elysia";
import fs from "node:fs";
import path from "node:path";
import {
  attachDocument, attachAttachment, createDocumentVersion,
  getDocumentMeta, downloadDocument, canAccessDocument,
  pickPrimaryDocument, listDocumentsForApi, updateDocumentTags,
  isPathInsideDir,
} from "../services/attachment.service";
import { requireAuth, getFreshRoles } from "../middleware/auth";
import { documents, documentShares, approvals, sectors, auditLogs, identifiers, users, documentAccessRequests } from "../db/schema";
import { eq, and, isNull, or } from "drizzle-orm";
import { notify } from "../services/notification.service";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";


async function resolveIdentifierPrimary(tx: any, tenantId: string, code: string, extraWith: Record<string, boolean> = {}) {
  const idRow = await tx.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, code), eq(identifiers.tenantId, tenantId)),
    with: { documents: true, ...extraWith },
  });
  if (!idRow) return null;
  return { ...idRow, document: pickPrimaryDocument(idRow.documents) ?? null };
}

async function canShareDocument(tx: any, auth: any, docSectorId: string | null, docUploadedBy: string | null): Promise<boolean> {
  if (auth.userId === docUploadedBy) return true;
  const roleNames = await getFreshRoles(auth.userId, auth.tenantId);
  if (roleNames.includes("ORG_ADMIN")) return true;
  if (!docSectorId) return false;
  const sector = await tx.query.sectors.findFirst({ where: eq(sectors.id, docSectorId) });
  if (sector?.supervisorId === auth.userId) return true;
  return false;
}

export const documentsModule = new Elysia({ prefix: "/documents" })
  .use(requireAuth())

  .post("/attach", async ({ auth, body, set, clientIp, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const result = await attachDocument(tx, auth!, {
            identifier: body.identifier, file: body.file,
            uploadSource: body.uploadSource,
          }, clientIp);
          if (!result.success) { set.status = 422; return result; }
          return result;
        } catch (err: any) {
          console.error("[ATTACH_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "ATTACH_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({
      identifier: t.String(),
      file: t.File(),
      uploadSource: t.Optional(t.Union([t.Literal("manual"), t.Literal("scanner"), t.Literal("sync")])),
    }),
    detail: { summary: "Associar documento", tags: ["Documentos"] },
  })

  .post("/attachments", async ({ auth, body, set, clientIp, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const result = await attachAttachment(tx, auth!, {
            identifier: body.identifier,
            file: body.file,
            label: body.label,
            uploadSource: body.uploadSource,
          }, clientIp);
          return result;
        } catch (err: any) {
          console.error("[ATTACHMENT_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "ATTACHMENT_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({
      identifier: t.String(),
      file: t.File(),
      label: t.Optional(t.String()),
      uploadSource: t.Optional(t.Union([t.Literal("manual"), t.Literal("scanner"), t.Literal("sync")])),
    }),
    detail: { summary: "Adicionar anexo a um identificador", tags: ["Documentos"] },
  })

  .get("/", async ({ tenantId, auth, query, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const parsedLimit = parseInt(query.limit || "20", 10);
          const limit = Math.min(Math.max(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20, 1), 100);
          const parsedPage = parseInt(query.page || "1", 10);
          const page = Math.max(1, Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1);

          return await listDocumentsForApi(tx, auth!, {
            tenantId,
            identifierId: query.identifierId,
            page,
            limit,
          });
        } catch (err: any) {
          console.error("[LIST_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 500;
      return { error: { code: "LIST_ERROR", message: safeError(err) } };
    }
  }, {
    query: t.Object({
      limit: t.Optional(t.String()),
      page: t.Optional(t.String()),
      identifierId: t.Optional(t.String()),
    }),
    detail: { summary: "Listar documentos", tags: ["Documentos"] },
  })

  .patch("/:id/tags", async ({ tenantId, auth, params, body, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        const result = await updateDocumentTags(tx, auth!, params.id, body.tags);
        if ("error" in result) {
          if (result.error === "FORBIDDEN") {
            set.status = 403;
            return { error: { code: "FORBIDDEN", message: "Sem permissão para editar tags." } };
          }
          set.status = 404;
          return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
        }
        return { data: { tags: result.tags } };
      });
    } catch (err: any) {
      set.status = 500;
      return { error: { code: "TAGS_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      tags: t.Array(t.String({ minLength: 1, maxLength: 64 }), { maxItems: 24 }),
    }),
    detail: { summary: "Actualizar tags de perfil do documento", tags: ["Documentos"] },
  })

  .get("/:param", async ({ tenantId, auth, params, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.param);

          if (isUuid) {
            const doc = await getDocumentMeta(tx, auth!, params.param);
            if (!doc) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } }; }
            return { data: doc };
          }

          // CORREÇÃO: este branch filtrava documents.findFirst por
          // identifiers.identifier sem qualquer join para a tabela identifiers (SQL
          // inválido / não filtra o que devia) e, mais grave, não passava pelo
          // controlo de acesso (canAccessDocument/getDocumentMeta) usado no branch
          // UUID — permitia obter metadados de qualquer documento de qualquer sector
          // só por se saber o identifier code. Resolve-se agora sempre por
          // identifiers.identifier + tenantId, reutilizando getDocumentMeta.
          const idRow = await resolveIdentifierPrimary(tx, tenantId, params.param);
          if (!idRow?.document) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } }; }

          const doc = await getDocumentMeta(tx, auth!, idRow.document.id);
          if (!doc) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } }; }
          return { data: doc };
        } catch (err: any) {
          console.error("[DOCUMENT_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 500;
      return { error: { code: "DOCUMENT_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ param: t.String() }),
    detail: { summary: "Metadados do documento (UUID ou identifier code)", tags: ["Documentos"] },
  })

  .get("/:param/download", async ({ tenantId, auth, params, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          // CORREÇÃO: o summary deste endpoint diz "UUID ou identifier code" mas só
          // funcionava com UUID — downloadDocument() filtra por documents.id, e um
          // identifier code nunca corresponde a esse campo, resultando sempre em
          // NOT_FOUND. Resolve-se aqui o identifier code para o UUID do documento,
          // tal como já era feito no endpoint de thumbnail (abaixo, inalterado).
          const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          let docId = params.param;
          if (!UUID_REGEX.test(docId)) {
            const idRow = await resolveIdentifierPrimary(tx, tenantId, params.param);
            if (!idRow?.document) {
              set.status = 404;
              return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
            }
            docId = idRow.document.id;
          }

          const result = await downloadDocument(tx, auth!, docId);
          if ("error" in result) {
            if (result.error === "ACCESS_REQUIRED") {
              set.status = 403;
              return { error: { code: "ACCESS_REQUIRED", message: "Solicite acesso ao supervisor do sector emitente." } };
            }
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Ficheiro não encontrado." } };
          }
          const fileBuffer = fs.readFileSync(result.filePath);
          const asciiName = result.fileName.replace(/[^\x20-\x7E]/g, "_");
          set.headers["Content-Disposition"] = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`;
          set.headers["Content-Type"] = "application/octet-stream";
          return fileBuffer;
        } catch (err: any) {
          console.error("[DOWNLOAD_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 500;
      return { error: { code: "DOWNLOAD_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ param: t.String() }),
    detail: { summary: "Download do documento (UUID ou identifier code)", tags: ["Documentos"] },
  })

  .get("/:param/thumbnail", async ({ tenantId, auth, params, set }) => {
    return withTenant(tenantId, async (tx) => {
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let docId = params.param;
      if (!UUID_REGEX.test(docId)) {
        const idRow = await resolveIdentifierPrimary(tx, tenantId, params.param);
        if (!idRow?.document) {
          set.status = 404;
          return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
        }
        docId = idRow.document.id;
      }

      const doc = await tx.query.documents.findFirst({
        where: and(eq(documents.id, docId), eq(documents.tenantId, tenantId)),
        with: { identifier: true },
      });
      if (!doc) {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
      }

      const { allowed, restricted } = await canAccessDocument(
        tx, auth!, doc.identifier?.sectorId ?? null, doc.identifier?.visibility ?? null, doc.id, doc.uploadedBy,
      );
      if (!allowed) {
        set.status = restricted ? 403 : 404;
        return restricted
          ? { error: { code: "ACCESS_REQUIRED", message: "Solicite acesso ao supervisor do sector emitente." } }
          : { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
      }

      const THUMBNAIL_DIR = path.resolve(process.env.THUMBNAIL_DIR || path.join(import.meta.dir, "../../thumbnails"));
      const thumbPath = path.join(THUMBNAIL_DIR, `${docId}.png`);
      try {
        if (!isPathInsideDir(thumbPath, THUMBNAIL_DIR) || !fs.existsSync(thumbPath)) {
          set.status = 204;
          return new Uint8Array(0);
        }
        const fileBuffer = fs.readFileSync(thumbPath);
        set.headers["Content-Type"] = "image/png";
        set.headers["Cache-Control"] = "private, max-age=86400";
        return fileBuffer;
      } catch (err: any) {
        set.status = 204;
        return new Uint8Array(0);
      }
    });
  }, {
    params: t.Object({ param: t.String() }),
    detail: { summary: "Thumbnail do documento (UUID ou identifier code)", tags: ["Documentos"] },
  })

  .post("/:param/versions", async ({ auth, body, set, clientIp, tenantId, params }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const result = await createDocumentVersion(tx, auth!, {
            documentId: params.param,
            file: body.file,
            uploadSource: body.uploadSource,
          }, clientIp);
          if (!result.success) { set.status = 422; return result; }
          return result;
        } catch (err: any) {
          console.error("[VERSION_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "VERSION_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ param: t.String() }),
    body: t.Object({
      file: t.File(),
      uploadSource: t.Optional(t.Union([t.Literal("manual"), t.Literal("scanner"), t.Literal("sync")])),
    }),
    detail: { summary: "Criar nova versão de um documento", tags: ["Documentos"] },
  })

  .get("/:param/versions/:version/download", async ({ tenantId, auth, params, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const versionNum = parseInt(params.version, 10);
          if (!Number.isFinite(versionNum) || versionNum < 1) {
            set.status = 400;
            return { error: { code: "VALIDATION_ERROR", message: "Versão inválida." } };
          }
          const result = await downloadDocument(tx, auth!, params.param, versionNum);
          if ("error" in result) {
            if (result.error === "ACCESS_REQUIRED") {
              set.status = 403;
              return { error: { code: "ACCESS_REQUIRED", message: "Solicite acesso ao supervisor do sector emitente." } };
            }
            set.status = 404;
            return { error: { code: "NOT_FOUND", message: "Ficheiro não encontrado." } };
          }
          const fileBuffer = fs.readFileSync(result.filePath);
          const asciiName = result.fileName.replace(/[^\x20-\x7E]/g, "_");
          set.headers["Content-Disposition"] = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`;
          set.headers["Content-Type"] = "application/octet-stream";
          return fileBuffer;
        } catch (err: any) {
          console.error("[VERSION_DOWNLOAD_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 500;
      return { error: { code: "DOWNLOAD_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ param: t.String(), version: t.String() }),
    detail: { summary: "Download de uma versão específica", tags: ["Documentos"] },
  })

  .post("/:param/share", async ({ tenantId, auth, params, body, set, clientIp }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          if (!body.sectorId && !body.userId) {
            set.status = 422;
            return { error: { code: "VALIDATION_ERROR", message: "Indique sectorId ou userId." } };
          }
          // CORREÇÃO (Fix 7): sectorId e userId em simultâneo criavam uma partilha
          // com semântica ambígua e complicavam a lógica de aprovação cross-sector.
          // Uma partilha tem sempre um único destinatário: sector OU utilizador.
          if (body.sectorId && body.userId) {
            set.status = 422;
            return { error: { code: "VALIDATION_ERROR", message: "Indique apenas sectorId OU userId, não ambos." } };
          }

          const idRow = await resolveIdentifierPrimary(tx, tenantId, params.param);
          if (!idRow || !idRow.document) {
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
          }
          if (!(await canShareDocument(tx, auth!, idRow.sectorId, idRow.document.uploadedBy))) {
            set.status = 403; return { error: { code: "FORBIDDEN", message: "Não tem permissão para partilhar este documento." } };
          }
          const docId = idRow.document.id;

          let targetSector: typeof sectors.$inferSelect | undefined;
          let isCrossSector = false;
          let approvalSectorId: string | null = null;
          let approvalSupervisorId: string | null = null;

          if (body.sectorId) {
            targetSector = await tx.query.sectors.findFirst({ where: eq(sectors.id, body.sectorId) });
            if (!targetSector || targetSector.tenantId !== tenantId) {
              set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Sector destino não encontrado." } };
            }
            isCrossSector = idRow.sectorId !== body.sectorId;

            if (isCrossSector) {
              if (!targetSector.supervisorId) {
                set.status = 422;
                return {
                  error: {
                    code: "NO_SUPERVISOR",
                    message: "O sector destino não tem supervisor definido. Não é possível criar partilha cross-sector sem aprovação.",
                  },
                };
              }
              approvalSectorId = body.sectorId;
              approvalSupervisorId = targetSector.supervisorId;
            }
          }

          // CORREÇÃO (Fix 3): partilhar directamente com um userId de outro sector
          // saltava por completo o fluxo de aprovação cross-sector (só era
          // considerado quando body.sectorId era passado). Um supervisor podia
          // contornar a aprovação do supervisor do sector alvo bastando partilhar
          // pessoa-a-pessoa em vez de sector-a-sector. Agora a mesma regra aplica-se
          // a partilhas com userId cujo sector difere do sector do documento.
          if (body.userId) {
            const targetUser = await tx.query.users.findFirst({ where: eq(users.id, body.userId) });
            if (!targetUser || targetUser.tenantId !== tenantId) {
              set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Utilizador destino não encontrado." } };
            }
            isCrossSector = targetUser.sectorId != null && targetUser.sectorId !== idRow.sectorId;
            if (isCrossSector) {
              const userSector = await tx.query.sectors.findFirst({ where: eq(sectors.id, targetUser.sectorId!) });
              if (!userSector?.supervisorId) {
                set.status = 422;
                return {
                  error: {
                    code: "NO_SUPERVISOR",
                    message: "O sector do utilizador destino não tem supervisor definido. Não é possível criar partilha cross-sector sem aprovação.",
                  },
                };
              }
              approvalSectorId = targetUser.sectorId!;
              approvalSupervisorId = userSector.supervisorId;
            }
          }

          const [share] = await tx.insert(documentShares).values({
            documentId: docId, sharedBy: auth!.userId,
            sharedWithSectorId: body.sectorId ?? null,
            sharedWithUserId: body.userId ?? null,
            status: isCrossSector ? "pending_approval" : "active",
          }).returning({
            id: documentShares.id,
            documentId: documentShares.documentId,
            sharedBy: documentShares.sharedBy,
            sharedWithSectorId: documentShares.sharedWithSectorId,
            sharedWithUserId: documentShares.sharedWithUserId,
            status: documentShares.status,
            createdAt: documentShares.createdAt,
          });

          if (isCrossSector && approvalSectorId && approvalSupervisorId) {
            const [approval] = await tx.insert(approvals).values({
              tenantId, documentId: docId,
              shareId: share.id,
              sectorId: approvalSectorId, supervisorId: approvalSupervisorId,
              type: "cross_sector",
            }).returning({ id: approvals.id });

            await notify(tx, {
              type: "approval:pending",
              userId: approvalSupervisorId,
              tenantId,
              payload: { documentId: docId, identifier: params.param, sectorId: approvalSectorId, shareId: share.id, approvalId: approval.id },
            });
          } else if (body.sectorId && targetSector) {
            const members = await tx.query.users.findMany({
              where: eq(users.sectorId, body.sectorId),
            });
            for (const member of members) {
              if (member.id !== auth!.userId) {
                await notify(tx, {
                  type: "document:shared",
                  userId: member.id,
                  tenantId,
                  payload: { documentId: docId, identifier: params.param, sectorId: body.sectorId },
                });
              }
            }
          } else if (body.userId) {
            await notify(tx, {
              type: "document:shared",
              userId: body.userId,
              tenantId,
              payload: { documentId: docId, identifier: params.param, sharedBy: auth!.userId },
            });
          }

          await tx.insert(auditLogs).values({
            tenantId, userId: auth!.userId, action: "SHARE",
            resource: "documents", resourceId: docId,
            metadata: JSON.stringify({ sharedWithSector: body.sectorId, sharedWithUser: body.userId, status: share.status }),
            ip: clientIp,
          });

          return { data: share };
        } catch (err: any) {
          console.error("[SHARE_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "SHARE_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({
      sectorId: t.Optional(t.String()),
      userId: t.Optional(t.String()),
    }),
    detail: { summary: "Partilhar documento", tags: ["Partilha"] },
  })

  .get("/:param/shares", async ({ tenantId, auth, params, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const idRow = await resolveIdentifierPrimary(tx, tenantId, params.param);
          if (!idRow?.document) {
            set.status = 404;
            return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
          }
          if (!(await canShareDocument(tx, auth!, idRow.sectorId, idRow.document.uploadedBy))) {
            set.status = 403; return { error: { code: "FORBIDDEN", message: "Não tem permissão para ver partilhas deste documento." } };
          }
          const shares = await tx.query.documentShares.findMany({
            where: eq(documentShares.documentId, idRow.document.id),
            with: { sector: true, user: true, sharer: true },
          });
          return { data: shares };
        } catch (err: any) {
          console.error("[SHARES_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 500;
      return { error: { code: "SHARES_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ param: t.String() }),
    detail: { summary: "Listar partilhas", tags: ["Partilha"] },
  })

  .post("/:param/request-access", async ({ tenantId, auth, params, body, set, clientIp }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const idRow = await resolveIdentifierPrimary(tx, tenantId, params.param, { sector: true });
          if (!idRow?.document) {
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
          }
          if (idRow.visibility !== "sector_only") {
            set.status = 422; return { error: { code: "NOT_RESTRICTED", message: "Apenas documentos sector_only necessitam de pedido de acesso." } };
          }

          if (idRow.document.uploadedBy === auth!.userId) {
            set.status = 422; return { error: { code: "OWN_DOCUMENT", message: "É dono do documento — não precisa de pedir acesso." } };
          }

          const supervisorId = idRow.sector?.supervisorId;
          if (!supervisorId) {
            set.status = 422; return { error: { code: "NO_SUPERVISOR", message: "Sector emitente não tem supervisor definido." } };
          }

          const requester = await tx.query.users.findFirst({ where: eq(users.id, auth!.userId) });
          const existingAccess = await tx.query.documentShares.findFirst({
            where: and(
              eq(documentShares.documentId, idRow.document.id),
              eq(documentShares.status, "active"),
              isNull(documentShares.revokedAt),
              or(
                eq(documentShares.sharedWithUserId, auth!.userId),
                requester?.sectorId ? eq(documentShares.sharedWithSectorId, requester.sectorId) : undefined,
              ),
            ),
          });
          if (existingAccess) {
            set.status = 409;
            return { error: { code: "ALREADY_HAS_ACCESS", message: "Já tem acesso a este documento." } };
          }

          const existing = await tx.query.documentAccessRequests.findFirst({
            where: and(
              eq(documentAccessRequests.documentId, idRow.document.id),
              eq(documentAccessRequests.requesterId, auth!.userId),
              eq(documentAccessRequests.status, "pending"),
            ),
          });
          if (existing) {
            set.status = 409; return { error: { code: "ALREADY_REQUESTED", message: "Já existe um pedido de acesso pendente para este documento." } };
          }

          const [request] = await tx.insert(documentAccessRequests).values({
            tenantId, documentId: idRow.document.id,
            requesterId: auth!.userId,
          }).returning();

          await notify(tx, {
            type: "access:requested",
            userId: supervisorId,
            tenantId,
            payload: { documentId: idRow.document.id, identifier: params.param, requesterId: auth!.userId, requestId: request.id },
          });

          await tx.insert(auditLogs).values({
            tenantId, userId: auth!.userId, action: "REQUEST_ACCESS",
            resource: "documents", resourceId: idRow.document.id,
            metadata: JSON.stringify({ identifier: params.param, requestId: request.id }),
            ip: clientIp,
          });

          return { data: request };
        } catch (err: any) {
          console.error("[REQUEST_ACCESS_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "REQUEST_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ param: t.String() }),
    body: t.Object({ reason: t.Optional(t.String()) }),
    detail: { summary: "Solicitar acesso a documento sector_only", tags: ["Documentos"] },
  })

  .get("/:param/access-requests", async ({ tenantId, auth, params, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const idRow = await resolveIdentifierPrimary(tx, tenantId, params.param, { sector: true });
          if (!idRow?.document) {
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
          }

          const isOwner = idRow.document.uploadedBy === auth!.userId;
          const isSupervisor = idRow.sector?.supervisorId === auth!.userId;

          if (!isOwner && !isSupervisor) {
            const myRequests = await tx.query.documentAccessRequests.findMany({
              where: and(
                eq(documentAccessRequests.documentId, idRow.document.id),
                eq(documentAccessRequests.requesterId, auth!.userId),
              ),
              with: { requester: true, resolver: true },
              orderBy: [documentAccessRequests.createdAt],
            });
            return { data: myRequests };
          }

          const allRequests = await tx.query.documentAccessRequests.findMany({
            where: eq(documentAccessRequests.documentId, idRow.document.id),
            with: { requester: true, resolver: true },
            orderBy: [documentAccessRequests.createdAt],
          });
          return { data: allRequests };
        } catch (err: any) {
          console.error("[ACCESS_REQUESTS_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 500;
      return { error: { code: "ACCESS_REQUESTS_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ param: t.String() }),
    detail: { summary: "Listar pedidos de acesso do documento", tags: ["Documentos"] },
  })

  .patch("/:param/access-requests/:requestId", async ({ tenantId, auth, params, body, set, clientIp }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const idRow = await resolveIdentifierPrimary(tx, tenantId, params.param, { sector: true });
          if (!idRow?.document) {
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
          }

          const req = await tx.query.documentAccessRequests.findFirst({
            where: and(
              eq(documentAccessRequests.id, params.requestId),
              eq(documentAccessRequests.documentId, idRow.document.id),
            ),
          });
          if (!req) {
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Pedido de acesso não encontrado." } };
          }
          if (req.status !== "pending") {
            set.status = 400; return { error: { code: "ALREADY_RESOLVED", message: "Pedido já foi resolvido." } };
          }

          const isOwner = idRow.document.uploadedBy === auth!.userId;
          const isSupervisor = idRow.sector?.supervisorId === auth!.userId;
          if (!isOwner && !isSupervisor) {
            set.status = 403; return { error: { code: "FORBIDDEN", message: "Apenas o dono do documento ou o supervisor do sector podem resolver este pedido." } };
          }

          if (body.status === "approved") {
            const now = new Date();
            await tx.update(documentAccessRequests)
              .set({ status: "approved", resolvedBy: auth!.userId, resolvedAt: now })
              .where(eq(documentAccessRequests.id, params.requestId));

            const [share] = await tx.insert(documentShares).values({
              documentId: idRow.document.id,
              sharedBy: auth!.userId,
              sharedWithUserId: req.requesterId,
              sourceRequestId: req.id,
            }).returning();

            await notify(tx, {
              type: "access:granted",
              userId: req.requesterId,
              tenantId,
              payload: { documentId: idRow.document.id, identifier: params.param, shareId: share.id },
            });

            await tx.insert(auditLogs).values({
              tenantId, userId: auth!.userId, action: "ACCESS_APPROVED",
              resource: "documents", resourceId: idRow.document.id,
              metadata: JSON.stringify({ requestId: params.requestId }),
              ip: clientIp,
            });
          } else {
            const now = new Date();
            await tx.update(documentAccessRequests)
              .set({ status: "denied", resolvedBy: auth!.userId, resolvedAt: now })
              .where(eq(documentAccessRequests.id, params.requestId));

            await notify(tx, {
              type: "access:rejected",
              userId: req.requesterId,
              tenantId,
              payload: { documentId: idRow.document.id, identifier: params.param, notes: body.notes },
            });

            await tx.insert(auditLogs).values({
              tenantId, userId: auth!.userId, action: "ACCESS_DENIED",
              resource: "documents", resourceId: idRow.document.id,
              metadata: JSON.stringify({ requestId: params.requestId, notes: body.notes }),
              ip: clientIp,
            });
          }

          const updated = await tx.query.documentAccessRequests.findFirst({
            where: eq(documentAccessRequests.id, params.requestId),
          });
          return { data: updated };
        } catch (err: any) {
          console.error("[ACCESS_REQUEST_RESOLVE_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "ACCESS_REQUEST_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ param: t.String(), requestId: t.String() }),
    body: t.Object({
      status: t.Union([t.Literal("approved"), t.Literal("denied")]),
      notes: t.Optional(t.String()),
    }),
    detail: { summary: "Aprovar ou rejeitar pedido de acesso", tags: ["Documentos"] },
  })

  .post("/:param/access-requests/:requestId/cancel", async ({ tenantId, auth, params, set, clientIp }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const idRow = await resolveIdentifierPrimary(tx, tenantId, params.param);
          if (!idRow?.document) {
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
          }

          const req = await tx.query.documentAccessRequests.findFirst({
            where: and(
              eq(documentAccessRequests.id, params.requestId),
              eq(documentAccessRequests.documentId, idRow.document.id),
            ),
          });
          if (!req) {
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Pedido de acesso não encontrado." } };
          }
          if (req.requesterId !== auth!.userId) {
            set.status = 403; return { error: { code: "FORBIDDEN", message: "Apenas o requerente pode cancelar o próprio pedido." } };
          }
          if (req.status !== "pending") {
            set.status = 400; return { error: { code: "ALREADY_RESOLVED", message: "Pedido já foi resolvido." } };
          }

          const [updated] = await tx.update(documentAccessRequests)
            .set({ status: "cancelled" })
            .where(eq(documentAccessRequests.id, params.requestId))
            .returning();

          await tx.insert(auditLogs).values({
            tenantId, userId: auth!.userId, action: "CANCEL_ACCESS_REQUEST",
            resource: "documents", resourceId: idRow.document.id,
            metadata: JSON.stringify({ requestId: params.requestId }),
            ip: clientIp,
          });

          return { data: updated };
        } catch (err: any) {
          console.error("[CANCEL_ACCESS_REQUEST_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "CANCEL_REQUEST_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ param: t.String(), requestId: t.String() }),
    detail: { summary: "Cancelar próprio pedido de acesso", tags: ["Documentos"] },
  })

  .patch("/:param/shares/:shareId/revoke", async ({ tenantId, auth, params, set, clientIp }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const idRow = await resolveIdentifierPrimary(tx, tenantId, params.param);
          if (!idRow?.document) {
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
          }
                    if (!(await canShareDocument(tx, auth!, idRow.sectorId, idRow.document.uploadedBy))) {
            set.status = 403; return { error: { code: "FORBIDDEN", message: "Não tem permissão para revogar partilhas." } };
          }

          const existingShare = await tx.query.documentShares.findFirst({
            where: and(eq(documentShares.id, params.shareId), eq(documentShares.documentId, idRow.document.id)),
          });
          if (!existingShare || existingShare.revokedAt) {
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Partilha não encontrada ou já revogada." } };
          }
          if (existingShare.sourceRequestId) {
            set.status = 403; return { error: { code: "CANNOT_REVOKE", message: "Acesso concedido por pedido de acesso não pode ser revogado." } };
          }

          const [share] = await tx.update(documentShares)
            .set({ revokedAt: new Date() })
            .where(eq(documentShares.id, params.shareId))
            .returning();

          if (share.sharedWithUserId) {
            await notify(tx, {
              type: "document:share_revoked",
              userId: share.sharedWithUserId,
              tenantId,
              payload: { documentId: idRow.document.id, identifier: params.param },
            });
          } else if (share.sharedWithSectorId) {
            const members = await tx.query.users.findMany({ where: eq(users.sectorId, share.sharedWithSectorId) });
            for (const member of members) {
              await notify(tx, {
                type: "document:share_revoked",
                userId: member.id,
                tenantId,
                payload: { documentId: idRow.document.id, identifier: params.param },
              });
            }
          }

          await tx.insert(auditLogs).values({
            tenantId, userId: auth!.userId, action: "REVOKE_SHARE",
            resource: "documents", resourceId: idRow.document.id,
            metadata: JSON.stringify({ shareId: params.shareId }), ip: clientIp,
          });
          return { data: { id: share.id, revokedAt: share.revokedAt } };
        } catch (err: any) {
          console.error("[REVOKE_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "REVOKE_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ param: t.String(), shareId: t.String() }),
    detail: { summary: "Revogar partilha", tags: ["Partilha"] },
  });
