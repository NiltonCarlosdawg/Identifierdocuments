import Elysia from "elysia";
import { Type as t } from "@sinclair/typebox";
import { users, userRoles, sectors, roles, organizations } from "../db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { requireAuth, getFreshRoles } from "../middleware/auth";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";
import { getClientIp } from "../lib/ip";
import { checkRateLimit } from "../middleware/rateLimit";
import { randomBytes } from "node:crypto";
import { enqueueInviteEmail } from "../jobs/queues";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); if (row.some(c => c.trim() !== "")) rows.push(row); }
  return rows;
}

function randomPassword(): string {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const usersModule = new (Elysia as any)({ prefix: "/users" })
  .use(requireAuth())

  .get("/", async ({ tenantId, auth, query }) => {
    return withTenant(tenantId, async (tx) => {
      const roleNames = await getFreshRoles(auth!.userId, tenantId);
      const isAdmin = roleNames.includes("ORG_ADMIN");

      const conditions = [eq(users.tenantId, tenantId)];
      if (isAdmin) {
        if (query.sectorId) conditions.push(eq(users.sectorId, query.sectorId));
      } else {
        const me = await tx.query.users.findFirst({
          where: eq(users.id, auth!.userId),
          columns: { sectorId: true },
        });
        if (!me?.sectorId) return { data: [], meta: { total: 0, page: 1, limit: 20 } };
        conditions.push(eq(users.sectorId, me.sectorId));
      }
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

  .post("/", async ({ tenantId, auth, body, set }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const roleNames = await getFreshRoles(auth!.userId, auth!.tenantId);
          const isAdmin = roleNames.includes("ORG_ADMIN");
          const isSupervisor = roleNames.includes("SECTOR_SUPERVISOR");
          if (!isAdmin && !isSupervisor) {
            set.status = 403; return { error: { code: "FORBIDDEN", message: "Sem permissão para criar utilizadores." } };
          }

          let sectorId = body.sectorId;
          if (isSupervisor && !isAdmin) {
            const supervisorUser = await tx.query.users.findFirst({
              where: eq(users.id, auth!.userId),
              columns: { sectorId: true },
            });
            if (!supervisorUser?.sectorId) {
              set.status = 422; return { error: { code: "NO_SECTOR", message: "Supervisor não tem sector atribuído." } };
            }
            sectorId = supervisorUser.sectorId;
          }

          const sector = sectorId ? await tx.query.sectors.findFirst({
            where: eq(sectors.id, sectorId),
            columns: { tenantId: true },
          }) : null;
          if (sectorId && (!sector || sector.tenantId !== tenantId)) {
            set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Sector não encontrado." } };
          }

          const passwordHash = await Bun.password.hash(body.password);
          const [user] = await tx.insert(users).values({
            tenantId, sectorId,
            email: body.email, passwordHash, fullName: body.fullName,
          }).returning();

          if (isSupervisor && !isAdmin) {
            const memberRole = await tx.query.roles.findFirst({
              where: and(eq(roles.name, "MEMBER"), eq(roles.tenantId, tenantId)),
            });
            if (memberRole) {
              await tx.insert(userRoles).values({
                userId: user.id, roleId: memberRole.id, grantedBy: auth!.userId,
              });
            }
          }

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

  .post("/invite", async ({ tenantId, auth, body, request, set }) => {
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`users-invite:${tenantId}:${ip}`, 20, 60 * 60_000))) {
      set.status = 429;
      return { error: { code: "RATE_LIMITED", message: "Demasiados convites. Tente novamente mais tarde." } };
    }
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const roleNames = await getFreshRoles(auth!.userId, auth!.tenantId);
          const isAdmin = roleNames.includes("ORG_ADMIN");
          const isSupervisor = roleNames.includes("SECTOR_SUPERVISOR");
          if (!isAdmin && !isSupervisor) {
            set.status = 403; return { error: { code: "FORBIDDEN", message: "Sem permissão para convidar utilizadores." } };
          }

          const email = body.email.trim().toLowerCase();
          if (!EMAIL_RE.test(email)) {
            set.status = 422; return { error: { code: "VALIDATION_ERROR", message: "Email inválido." } };
          }

          const existing = await tx.query.users.findFirst({
            where: and(eq(users.tenantId, tenantId), eq(users.email, email)),
            columns: { id: true },
          });
          if (existing) {
            set.status = 409; return { error: { code: "EMAIL_EXISTS", message: "Já existe um utilizador com este email." } };
          }

          let sectorId = body.sectorId;
          if (isSupervisor && !isAdmin) {
            const supervisorUser = await tx.query.users.findFirst({
              where: eq(users.id, auth!.userId),
              columns: { sectorId: true },
            });
            if (!supervisorUser?.sectorId) {
              set.status = 422; return { error: { code: "NO_SECTOR", message: "Supervisor não tem sector atribuído." } };
            }
            sectorId = supervisorUser.sectorId;
          }

          const sector = await tx.query.sectors.findFirst({
            where: eq(sectors.id, sectorId),
            columns: { tenantId: true },
          });
          if (!sector || sector.tenantId !== tenantId) {
            set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Sector não encontrado." } };
          }

          const requestedRole = (isSupervisor && !isAdmin) ? "MEMBER" : (body.role || "MEMBER");
          if (requestedRole !== "MEMBER" && requestedRole !== "SECTOR_SUPERVISOR") {
            set.status = 422; return { error: { code: "INVALID_ROLE", message: "Role de convite deve ser MEMBER ou SECTOR_SUPERVISOR." } };
          }
          const role = await tx.query.roles.findFirst({
            where: and(eq(roles.name, requestedRole), eq(roles.tenantId, tenantId)),
          });
          if (!role) {
            set.status = 422; return { error: { code: "INVALID_ROLE", message: `Role "${requestedRole}" não existe.` } };
          }

          const password = randomPassword();
          const passwordHash = await Bun.password.hash(password);
          const [user] = await tx.insert(users).values({
            tenantId, sectorId, email, passwordHash, fullName: body.fullName.trim(),
          }).returning();
          await tx.insert(userRoles).values({
            userId: user.id, roleId: role.id, sectorId, grantedBy: auth!.userId,
          });

          const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, tenantId)).limit(1);
          const emailed = await enqueueInviteEmail(email, body.fullName.trim(), org?.name || "DocID", password);
          const { passwordHash: _, ...safeUser } = user;
          const isProd = process.env.NODE_ENV === "production";
          return {
            data: {
              ...safeUser,
              emailed,
              temporaryPassword: (!isProd && !emailed) ? password : undefined,
            },
          };
        } catch (err: any) {
          console.error("[INVITE_USER_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "INVITE_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({
      email: t.String({ format: "email" }),
      fullName: t.String({ minLength: 1 }),
      sectorId: t.String(),
      role: t.Optional(t.String()),
    }),
    detail: { summary: "Convidar utilizador por email", tags: ["Utilizadores"] },
  })

  .guard({
    beforeHandle: async ({ auth, set }: any) => {
      if (!auth) { set.status = 401; return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } }; }
      const roleNames = await getFreshRoles(auth.userId, auth.tenantId);
      if (!roleNames.includes("ORG_ADMIN")) {
        set.status = 403; return { error: { code: "FORBIDDEN", message: "Permissão insuficiente." } };
      }
    },
  }, (app: any) => app
    .patch("/:id", async ({ tenantId, params, body, set }: any) => {
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

    .patch("/:id/sector", async ({ tenantId, params, body, set }: any) => {
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

    .delete("/:id", async ({ tenantId, params, set }: any) => {
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

    .post("/:id/roles", async ({ tenantId, auth, params, body, set }: any) => {
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

    .delete("/:id/roles/:roleId", async ({ tenantId, params, set }: any) => {
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
  })

    .post("/import", async ({ tenantId, auth, body, request, set }: any) => {
      const ip = getClientIp(request);
      if (!(await checkRateLimit(`users-import:${tenantId}:${ip}`, 5, 60 * 60_000))) {
        set.status = 429;
        return { error: { code: "RATE_LIMITED", message: "Demasiadas importações. Tente novamente mais tarde." } };
      }
      try {
        return await withTenant(tenantId, async (tx) => {
          try {
            const csvRows = parseCsv(body.csv);
            const header = (csvRows[0] || []).map(h => h.trim().toLowerCase());
            const emailIdx = header.indexOf("email");
            const nameIdx = Math.max(header.indexOf("full_name"), header.indexOf("fullname"), header.indexOf("nome"));
            const sectorIdx = header.indexOf("sector");
            const roleIdx = header.indexOf("role");
            if (emailIdx === -1 || nameIdx === -1) {
              set.status = 422;
              return { error: { code: "CSV_HEADER", message: "CSV deve ter as colunas: email,full_name,sector,role." } };
            }

            const dataRows = csvRows.slice(1);
            const sectorList = await tx.query.sectors.findMany({
              where: eq(sectors.tenantId, tenantId),
              columns: { id: true, name: true, code: true },
            });
            const roleList = await tx.query.roles.findMany({
              where: or(eq(roles.tenantId, tenantId), isNull(roles.tenantId)),
              columns: { id: true, name: true, tenantId: true },
            });
            const existingEmails = new Set(
              (await tx.query.users.findMany({ where: eq(users.tenantId, tenantId), columns: { email: true } })).map(u => u.email)
            );
            const sectorByName = new Map(sectorList.map(s => [s.name.toLowerCase(), s.id]));
            const sectorByCode = new Map(sectorList.map(s => [s.code.toLowerCase(), s.id]));
            const roleByName = new Map(roleList.map(r => [r.name.toLowerCase(), r.id]));

            const created: { email: string; fullName: string; temporaryPassword?: string; emailed: boolean }[] = [];
            const skipped: { row: number; reason: string }[] = [];
            const errors: { row: number; reason: string }[] = [];
            const isProd = process.env.NODE_ENV === "production";
            const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, tenantId) });

            let rowNum = 1;
            for (const cols of dataRows) {
              rowNum++;
              const email = (cols[emailIdx] || "").trim().toLowerCase();
              const fullName = (cols[nameIdx] || "").trim();
              const sectorRef = (cols[sectorIdx] || "").trim();
              const roleRef = (cols[roleIdx] || "").trim();

              if (!email || !fullName) { errors.push({ row: rowNum, reason: "email ou nome em falta." }); continue; }
              if (!EMAIL_RE.test(email)) { errors.push({ row: rowNum, reason: `email inválido: ${email}` }); continue; }
              if (existingEmails.has(email)) { skipped.push({ row: rowNum, reason: `email já existente: ${email}` }); continue; }

              let sectorId: string | null = null;
              if (sectorRef) {
                sectorId = sectorByName.get(sectorRef.toLowerCase()) || sectorByCode.get(sectorRef.toLowerCase()) || null;
                if (!sectorId) { errors.push({ row: rowNum, reason: `sector não encontrado: ${sectorRef}` }); continue; }
              }

              let roleId: string | null = null;
              if (roleRef) {
                roleId = roleByName.get(roleRef.toLowerCase()) || null;
                if (!roleId) { errors.push({ row: rowNum, reason: `role não encontrado: ${roleRef}` }); continue; }
              }

              const password = randomPassword();
              const passwordHash = await Bun.password.hash(password);
              const [user] = await tx.insert(users).values({
                tenantId, sectorId, email, fullName, passwordHash,
              }).returning();
              existingEmails.add(email);
              if (roleId) {
                await tx.insert(userRoles).values({ userId: user.id, roleId, sectorId, grantedBy: auth!.userId });
              }
              const emailed = await enqueueInviteEmail(email, fullName, org?.name || "DocID", password);
              created.push({
                email,
                fullName,
                emailed,
                // Em produção nunca devolver passwords no JSON; em dev só se o email falhou
                temporaryPassword: (!isProd && !emailed) ? password : undefined,
              });
            }

            return {
              data: {
                total: created.length + skipped.length + errors.length,
                created,
                skipped,
                errors,
              },
            };
          } catch (err: any) {
            console.error("[IMPORT_USERS_ERROR]", err);
            throw err;
          }
        });
      } catch (err: any) {
        set.status = 400;
        return { error: { code: "IMPORT_ERROR", message: safeError(err) } };
      }
    }, {
      body: t.Object({ csv: t.String() }),
      detail: { summary: "Importar utilizadores via CSV", tags: ["Utilizadores"] },
    }));
