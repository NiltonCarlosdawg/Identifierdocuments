import { Elysia, t } from "elysia";
import { db } from "../db";
import { roles, rolePermissions, users } from "../db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";

export const rolesModule = new Elysia({ prefix: "/roles" })
  .use(requireAuth())

  .get("/", async ({ tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query.roles.findMany({
        where: or(
          eq(roles.tenantId, tenantId),
          isNull(roles.tenantId)
        ),
        with: { permissions: true },
      });
      return { data: rows };
    });
  }, { detail: { summary: "Listar roles", tags: ["Roles"] } })

  .use(requireRole("ORG_ADMIN"))
  .get("/:id/users", async ({ params, set, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      const role = await tx.query.roles.findFirst({ where: eq(roles.id, params.id) });
      if (!role || (role.tenantId !== null && role.tenantId !== tenantId)) {
        set.status = 404; return { error: { code: "NOT_FOUND", message: "Role não encontrado." } };
      }
      const rows = await tx.query.users.findMany({
        where: eq(users.tenantId, tenantId),
        with: { sector: true, userRoles: { with: { role: true } } },
        columns: { passwordHash: false },
      });
      const data = rows
        .filter(u => u.userRoles.some(ur => ur.roleId === params.id))
        .map(u => {
          const match = u.userRoles.find(ur => ur.roleId === params.id);
          return {
            userId: u.id,
            sectorId: u.sectorId,
            email: u.email,
            fullName: u.fullName,
            isActive: u.isActive,
            sectorName: u.sector?.name ?? null,
            grantedAt: match?.createdAt ?? null,
          };
        });
      return { data };
    });
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Listar utilizadores com um role", tags: ["Roles"] },
  })

  .use(requireRole("ORG_ADMIN"))
  .post("/", async ({ body, set, tenantId, headers }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        return await withIdempotency(tx, tenantId, headers["idempotency-key"], async () => {
          const [role] = await tx.insert(roles).values({
            tenantId, name: body.name, isSystem: false,
          }).returning();
          return { data: role };
        });
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "ROLE_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({ name: t.String() }),
    detail: { summary: "Criar role custom", tags: ["Roles"] },
  })

  .use(requireRole("ORG_ADMIN"))
  .patch("/:id/permissions", async ({ params, body, set, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const role = await tx.query.roles.findFirst({ where: eq(roles.id, params.id) });
          if (!role || role.tenantId !== tenantId) {
            set.status = 404; return { error: { code: "NOT_FOUND", message: "Role não encontrado." } };
          }
          if (role.isSystem) {
            set.status = 400; return { error: { code: "SYSTEM_ROLE", message: "Não é possível alterar permissões de roles de sistema." } };
          }
          await tx.transaction(async (tx2) => {
            await tx2.delete(rolePermissions).where(eq(rolePermissions.roleId, params.id));
            for (const perm of body.permissions) {
              await tx2.insert(rolePermissions).values({ roleId: params.id, ...perm });
            }
          });
          return { data: { updated: true } };
        } catch (err: any) {
          console.error("[PERMISSION_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "PERMISSION_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ permissions: t.Array(t.Object({ resource: t.String(), action: t.String() })) }),
    detail: { summary: "Definir permissões do role", tags: ["Roles"] },
  })

  .use(requireRole("ORG_ADMIN"))
  .delete("/:id", async ({ params, set, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      const role = await tx.query.roles.findFirst({ where: eq(roles.id, params.id) });
      if (!role || role.tenantId !== tenantId) {
        set.status = 404; return { error: { code: "NOT_FOUND", message: "Role não encontrado." } };
      }
      if (role?.isSystem) { set.status = 400; return { error: { code: "SYSTEM_ROLE", message: "Não é possível remover roles de sistema." } }; }
      await tx.delete(roles).where(eq(roles.id, params.id));
      return { data: { deleted: true } };
    });
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Remover role custom", tags: ["Roles"] },
  });
detail: { summary: "Remover role custom", tags: ["Roles"] },
  });
