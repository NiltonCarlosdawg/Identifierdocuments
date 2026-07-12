import { Elysia, t } from "elysia";
import { db } from "../db";
import { sectors, users } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";

export const sectorsModule = new Elysia({ prefix: "/sectors" })
  .use(requireAuth())

  .get("/", async ({ tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query.sectors.findMany({
        where: eq(sectors.tenantId, tenantId),
        with: { supervisor: true },
      });
      return { data: rows };
    });
  }, { detail: { summary: "Listar sectores", tags: ["Sectores"] } })

  .get("/:id", async ({ params, set, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      const sector = await tx.query.sectors.findFirst({
        where: and(eq(sectors.id, params.id), eq(sectors.tenantId, tenantId)),
        with: { supervisor: true },
      });
      if (!sector) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Sector não encontrado." } }; }
      return { data: sector };
    });
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Detalhe do sector", tags: ["Sectores"] },
  })

  .get("/:id/members", async ({ params, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      const members = await tx.query.users.findMany({
        where: and(eq(users.tenantId, tenantId), eq(users.sectorId, params.id)),
        columns: { passwordHash: false },
      });
      return { data: members };
    });
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Listar membros do sector", tags: ["Sectores"] },
  })

  .use(requireRole("ORG_ADMIN"))
  .post("/", async ({ body, set, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const [sector] = await tx.insert(sectors).values({
            tenantId, name: body.name, code: body.code,
          }).returning();
          return { data: sector };
        } catch (err: any) {
          console.error("[CREATE_SECTOR_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "SECTOR_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({ name: t.String(), code: t.String() }),
    detail: { summary: "Criar sector", tags: ["Sectores"] },
  })

  .patch("/:id", async ({ params, body, set, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const [sector] = await tx.update(sectors)
            .set({ name: body.name, code: body.code })
            .where(and(eq(sectors.id, params.id), eq(sectors.tenantId, tenantId)))
            .returning();
          if (!sector) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Sector não encontrado." } }; }
          return { data: sector };
        } catch (err: any) {
          console.error("[UPDATE_SECTOR_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "UPDATE_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ name: t.Optional(t.String()), code: t.Optional(t.String()) }),
    detail: { summary: "Editar sector", tags: ["Sectores"] },
  })

  .patch("/:id/supervisor", async ({ params, body, set, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          if (body.supervisorId) {
            const supervisor = await tx.query.users.findFirst({
              where: eq(users.id, body.supervisorId),
              columns: { tenantId: true },
            });
            if (!supervisor || supervisor.tenantId !== tenantId) {
              set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Supervisor não encontrado." } };
            }
          }
          const [sector] = await tx.update(sectors)
            .set({ supervisorId: body.supervisorId })
            .where(and(eq(sectors.id, params.id), eq(sectors.tenantId, tenantId)))
            .returning();
          return { data: sector };
        } catch (err: any) {
          console.error("[UPDATE_SUPERVISOR_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "UPDATE_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ supervisorId: t.Optional(t.String()) }),
    detail: { summary: "Atribuir supervisor", tags: ["Sectores"] },
  })
  .delete("/:id", async ({ params, set, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          await tx.delete(sectors).where(and(eq(sectors.id, params.id), eq(sectors.tenantId, tenantId)));
          return { data: { deleted: true } };
        } catch (err: any) {
          console.error("[DELETE_SECTOR_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      if (err?.code === "23503") {
        set.status = 409;
        return { error: { code: "SECTOR_IN_USE", message: "Não é possível remover o sector: existem utilizadores ou identificadores associados a ele." } };
      }
      set.status = 400;
      return { error: { code: "DELETE_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Remover sector", tags: ["Sectores"] },
  });
