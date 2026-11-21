/** Admin do tenant: poder total sobre os dados dentro do seu tenant. */
export function isTenantAdmin(roleNames: string[]): boolean {
  return roleNames.includes("ORG_ADMIN");
}

/** Quem pode ver uma aprovação: admin, supervisor responsável ou próprio requerente. */
export function canSeeApproval(
  roleNames: string[],
  userId: string,
  approval: { requesterId: string | null; supervisorId: string | null },
): boolean {
  if (isTenantAdmin(roleNames)) return true;
  if (approval.requesterId === userId) return true;
  return roleNames.includes("SECTOR_SUPERVISOR") && approval.supervisorId === userId;
}

/** Só o supervisor responsável (ou admin) resolve, e ninguém resolve o próprio pedido. */
export function canResolveApproval(
  roleNames: string[],
  userId: string,
  approval: { requesterId: string | null; supervisorId: string | null },
): boolean {
  if (approval.requesterId === userId) return false;
  if (isTenantAdmin(roleNames)) return true;
  return roleNames.includes("SECTOR_SUPERVISOR") && approval.supervisorId === userId;
}

/** Linha de auditoria para uma decisão tomada em /approvals/:id. */
export function approvalAuditEntry(input: {
  tenantId: string;
  userId: string;
  status: "approved" | "rejected";
  documentId: string;
  approvalId: string;
  notes?: string;
  ip: string;
}): {
  tenantId: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  metadata: string;
  ip: string;
} {
  const metadata: Record<string, string> = { documentId: input.documentId, type: "access_request" };
  if (input.notes != null) metadata.notes = input.notes;
  return {
    tenantId: input.tenantId,
    userId: input.userId,
    action: input.status === "approved" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED",
    resource: "approvals",
    resourceId: input.approvalId,
    metadata: JSON.stringify(metadata),
    ip: input.ip,
  };
}
