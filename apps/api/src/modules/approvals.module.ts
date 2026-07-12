import { Elysia, t } from "elysia";
import { db } from "../db";
import { approvals, documents, documentShares, auditLogs, users } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { withTenant } from "../db/withTenant";
import { requireAuth, getFreshRoles } from "../middleware/auth";
import { notify } from "../services/notification.service";
import { safeError } from "../lib/errors";

async function canResolveApproval(
  auth: { userId: string; tenantId: string },
  approval: { supervisorId: string | null; sectorId: string },
): Promise<boolean> {
  const roleNames = await getFreshRoles(auth.userId, auth.tenantId);
  if (roleNames.includes("ORG_ADMIN")) return true;
  if (roleNames.includes("SECTOR_SUPERVISOR") && approval.supervisorId === auth.userId) return true;
  return false;
}

export const approvalsModule = new Elysia({ prefix: "/approvals" })
  .use(requireAuth())

  .get("/", async ({ tenantId, auth, query }) => {
    return withTenant(tenantId, async (tx) => {
      const conditions = [eq(approvals.tenantId, tenantId)];
      if (query.status) conditions.push(eq(approvals.status, query.status as any));
      if (query.sectorId) conditions.push(eq(approvals.sectorId, query.sectorId));

      if (auth!.roles.includes("SECTOR_SUPERVISOR") && !auth!.roles.includes("ORG_ADMIN")) {
        conditions.push(eq(approvals.supervisorId, auth!.userId));
      }

      const rows = await tx.query.approvals.findMany({
        where: and(...conditions),
        with: { document: { with: { identifier: true } }, sector: true, supervisor: true },
        orderBy: (a) => [a.requestedAt],
      });
      return { data: rows };
    });
  }, {
    query: t.Object({
      status: t.Optional(t.String()),
      sectorId: t.Optional(t.String()),
    }),
    detail: { summary: "Listar aprovações", tags: ["Aprovações"] },
  })

  .get("/:id", async ({ tenantId, auth, params, set }) => {
    return withTenant(tenantId, async (tx) => {
      const approval = await tx.query.approvals.findFirst({
        where: and(eq(approvals.id, params.id), eq(approvals.tenantId, tenantId)),
        with: { document: { with: { identifier: true } }, sector: true, supervisor: true },
      });
      if (!approval) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Aprovação não encontrada." } }; }

      // CORREÇÃO: este endpoint não tinha nenhum controlo de acesso — qualquer
      // user autenticado do tenant conseguia ver notes/requesterId de qualquer
      // aprovação, incluindo de sectores alheios. Alinhado com a mesma regra do
      // GET /approvals (list): só ORG_ADMIN, o supervisor responsável, ou o
      // próprio requerente do pedido podem ver o detalhe.
      const roleNames = await getFreshRoles(auth!.userId, auth!.tenantId);
      const isAdmin = roleNames.includes("ORG_ADMIN");
      const isSupervisor = approval.supervisorId === auth!.userId;
      const isRequester = approval.requesterId === auth!.userId;
      if (!isAdmin && !isSupervisor && !isRequester) {
        set.status = 403;
        return { error: { code: "FORBIDDEN", message: "Sem permissão para ver esta aprovação." } };
      }

      return { data: approval };
    });
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Detalhe da aprovação", tags: ["Aprovações"] },
  })

  .patch("/:id", async ({ tenantId, auth, params, body, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
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

          if (!await canResolveApproval(auth!, existing)) {
            set.status = 403;
            return { error: { code: "FORBIDDEN", message: "Sem permissão para aprovar este documento." } };
          }

          const now = new Date();
          const [approval] = await tx.update(approvals)
            .set({ status: body.status, notes: body.notes ?? null, resolvedAt: now })
            .where(and(eq(approvals.id, params.id), eq(approvals.tenantId, tenantId)))
            .returning();

          const doc = existing.document;
          const identifierStr = doc?.identifier?.identifier;

          if (body.status === "approved") {
            if (existing.type === "access_request" && existing.requesterId) {
              await tx.insert(documentShares).values({
                documentId: approval.documentId, sharedBy: auth!.userId,
                sharedWithUserId: existing.requesterId,
              });
              await notify(tx, {
                type: "access:granted",
                userId: existing.requesterId,
                tenantId,
                payload: {
                  documentId: approval.documentId,
                  identifier: identifierStr,
                },
              });
            }
            if (existing.type === "cross_sector" && existing.shareId) {
              const [updatedShare] = await tx.update(documentShares)
                .set({ status: "active" })
                .where(eq(documentShares.id, existing.shareId))
                .returning();

              // CORREÇÃO: ao aprovar uma partilha cross-sector, ninguém era
              // notificado de que o acesso ficou activo — só o uploader do
              // documento recebia notificação genérica "approval:approved" (mais
              // abaixo). O destinatário real da partilha (sector ou utilizador)
              // ficava sem saber que já podia aceder ao documento.
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
        } catch (err: any) {
          console.error("[APPROVAL_ERROR]", err);
          throw err;
        }
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
