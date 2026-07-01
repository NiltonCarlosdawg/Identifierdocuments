import { Elysia, t } from "elysia";
import { db } from "../db";
import { sectors, users } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

export const sectorsModule = new Elysia({ prefix: "/sectors" })
  .use(requireAuth())

  .get("/", async ({ auth }) => {
    const rows = await db.query.sectors.findMany({
      where: eq(sectors.tenantId, auth!.tenantId),
      with: { supervisor: true },
    });
    return { data: rows };
  }, { detail: { summary: "Listar sectores", tags: ["Sectores"] } })

  .get("/:id", async ({ auth, params, set }) => {
    const sector = await db.query.sectors.findFirst({
      where: and(eq(sectors.id, params.id), eq(sectors.tenantId, auth!.tenantId)),
      with: { supervisor: true },
    });
    if (!sector) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Sector não encontrado." } }; }
    return { data: sector };
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Detalhe do sector", tags: ["Sectores"] },
  })

  .get("/:id/members", async ({ auth, params }) => {
    const members = await db.query.users.findMany({
      where: and(eq(users.tenantId, auth!.tenantId), eq(users.sectorId, params.id)),
      columns: { passwordHash: false },
    });
    return { data: members };
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Listar membros do sector", tags: ["Sectores"] },
  })

  .use(requireRole("ORG_ADMIN"))
  .post("/", async ({ auth, body, set }) => {
    try {
      const [sector] = await db.insert(sectors).values({
        tenantId: auth!.tenantId, name: body.name, code: body.code,
      }).returning();
      return { data: sector };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "SECTOR_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({ name: t.String(), code: t.String() }),
    detail: { summary: "Criar sector", tags: ["Sectores"] },
  })

  .patch("/:id", async ({ auth, params, body, set }) => {
    try {
      const [sector] = await db.update(sectors)
        .set({ name: body.name, code: body.code })
        .where(and(eq(sectors.id, params.id), eq(sectors.tenantId, auth!.tenantId)))
        .returning();
      if (!sector) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Sector não encontrado." } }; }
      return { data: sector };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "UPDATE_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ name: t.Optional(t.String()), code: t.Optional(t.String()) }),
    detail: { summary: "Editar sector", tags: ["Sectores"] },
  })

  .patch("/:id/supervisor", async ({ auth, params, body, set }) => {
    try {
      if (body.supervisorId) {
        const supervisor = await db.query.users.findFirst({
          where: eq(users.id, body.supervisorId),
          columns: { tenantId: true },
        });
        if (!supervisor || supervisor.tenantId !== auth!.tenantId) {
          set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Supervisor não encontrado." } };
        }
      }
      const [sector] = await db.update(sectors)
        .set({ supervisorId: body.supervisorId })
        .where(and(eq(sectors.id, params.id), eq(sectors.tenantId, auth!.tenantId)))
        .returning();
      return { data: sector };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "UPDATE_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ supervisorId: t.Optional(t.String()) }),
    detail: { summary: "Atribuir supervisor", tags: ["Sectores"] },
  })
  .delete("/:id", async ({ auth, params, set }) => {
    try {
      await db.delete(sectors).where(and(eq(sectors.id, params.id), eq(sectors.tenantId, auth!.tenantId)));
      return { data: { deleted: true } };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "DELETE_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Remover sector", tags: ["Sectores"] },
  });
