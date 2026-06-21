import { Elysia, t } from "elysia";
import { db } from "../db";
import { roles, rolePermissions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

export const rolesModule = new Elysia({ prefix: "/roles" })
  .use(requireAuth())

  .get("/", async ({ auth }) => {
    const rows = await db.query.roles.findMany({
      where: eq(roles.tenantId, auth!.tenantId),
      with: { permissions: true },
    });
    const systemRoles = await db.query.roles.findMany({
      where: and(eq(roles.isSystem, true)),
      with: { permissions: true },
    });
    return { data: [...rows, ...systemRoles] };
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
  .patch("/:id/permissions", async ({ params, body, set }) => {
    try {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, params.id));
      for (const perm of body.permissions) {
        await db.insert(rolePermissions).values({ roleId: params.id, ...perm });
      }
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
  .delete("/:id", async ({ params, set }) => {
    const role = await db.query.roles.findFirst({ where: eq(roles.id, params.id) });
    if (role?.isSystem) { set.status = 400; return { error: { code: "SYSTEM_ROLE", message: "Não é possível remover roles de sistema." } }; }
    await db.delete(roles).where(eq(roles.id, params.id));
    return { data: { deleted: true } };
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Remover role custom", tags: ["Roles"] },
  });
