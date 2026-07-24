import { Elysia, t } from "elysia";
import { users, userRoles, sectors, roles } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";

export const usersModule = new Elysia({ prefix: "/users" })
  .use(requireAuth())

  .get("/", async ({ tenantId, query }) => {
    return withTenant(tenantId, async (tx) => {
      const conditions = [eq(users.tenantId, tenantId)];
      if (query.sectorId) conditions.push(eq(users.sectorId, query.sectorId));
      const rows = await tx.query.users.findMany({
        where: and(...conditions),
        with: { sector: true, userRoles: { with: { role: true } } },
        columns: { passwordHash: false },
      });
      const data = rows.map(r => ({
        id: r.id, email: r.email, fullName: r.fullName, isActive: r.isActive,
        sectorId: r.sectorId, sectorName: r.sector?.name ?? null,
        roles: r.userRoles.map(ur => ({ id: ur.role.id, name: ur.role.name })),
        createdAt: r.createdAt,
      }));
      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 20;
      const start = (page - 1) * limit;
      return { data: data.slice(start, start + limit), meta: { total: data.length, page, limit } };
    });
  }, {
    query: t.Object({ sectorId: t.Optional(t.String()), page: t.Optional(t.String()), limit: t.Optional(t.String()) }),
    detail: { summary: "Listar utilizadores", tags: ["Utilizadores"] },
  })

  .get("/:id", async ({ tenantId, params, set }) => {
    return withTenant(tenantId, async (tx) => {
      const user = await tx.query.users.findFirst({
        where: and(eq(users.id, params.id), eq(users.tenantId, tenantId)),
        with: { sector: true, userRoles: { with: { role: true } } },
        columns: { passwordHash: false },
      });
      if (!user) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Utilizador não encontrado." } }; }
      return {
        data: {
          id: user.id, email: user.email, fullName: user.fullName, isActive: user.isActive,
          sectorId: user.sectorId, sectorName: user.sector?.name ?? null,
          roles: user.userRoles.map(ur => ({ id: ur.role.id, name: ur.role.name })),
          createdAt: user.createdAt,
        },
      };
    });
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Detalhe do utilizador", tags: ["Utilizadores"] },
  })

  .use(requireRole("ORG_ADMIN"))
  .post("/", async ({ tenantId, body, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const sector = body.sectorId ? await tx.query.sectors.findFirst({
            where: eq(sectors.id, body.sectorId),
            columns: { tenantId: true },
          }) : null;
          if (body.sectorId && (!sector || sector.tenantId !== tenantId)) {
            set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Sector não encontrado." } };
          }
          const passwordHash = await Bun.password.hash(body.password);
          const [user] = await tx.insert(users).values({
            tenantId, sectorId: body.sectorId,
            email: body.email, passwordHash, fullName: body.fullName,
          }).returning();
          const { passwordHash: _, ...safeUser } = user;
          return { data: safeUser };
        } catch (err: any) {
          console.error("[CREATE_USER_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "USER_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({ email: t.String({ format: "email" }), password: t.String({ minLength: 6 }), fullName: t.String(), sectorId: t.String() }),
    detail: { summary: "Criar utilizador", tags: ["Utilizadores"] },
  })

  .patch("/:id", async ({ tenantId, params, body, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const [user] = await tx.update(users).set({ fullName: body.fullName, email: body.email })
            .where(and(eq(users.id, params.id), eq(users.tenantId, tenantId))).returning();
          const { passwordHash: _, ...safeUser } = user;
          return { data: safeUser };
        } catch (err: any) {
          console.error("[UPDATE_USER_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "UPDATE_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ fullName: t.Optional(t.String()), email: t.Optional(t.String({ format: "email" })) }),
    detail: { summary: "Editar utilizador", tags: ["Utilizadores"] },
  })

  .patch("/:id/sector", async ({ tenantId, params, body, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const sector = await tx.query.sectors.findFirst({
            where: eq(sectors.id, body.sectorId),
            columns: { tenantId: true },
          });
          if (!sector || sector.tenantId !== tenantId) {
            set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Sector não encontrado." } };
          }
          const [user] = await tx.update(users).set({ sectorId: body.sectorId })
            .where(and(eq(users.id, params.id), eq(users.tenantId, tenantId))).returning();
          const { passwordHash: _, ...safeUser } = user;
          return { data: safeUser };
        } catch (err: any) {
          console.error("[UPDATE_USER_SECTOR_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "UPDATE_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ sectorId: t.String() }),
    detail: { summary: "Mover utilizador para outro sector", tags: ["Utilizadores"] },
  })

  .delete("/:id", async ({ tenantId, params, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          await tx.update(users).set({ isActive: false })
            .where(and(eq(users.id, params.id), eq(users.tenantId, tenantId)));
          return { data: { deleted: true } };
        } catch (err: any) {
          console.error("[DELETE_USER_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "DELETE_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Desactivar utilizador", tags: ["Utilizadores"] },
  })

  .post("/:id/roles", async ({ tenantId, auth, params, body, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const role = await tx.query.roles.findFirst({
            where: eq(roles.id, body.roleId),
            columns: { tenantId: true },
          });
          if (!role || (role.tenantId !== null && role.tenantId !== tenantId)) {
            set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Role não encontrado." } };
          }
          if (body.sectorId) {
            const sector = await tx.query.sectors.findFirst({
              where: eq(sectors.id, body.sectorId),
              columns: { tenantId: true },
            });
            if (!sector || sector.tenantId !== tenantId) {
              set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Sector não encontrado." } };
            }
          }
          const [ur] = await tx.insert(userRoles).values({
            userId: params.id, roleId: body.roleId, sectorId: body.sectorId, grantedBy: auth!.userId,
          }).returning();
          return { data: ur };
        } catch (err: any) {
          console.error("[ASSIGN_ROLE_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "ROLE_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ roleId: t.String(), sectorId: t.Optional(t.String()) }),
    detail: { summary: "Atribuir role a utilizador", tags: ["Utilizadores"] },
  })

  .delete("/:id/roles/:roleId", async ({ tenantId, params, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          await tx.delete(userRoles).where(and(eq(userRoles.userId, params.id), eq(userRoles.roleId, params.roleId)));
          return { data: { deleted: true } };
        } catch (err: any) {
          console.error("[REMOVE_ROLE_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "DELETE_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String(), roleId: t.String() }),
    detail: { summary: "Remover role de utilizador", tags: ["Utilizadores"] },
  });
