import { hashPassword } from "../lib/password";
import { randomUUID } from "node:crypto";
import Elysia from "elysia";
import { Type as t } from "@sinclair/typebox";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { sql } from "drizzle-orm";
import { organizations, sectors, users, roles, userRoles, plans } from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { collectStats } from "./stats.module";
import { safeError } from "../lib/errors";
import { getClientIp } from "../lib/ip";

export const tenantsModule = new (Elysia as any)({ prefix: "/tenants" })

  .post("/", async ({ body, set, request }) => {
    const allowPublic = process.env.ALLOW_PUBLIC_ONBOARDING === "true";
    const expectedKey = process.env.ONBOARDING_SECRET;
    const providedKey = request.headers.get("x-onboarding-secret");
    if (!allowPublic && (!expectedKey || providedKey !== expectedKey)) {
      set.status = 403;
      return { error: { code: "ONBOARDING_DISABLED", message: "Onboarding público desactivado. Contacte o administrador." } };
    }

    if (!body.termsAccepted) {
      set.status = 400;
      return { error: { code: "TERMS_NOT_ACCEPTED", message: "Deve aceitar os Termos e Condições para criar a organização." } };
    }

    const ip = getClientIp(request);
    if (!(await checkRateLimit(`onboarding:${ip}`, 3, 3600_000))) {
      set.status = 429;
      return { error: { code: "RATE_LIMITED", message: "Muitas tentativas de registo. Tente novamente em 1 hora." } };
    }
    try {
      const slug = body.slug ?? body.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 63);

      const orgRows = (await db.execute(sql`SELECT * FROM auth_find_org_by_slug(${slug})`)) as unknown as Array<{ id: string }>;
      if (orgRows[0]) {
        set.status = 409;
        return { error: { code: "SLUG_TAKEN", message: "Este slug já está em uso." } };
      }

      const [freePlan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.isFree, true)).limit(1);
      if (!freePlan) throw new Error("Plano free não encontrado. Corra o seed primeiro.");

      const orgId = randomUUID();
      const result = await withTenant(orgId, async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({
            id: orgId,
            name: body.name,
            slug,
            identifierPrefix: body.identifierPrefix ?? slug.toUpperCase().slice(0, 4),
            planId: freePlan.id,
            termsAccepted: true,
            termsAcceptedAt: new Date(),
          })
          .returning();

        const [sector] = await tx
          .insert(sectors)
          .values({ tenantId: org.id, name: "Administração", code: "ADM" })
          .returning();

        const passwordHash = await hashPassword(body.adminPassword);

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
      termsAccepted: t.Boolean(),
    }),
    detail: { summary: "Criar organização (onboarding público)", tags: ["Organizações"] },
  })

  .use(requireAuth())

  .get("/me", async ({ auth, set }) => {
    const org = await withTenant(auth!.tenantId, (tx) => tx.query.organizations.findFirst({
      where: eq(organizations.id, auth!.tenantId),
    }));
    if (!org) {
      set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Organização não encontrada." } };
    }
    return { data: org };
  }, {
    detail: { summary: "Dados da organização", tags: ["Organizações"] },
  })

  .use(requireRole("ORG_ADMIN"))

  .get("/me/stats", async ({ auth, set }) => {
    try {
      const stats = await collectStats(auth!.tenantId);
      return { data: stats };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "STATS_ERROR", message: safeError(err) } };
    }
  }, {
    detail: { summary: "Estatísticas da organização", tags: ["Organizações"] },
  })

  .patch("/me", async ({ auth, body, set }) => {
    try {
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.identifierPrefix !== undefined) updates.identifierPrefix = body.identifierPrefix;

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
    }),
    detail: { summary: "Actualizar organização", tags: ["Organizações"] },
  });
