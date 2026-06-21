import { Elysia, t } from "elysia";
import { db } from "../db";
import { users, userRoles } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

export const usersModule = new Elysia({ prefix: "/users" })
  .use(requireAuth())

  .post("/", async ({ auth, body, set }) => {
    try {
      const passwordHash = await Bun.password.hash(body.password);
      const [user] = await db.insert(users).values({
        tenantId: auth!.tenantId, sectorId: body.sectorId,
        email: body.email, passwordHash, fullName: body.fullName,
      }).returning();
      const { passwordHash: _, ...safeUser } = user;
      return { data: safeUser };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "USER_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({ email: t.String({ format: "email" }), password: t.String({ minLength: 6 }), fullName: t.String(), sectorId: t.String() }),
    detail: { summary: "Criar utilizador", tags: ["Utilizadores"] },
  })

  .get("/", async ({ auth, query }) => {
    const conditions = [eq(users.tenantId, auth!.tenantId)];
    if (query.sectorId) conditions.push(eq(users.sectorId, query.sectorId));
    const rows = await db.query.users.findMany({
      where: and(...conditions),
      with: { sector: true, userRoles: { with: { role: true } } },
      columns: { passwordHash: false },
    });
    return { data: rows };
  }, {
    query: t.Object({ sectorId: t.Optional(t.String()) }),
    detail: { summary: "Listar utilizadores", tags: ["Utilizadores"] },
  })

  .get("/:id", async ({ auth, params, set }) => {
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, params.id), eq(users.tenantId, auth!.tenantId)),
      with: { sector: true, userRoles: { with: { role: true } } },
      columns: { passwordHash: false },
    });
    if (!user) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Utilizador não encontrado." } }; }
    return { data: user };
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Detalhe do utilizador", tags: ["Utilizadores"] },
  })

  .patch("/:id", async ({ auth, params, body, set }) => {
    try {
      const [user] = await db.update(users).set({ fullName: body.fullName, email: body.email })
        .where(and(eq(users.id, params.id), eq(users.tenantId, auth!.tenantId))).returning();
      const { passwordHash: _, ...safeUser } = user;
      return { data: safeUser };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "UPDATE_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ fullName: t.Optional(t.String()), email: t.Optional(t.String({ format: "email" })) }),
    detail: { summary: "Editar utilizador", tags: ["Utilizadores"] },
  })

  .patch("/:id/sector", async ({ auth, params, body, set }) => {
    try {
      const [user] = await db.update(users).set({ sectorId: body.sectorId })
        .where(and(eq(users.id, params.id), eq(users.tenantId, auth!.tenantId))).returning();
      const { passwordHash: _, ...safeUser } = user;
      return { data: safeUser };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "UPDATE_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ sectorId: t.String() }),
    detail: { summary: "Mover utilizador para outro sector", tags: ["Utilizadores"] },
  })

  .delete("/:id", async ({ auth, params, set }) => {
    try {
      await db.update(users).set({ isActive: false })
        .where(and(eq(users.id, params.id), eq(users.tenantId, auth!.tenantId)));
      return { data: { deleted: true } };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "DELETE_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Desactivar utilizador", tags: ["Utilizadores"] },
  })

  .post("/:id/roles", async ({ auth, params, body, set }) => {
    try {
      const [ur] = await db.insert(userRoles).values({
        userId: params.id, roleId: body.roleId, sectorId: body.sectorId, grantedBy: auth!.userId,
      }).returning();
      return { data: ur };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "ROLE_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ roleId: t.String(), sectorId: t.Optional(t.String()) }),
    detail: { summary: "Atribuir role a utilizador", tags: ["Utilizadores"] },
  })

  .delete("/:id/roles/:roleId", async ({ params, set }) => {
    try {
      await db.delete(userRoles).where(and(eq(userRoles.userId, params.id), eq(userRoles.roleId, params.roleId)));
      return { data: { deleted: true } };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "DELETE_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ id: t.String(), roleId: t.String() }),
    detail: { summary: "Remover role de utilizador", tags: ["Utilizadores"] },
  });
