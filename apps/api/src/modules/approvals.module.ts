import { Elysia, t } from "elysia";
import { db } from "../db";
import { approvals, documents, documentShares, auditLogs } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { notify } from "../services/notification.service";

function canResolveApproval(
  auth: { userId: string; roles: string[] },
  approval: { supervisorId: string | null; sectorId: string },
): boolean {
  if (auth.roles.includes("ORG_ADMIN")) return true;
  if (auth.roles.includes("SECTOR_SUPERVISOR") && approval.supervisorId === auth.userId) return true;
  return false;
}

export const approvalsModule = new Elysia({ prefix: "/approvals" })
  .use(requireAuth())

  .get("/", async ({ auth, query }) => {
    const conditions = [eq(approvals.tenantId, auth!.tenantId)];
    if (query.status) conditions.push(eq(approvals.status, query.status as any));
    if (query.sectorId) conditions.push(eq(approvals.sectorId, query.sectorId));

    if (auth!.roles.includes("SECTOR_SUPERVISOR") && !auth!.roles.includes("ORG_ADMIN")) {
      conditions.push(eq(approvals.supervisorId, auth!.userId));
    }

    const rows = await db.query.approvals.findMany({
      where: and(...conditions),
      with: { document: { with: { identifier: true } }, sector: true, supervisor: true },
      orderBy: (a) => [a.requestedAt],
    });
    return { data: rows };
  }, {
    query: t.Object({
      status: t.Optional(t.String()),
      sectorId: t.Optional(t.String()),
    }),
    detail: { summary: "Listar aprovações", tags: ["Aprovações"] },
  })

  .get("/:id", async ({ auth, params, set }) => {
    const approval = await db.query.approvals.findFirst({
      where: and(eq(approvals.id, params.id), eq(approvals.tenantId, auth!.tenantId)),
      with: { document: { with: { identifier: true } }, sector: true, supervisor: true },
    });
    if (!approval) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Aprovação não encontrada." } }; }
    return { data: approval };
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Detalhe da aprovação", tags: ["Aprovações"] },
  })

  .patch("/:id", async ({ auth, params, body, set }) => {
    try {
      const existing = await db.query.approvals.findFirst({
        where: and(eq(approvals.id, params.id), eq(approvals.tenantId, auth!.tenantId)),
        with: { document: { with: { identifier: true } } },
      });

      if (!existing) {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Aprovação não encontrada." } };
      }

      if (existing.status !== "pending") {
        set.status = 400;
        return { error: { code: "ALREADY_RESOLVED", message: "Aprovação já foi resolvida." } };
      }

      if (!canResolveApproval(auth!, existing)) {
        set.status = 403;
        return { error: { code: "FORBIDDEN", message: "Sem permissão para aprovar este documento." } };
      }

      const now = new Date();
      const [approval] = await db.update(approvals)
        .set({ status: body.status, notes: body.notes ?? null, resolvedAt: now })
        .where(and(eq(approvals.id, params.id), eq(approvals.tenantId, auth!.tenantId)))
        .returning();

      const doc = existing.document;
      const identifierStr = doc?.identifier?.identifier;

      if (body.status === "approved" && existing.type === "access_request" && existing.requesterId) {
        await db.insert(documentShares).values({
          documentId: approval.documentId, sharedBy: auth!.userId,
          sharedWithUserId: existing.requesterId,
        });
        await notify({
          type: "access:granted",
          userId: existing.requesterId,
          tenantId: auth!.tenantId,
          payload: {
            documentId: approval.documentId,
            identifier: identifierStr,
          },
        });
      }

      if (body.status === "rejected" && existing.requesterId) {
        await notify({
          type: "access:rejected",
          userId: existing.requesterId,
          tenantId: auth!.tenantId,
          payload: {
            documentId: approval.documentId,
            identifier: identifierStr,
            notes: body.notes,
          },
        });
      }

      if (doc?.uploadedBy) {
        await notify({
          type: `approval:${body.status}`,
          userId: doc.uploadedBy,
          tenantId: auth!.tenantId,
          payload: {
            approvalId: params.id,
            documentId: approval.documentId,
            identifier: identifierStr,
            notes: body.notes,
            status: body.status,
          },
        });
      }

      return { data: approval };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "APPROVAL_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      status: t.Union([t.Literal("approved"), t.Literal("rejected")]),
      notes: t.Optional(t.String()),
    }),
    detail: { summary: "Aprovar ou rejeitar", tags: ["Aprovações"] },
  });
