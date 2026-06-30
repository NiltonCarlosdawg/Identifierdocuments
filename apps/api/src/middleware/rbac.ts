import { db } from "../db";
import { rolePermissions, userRoles, roles } from "../db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import type { AuthPayload } from "./auth";

async function getUserPermissions(auth: AuthPayload): Promise<string[]> {
  const rows = await db
    .select({
      permResource: rolePermissions.resource,
      permAction: rolePermissions.action,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(
      and(
        eq(userRoles.userId, auth.userId),
        or(
          eq(roles.tenantId, auth.tenantId),
          isNull(roles.tenantId)
        )
      )
    );

  return rows.map((r) => `${r.permResource}:${r.permAction}`);
}

export function rbac(requiredPermission: string, sectorScoped = false) {
  return (app: any) => app
    .guard({
      as: "scoped",
      beforeHandle: async (ctx: any) => {
        if (!ctx.auth) {
          ctx.set.status = 401;
          return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } };
        }
        const permissions = await getUserPermissions(ctx.auth);
        if (!permissions.includes(requiredPermission)) {
          ctx.set.status = 403;
          return { error: { code: "FORBIDDEN", message: "Permissão insuficiente." } };
        }
        if (sectorScoped && ctx.auth.sectorId && ctx.params?.sectorId && ctx.params.sectorId !== ctx.auth.sectorId) {
          ctx.set.status = 403;
          return { error: { code: "FORBIDDEN", message: "Acesso restrito ao seu sector." } };
        }
      },
    });
}
