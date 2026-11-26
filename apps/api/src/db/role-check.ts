import { queryClient } from "./index";
import { logger } from "../lib/logger";

/**
 * O RLS só isola organizações se o utilizador da BD da API não for superutilizador
 * nem tiver BYPASSRLS: esses papéis ignoram todas as policies, mesmo com FORCE.
 * Corre no arranque e avisa em voz alta; com REQUIRE_RLS_ROLE=true recusa arrancar.
 */
export async function checkDatabaseRoleEnforcesRls(): Promise<boolean> {
  const rows = await queryClient<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  const role = rows[0];
  if (!role) return false;
  const bypasses = role.rolsuper || role.rolbypassrls;
  if (bypasses) {
    const msg = `[SEGURANÇA] O utilizador da BD '${role.rolname}' ${role.rolsuper ? "é superutilizador" : "tem BYPASSRLS"}: `
      + "o RLS não está a isolar as organizações. Ver docs/RLS_PRODUCAO.md.";
    if (process.env.REQUIRE_RLS_ROLE === "true") throw new Error(msg);
    if (process.env.NODE_ENV === "production") logger.error(msg);
    else logger.warn(msg);
  }
  return !bypasses;
}
