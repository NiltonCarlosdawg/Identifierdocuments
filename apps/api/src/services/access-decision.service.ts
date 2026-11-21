/** Admin do tenant: poder total sobre os dados dentro do seu tenant. */
export function isTenantAdmin(roleNames: string[]): boolean {
  return roleNames.includes("ORG_ADMIN");
}
