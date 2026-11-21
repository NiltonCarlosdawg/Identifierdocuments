import Elysia from "elysia";
import { Type as t } from "@sinclair/typebox";
import { db } from "../db";
import { approvals, documents, documentShares, auditLogs, users } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { withTenant } from "../db/withTenant";
import { requireAuth, getFreshRoles } from "../middleware/auth";
import { notify } from "../services/notification.service";
import { safeError } from "../lib/errors";
import { withIdempotency } from "../lib/idempotency";
import { approvalAuditEntry, canResolveApproval, canSeeApproval } from "../services/access-decision.service";

export const approvalsModule = new (Elysia as any)({ prefix: "/approvals" })
  .use(requireAuth())

  .get("/", async (ctx: any) => {
    const { tenantId, auth, query } = ctx;
    return withTenant(tenantId, async (tx) => {
      const roleNames = await getFreshRoles(auth!.userId, auth!.tenantId, tx);
      const conditions = [eq(approvals.tenantId, tenantId)];
      if (query.status) conditions.push(eq(approvals.status, query.status as any));
      if (query.sectorId) conditions.push(eq(approvals.sectorId, query.sectorId));

      const rows = await tx.query.approvals.findMany({
        where: and(...conditions),
        with: { document: { with: { identifier: true } }, sector: true, supervisor: true },
        orderBy: (a) => [a.requestedAt],
      });
      return { data: rows.filter((row: any) => canSeeApproval(roleNames, auth!.userId, row)) };
    });
  }, {
    query: t.Object({
      status: t.Optional(t.String()),
      sectorId: t.Optional(t.String()),
    }),
    detail: { summary: "Listar aprovações", tags: ["Aprovações"] },
  })

  .get("/:id", async (ctx: any) => {
    const { tenantId, auth, params, set } = ctx;
    return withTenant(tenantId, async (tx) => {
      const approval = await tx.query.approvals.findFirst({
        where: and(eq(approvals.id, params.id), eq(approvals.tenantId, tenantId)),
        with: { document: { with: { identifier: true } }, sector: true, supervisor: true },
      });
      if (!approval) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Aprovação não encontrada." } }; }

      const roleNames = await getFreshRoles(auth!.userId, auth!.tenantId, tx);
      if (!canSeeApproval(roleNames, auth!.userId, approval)) {
        set.status = 403;
        return { error: { code: "FORBIDDEN", message: "Sem permissão para ver esta aprovação." } };
      }

      return { data: approval };
    });
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Detalhe da aprovação", tags: ["Aprovações"] },
  })

  .patch("/:id", async ({ tenantId, auth, params, body, set, headers, clientIp }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        return await withIdempotency(tx, tenantId, headers["idempotency-key"], async () => {
          const existing = await tx.query.approvals.findFirst({
            where: and(eq(approvals.id, params.id), eq(approvals.tenantId, tenantId)),
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

          const roleNames = await getFreshRoles(auth!.userId, auth!.tenantId, tx);
          if (!canResolveApproval(roleNames, auth!.userId, existing)) {
            set.status = 403;
            return { error: { code: "FORBIDDEN", message: "Sem permissão para aprovar este documento." } };
          }

          const now = new Date();
          const [approval] = await tx.update(approvals)
            .set({ status: body.status, notes: body.notes ?? null, resolvedAt: now })
            .where(and(eq(approvals.id, params.id), eq(approvals.tenantId, tenantId)))
            .returning();

          await tx.insert(auditLogs).values(approvalAuditEntry({
            tenantId,
            userId: auth!.userId,
            status: body.status,
            documentId: approval.documentId,
            approvalId: approval.id,
            notes: body.notes,
            ip: clientIp,
          }));

          const doc = existing.document;
          const identifierStr = doc?.identifier?.identifier;

          if (body.status === "approved") {
            if (existing.type === "cross_sector" && existing.shareId) {
              const [updatedShare] = await tx.update(documentShares)
                .set({ status: "active" })
                .where(eq(documentShares.id, existing.shareId))
                .returning();

              if (updatedShare?.sharedWithUserId) {
                await notify(tx, {
                  type: "document:shared",
                  userId: updatedShare.sharedWithUserId,
                  tenantId,
                  payload: { documentId: approval.documentId, identifier: identifierStr },
                });
              } else if (updatedShare?.sharedWithSectorId) {
                const members = await tx.query.users.findMany({ where: eq(users.sectorId, updatedShare.sharedWithSectorId) });
                for (const member of members) {
                  await notify(tx, {
                    type: "document:shared",
                    userId: member.id,
                    tenantId,
                    payload: { documentId: approval.documentId, identifier: identifierStr },
                  });
                }
              }
            }

            if (existing.type === "access_request" && existing.requesterId) {
              await tx.insert(documentShares).values({
                documentId: approval.documentId,
                sharedWithUserId: existing.requesterId,
                sharedBy: auth!.userId,
                status: "active",
              });
              await notify(tx, {
                type: "document:shared",
                userId: existing.requesterId,
                tenantId,
                payload: { documentId: approval.documentId, identifier: identifierStr },
              });
            }
          }

          if (body.status === "rejected") {
            if (existing.type === "cross_sector" && existing.shareId) {
              await tx.update(documentShares)
                .set({ revokedAt: now })
                .where(eq(documentShares.id, existing.shareId));
            }
            if (existing.requesterId) {
              await notify(tx, {
                type: "access:rejected",
                userId: existing.requesterId,
                tenantId,
                payload: {
                  documentId: approval.documentId,
                  identifier: identifierStr,
                  notes: body.notes,
                },
              });
            }
          }

          if (doc?.uploadedBy) {
            await notify(tx, {
              type: `approval:${body.status}`,
              userId: doc.uploadedBy,
              tenantId,
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
        });
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "APPROVAL_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      status: t.Union([t.Literal("approved"), t.Literal("rejected")]),
      notes: t.Optional(t.String()),
    }),
    detail: { summary: "Aprovar ou rejeitar", tags: ["Aprovações"] },
  });
