import { Elysia, t } from "elysia";
import { db } from "../db";
import { organizations, users, sectors, roles, userRoles } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

export const tenantsModule = new Elysia({ prefix: "/tenants" })
  .use(requireAuth())
  .get("/me", async ({ auth, set }) => {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, auth!.tenantId) });
    if (!org) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Organização não encontrada." } }; }
    return { data: org };
  }, {
    detail: { summary: "Dados da organização", tags: ["Organizações"] },
  })

  .use(requireRole("ORG_ADMIN"))
  .patch("/me", async ({ auth, body, set }) => {
    try {
      const [org] = await db.update(organizations)
        .set({ name: body.name, identifierPrefix: body.identifierPrefix })
        .where(eq(organizations.id, auth!.tenantId)).returning();
      return { data: org };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "UPDATE_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({ name: t.Optional(t.String()), identifierPrefix: t.Optional(t.String()) }),
    detail: { summary: "Actualizar organização", tags: ["Organizações"] },
  });
