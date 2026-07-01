import { Elysia, t } from "elysia";
import { db } from "../db";
import { roles, rolePermissions } from "../db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

export const rolesModule = new Elysia({ prefix: "/roles" })
  .use(requireAuth())

  .get("/", async ({ auth }) => {
    const rows = await db.query.roles.findMany({
      where: or(
        eq(roles.tenantId, auth!.tenantId),
        isNull(roles.tenantId)
      ),
      with: { permissions: true },
    });
    return { data: rows };
  }, { detail: { summary: "Listar roles", tags: ["Roles"] } })

  .use(requireRole("ORG_ADMIN"))
  .post("/", async ({ auth, body, set }) => {
    try {
      const [role] = await db.insert(roles).values({
        tenantId: auth!.tenantId, name: body.name, isSystem: false,
      }).returning();
      return { data: role };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "ROLE_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({ name: t.String() }),
    detail: { summary: "Criar role custom", tags: ["Roles"] },
  })

  .use(requireRole("ORG_ADMIN"))
  .patch("/:id/permissions", async ({ auth, params, body, set }) => {
    try {
      const role = await db.query.roles.findFirst({ where: eq(roles.id, params.id) });
      if (!role || role.tenantId !== auth!.tenantId) {
        set.status = 404; return { error: { code: "NOT_FOUND", message: "Role não encontrado." } };
      }
      if (role.isSystem) {
        set.status = 400; return { error: { code: "SYSTEM_ROLE", message: "Não é possível alterar permissões de roles de sistema." } };
      }
      await db.transaction(async (tx) => {
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, params.id));
        for (const perm of body.permissions) {
          await tx.insert(rolePermissions).values({ roleId: params.id, ...perm });
        }
      });
      return { data: { updated: true } };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "PERMISSION_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ permissions: t.Array(t.Object({ resource: t.String(), action: t.String() })) }),
    detail: { summary: "Definir permissões do role", tags: ["Roles"] },
  })

  .use(requireRole("ORG_ADMIN"))
  .delete("/:id", async ({ auth, params, set }) => {
    const role = await db.query.roles.findFirst({ where: eq(roles.id, params.id) });
    if (!role || role.tenantId !== auth!.tenantId) {
      set.status = 404; return { error: { code: "NOT_FOUND", message: "Role não encontrado." } };
    }
    if (role?.isSystem) { set.status = 400; return { error: { code: "SYSTEM_ROLE", message: "Não é possível remover roles de sistema." } }; }
    await db.delete(roles).where(eq(roles.id, params.id));
    return { data: { deleted: true } };
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Remover role custom", tags: ["Roles"] },
  });
