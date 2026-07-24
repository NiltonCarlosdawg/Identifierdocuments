import { Elysia, t } from "elysia";
import { db } from "../db";
import { organizations, sectors, users, roles, userRoles } from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";

export const tenantsModule = new Elysia({ prefix: "/tenants" })

  .post("/", async ({ body, set, request }) => {
    const ip = request.headers.get("x-forwarded-for") || "unknown"; // TODO(security): validar/sanitizar IP; atualmente confia no header
    if (!(await checkRateLimit(`onboarding:${ip}`, 3, 3600_000))) {
      set.status = 429;
      return { error: { code: "RATE_LIMITED", message: "Muitas tentativas de registo. Tente novamente em 1 hora." } };
    }
    try {
      const slug = body.slug ?? body.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 63);

      const existing = await db.query.organizations.findFirst({
        where: eq(organizations.slug, slug),
      });
      if (existing) {
        set.status = 409;
        return { error: { code: "SLUG_TAKEN", message: "Este slug já está em uso." } };
      }

      const result = await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({
            name: body.name,
            slug,
            identifierPrefix: body.identifierPrefix ?? slug.toUpperCase().slice(0, 4),
          })
          .returning();

        const [sector] = await tx
          .insert(sectors)
          .values({ tenantId: org.id, name: "Administração", code: "ADM" })
          .returning();

        const passwordHash = await Bun.password.hash(body.adminPassword);

        const [adminUser] = await tx
          .insert(users)
          .values({
            tenantId: org.id,
            sectorId: sector.id,
            email: body.adminEmail,
            passwordHash,
            fullName: body.adminName ?? "Administrador",
            isActive: true,
          })
          .returning();

        const orgAdminRole = await tx.query.roles.findFirst({
          where: and(eq(roles.name, "ORG_ADMIN"), isNull(roles.tenantId)),
        });

        if (!orgAdminRole) {
          throw new Error("Role ORG_ADMIN de sistema não encontrado. Corra o seed primeiro.");
        }

        await tx.insert(userRoles).values({
          userId: adminUser.id,
          roleId: orgAdminRole.id,
          sectorId: sector.id,
          grantedBy: adminUser.id,
        });

        return { org, adminUser };
      });

      return {
        data: {
          id: result.org.id,
          name: result.org.name,
          slug: result.org.slug,
          identifierPrefix: result.org.identifierPrefix,
          admin: {
            id: result.adminUser.id,
            email: result.adminUser.email,
            fullName: result.adminUser.fullName,
          },
        },
      };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "ONBOARDING_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({
      name: t.String({ minLength: 2 }),
      slug: t.Optional(t.String({ minLength: 2, pattern: "^[a-z0-9-]+$" })),
      adminEmail: t.String({ format: "email" }),
      adminPassword: t.String({ minLength: 6 }),
      adminName: t.Optional(t.String()),
      identifierPrefix: t.Optional(t.String({ maxLength: 6 })),
    }),
    detail: { summary: "Criar organização (onboarding público)", tags: ["Organizações"] },
  })

  .use(requireAuth())

  .get("/me", async ({ auth, set }) => {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, auth!.tenantId),
    });
    if (!org) {
      set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Organização não encontrada." } };
    }
    return {
      data: {
        ...org,
        identifierLeaseBatchSize: org.identifierLeaseBatchSize,
      },
    };
  }, {
    detail: { summary: "Dados da organização", tags: ["Organizações"] },
  })

  .use(requireRole("ORG_ADMIN"))

  .patch("/me", async ({ auth, body, set }) => {
    try {
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.identifierPrefix !== undefined) updates.identifierPrefix = body.identifierPrefix;
      if (body.identifierLeaseBatchSize !== undefined) updates.identifierLeaseBatchSize = body.identifierLeaseBatchSize;

      const [org] = await db
        .update(organizations)
        .set(updates)
        .where(eq(organizations.id, auth!.tenantId))
        .returning();
      return { data: org };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "UPDATE_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      identifierPrefix: t.Optional(t.String({ maxLength: 6 })),
      identifierLeaseBatchSize: t.Optional(t.Integer({ minimum: 10, maximum: 500 })),
    }),
    detail: { summary: "Actualizar organização", tags: ["Organizações"] },
  });
