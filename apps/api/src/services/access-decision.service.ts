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
