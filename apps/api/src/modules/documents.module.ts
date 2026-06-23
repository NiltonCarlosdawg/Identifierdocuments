import { Elysia, t } from "elysia";
import fs from "node:fs";
import { attachDocument, getDocumentMeta, downloadDocument } from "../services/attachment.service";
import { requireAuth } from "../middleware/auth";
import { db } from "../db";
import { documents, documentShares, approvals, sectors, auditLogs, identifiers, users } from "../db/schema";
import { eq, and, isNull, or } from "drizzle-orm";
import { notify } from "../services/notification.service";

export const documentsModule = new Elysia({ prefix: "/documents" })
  .use(requireAuth())

  .post("/attach", async ({ auth, body, set }) => {
    try {
      const result = await attachDocument(auth!, {
        identifier: body.identifier, file: body.file,
        uploadSource: body.uploadSource,
      });
      if (!result.success) { set.status = 422; return result; }
      return result;
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "ATTACH_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({
      identifier: t.String(),
      file: t.File(),
      uploadSource: t.Optional(t.Union([t.Literal("manual"), t.Literal("scanner"), t.Literal("sync")])),
    }),
    detail: { summary: "Associar documento", tags: ["Documentos"] },
  })

  .get("/:id", async ({ auth, params, set }) => {
    const doc = await getDocumentMeta(auth!, params.id);
    if (!doc) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } }; }
    return { data: doc };
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Metadados do documento", tags: ["Documentos"] },
  })

  .get("/:id/download", async ({ auth, params, set }) => {
    const result = await downloadDocument(auth!, params.id);
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
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Download do documento", tags: ["Documentos"] },
  })

  .post("/:id/share", async ({ auth, params, body, set }) => {
    try {
      if (!body.sectorId && !body.userId) {
        set.status = 422;
        return { error: { code: "VALIDATION_ERROR", message: "Indique sectorId ou userId." } };
      }

      const idRow = await db.query.identifiers.findFirst({
        where: and(eq(identifiers.identifier, params.id), eq(identifiers.tenantId, auth!.tenantId)),
        with: { document: true },
      });
      if (!idRow || !idRow.document) {
        set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
      }
      const docId = idRow.document.id;

      const [share] = await db.insert(documentShares).values({
        documentId: docId, sharedBy: auth!.userId,
        sharedWithSectorId: body.sectorId ?? null,
        sharedWithUserId: body.userId ?? null,
      }).returning({ id: documentShares.id, documentId: documentShares.documentId, sharedBy: documentShares.sharedBy, sharedWithSectorId: documentShares.sharedWithSectorId, sharedWithUserId: documentShares.sharedWithUserId, createdAt: documentShares.createdAt });

      if (body.userId) {
        await notify({
          type: "document:shared",
          userId: body.userId,
          tenantId: auth!.tenantId,
          payload: { documentId: docId, identifier: params.id, sharedBy: auth!.userId },
        });
      }

      if (body.sectorId) {
        const targetSector = await db.query.sectors.findFirst({ where: eq(sectors.id, body.sectorId) });
        const isCrossSector = idRow.sectorId !== body.sectorId;

        if (isCrossSector && targetSector?.supervisorId) {
          await db.insert(approvals).values({
            tenantId: auth!.tenantId, documentId: docId,
            sectorId: body.sectorId, supervisorId: targetSector.supervisorId,
          });
          await notify({
            type: "approval:pending",
            userId: targetSector.supervisorId,
            tenantId: auth!.tenantId,
            payload: { documentId: docId, identifier: params.id, sectorId: body.sectorId },
          });
        } else if (targetSector) {
          const members = await db.query.users.findMany({
            where: eq(users.sectorId, body.sectorId),
          });
          for (const member of members) {
            if (member.id !== auth!.userId) {
              await notify({
                type: "document:shared",
                userId: member.id,
                tenantId: auth!.tenantId,
                payload: { documentId: docId, identifier: params.id, sectorId: body.sectorId },
              });
            }
          }
        }
      }

      await db.insert(auditLogs).values({
        tenantId: auth!.tenantId, userId: auth!.userId, action: "SHARE",
        resource: "documents", resourceId: docId,
        metadata: JSON.stringify({ sharedWithSector: body.sectorId, sharedWithUser: body.userId }),
        ip: null,
      });

      return { data: share };
    } catch (err: any) {
      set.status = 400;
      console.error("[SHARE_ERROR]", err);
      return { error: { code: "SHARE_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({
      sectorId: t.Optional(t.String()),
      userId: t.Optional(t.String()),
    }),
    detail: { summary: "Partilhar documento", tags: ["Partilha"] },
  })

  .get("/:id/shares", async ({ auth, params }) => {
    const idRow = await db.query.identifiers.findFirst({
      where: and(eq(identifiers.identifier, params.id), eq(identifiers.tenantId, auth!.tenantId)),
      with: { document: true },
    });
    if (!idRow?.document) return { data: [] };
    const shares = await db.query.documentShares.findMany({
      where: eq(documentShares.documentId, idRow.document.id),
      with: { sector: true, user: true, sharer: true },
    });
    return { data: shares };
  }, {
    detail: { summary: "Listar partilhas", tags: ["Partilha"] },
  })

  .post("/:id/request-access", async ({ auth, params, body, set }) => {
    try {
      const idRow = await db.query.identifiers.findFirst({
        where: and(eq(identifiers.identifier, params.id), eq(identifiers.tenantId, auth!.tenantId)),
        with: { document: true, sector: true },
      });
      if (!idRow?.document) {
        set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
      }
      if (idRow.visibility !== "sector_only") {
        set.status = 422; return { error: { code: "NOT_RESTRICTED", message: "Apenas documentos sector_only necessitam de pedido de acesso." } };
      }

      const supervisorId = idRow.sector?.supervisorId;
      if (!supervisorId) {
        set.status = 422; return { error: { code: "NO_SUPERVISOR", message: "Sector emitente não tem supervisor definido." } };
      }

      const existing = await db.query.approvals.findFirst({
        where: and(
          eq(approvals.documentId, idRow.document.id),
          eq(approvals.requesterId, auth!.userId),
          eq(approvals.type, "access_request"),
          eq(approvals.status, "pending"),
        ),
      });
      if (existing) {
        set.status = 409; return { error: { code: "ALREADY_REQUESTED", message: "Já existe um pedido de acesso pendente para este documento." } };
      }

      const [approval] = await db.insert(approvals).values({
        tenantId: auth!.tenantId, documentId: idRow.document.id,
        sectorId: idRow.sectorId, supervisorId,
        requesterId: auth!.userId, type: "access_request",
        notes: body.reason ?? null,
      }).returning();

      await notify({
        type: "access:requested",
        userId: supervisorId,
        tenantId: auth!.tenantId,
        payload: { documentId: idRow.document.id, identifier: params.id, requesterId: auth!.userId },
      });

      await db.insert(auditLogs).values({
        tenantId: auth!.tenantId, userId: auth!.userId, action: "REQUEST_ACCESS",
        resource: "documents", resourceId: idRow.document.id,
        metadata: JSON.stringify({ identifier: params.id, approvalId: approval.id }),
        ip: null,
      });

      return { data: approval };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "REQUEST_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({ reason: t.Optional(t.String()) }),
    detail: { summary: "Solicitar acesso a documento sector_only", tags: ["Documentos"] },
  })

  .patch("/:id/shares/:shareId/revoke", async ({ auth, params, set }) => {
    try {
      const idRow = await db.query.identifiers.findFirst({
        where: and(eq(identifiers.identifier, params.id), eq(identifiers.tenantId, auth!.tenantId)),
        with: { document: true },
      });
      if (!idRow?.document) {
        set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
      }
      const [share] = await db.update(documentShares)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(documentShares.id, params.shareId),
          eq(documentShares.documentId, idRow.document.id),
          isNull(documentShares.revokedAt),
        ))
        .returning();
      if (!share) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Partilha não encontrada ou já revogada." } }; }
      await db.insert(auditLogs).values({
        tenantId: auth!.tenantId, userId: auth!.userId, action: "REVOKE_SHARE",
        resource: "documents", resourceId: idRow.document.id,
        metadata: JSON.stringify({ shareId: params.shareId }), ip: null,
      });
      return { data: { id: share.id, revokedAt: share.revokedAt } };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "REVOKE_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String(), shareId: t.String() }),
    detail: { summary: "Revogar partilha", tags: ["Partilha"] },
  });
