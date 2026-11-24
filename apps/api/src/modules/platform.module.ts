import { createHash, timingSafeEqual } from "node:crypto";
import Elysia from "elysia";
import { Type as t } from "@sinclair/typebox";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { auditLogs, organizations, plans } from "../db/schema";
import { issueLicense } from "../services/license.service";
import { checkRateLimit } from "../middleware/rateLimit";
import { getClientIp } from "../lib/ip";
import { normalizeLicenseNumber } from "../lib/license-check";
import { safeError } from "../lib/errors";
import { computeLicenseState, invalidateLicenseCache } from "../services/license-enforcement.service";

/**
 * Gestão de licenças pela plataforma (Mil Vendas / Verano Labs), não pelas organizações.
 *
 * Autenticação: cabeçalho `x-platform-admin-token` igual a PLATFORM_ADMIN_TOKEN
 * (mínimo 32 caracteres). Sem esta variável, os endpoints ficam desligados.
 * As leituras entre tenants usam funções SECURITY DEFINER (migração 0025); as
 * alterações correm dentro de withTenant(organização) com app.license_admin = 'on',
 * o único caminho que o trigger da BD aceita.
 */

const MIN_TOKEN = 32;
const digest = (s: string) => createHash("sha256").update(s).digest();

function tokenOk(provided: string | null): boolean {
  const expected = process.env.PLATFORM_ADMIN_TOKEN;
  if (!expected || expected.length < MIN_TOKEN || !provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

// O db.execute do Drizzle devolve as datas como texto (não como Date).
type LicenseRow = {
  id: string; name: string; slug: string; license_number: string; license_issued_at: string; plan: string;
  license_valid_until: string | null; license_max_users: number | null; license_status: string;
  active_users: number; created_at: string;
};

const toDate = (v: string | Date | null) => (v == null ? null : new Date(v));

function present(r: LicenseRow) {
  const s = computeLicenseState({ licenseValidUntil: toDate(r.license_valid_until), licenseStatus: r.license_status });
  return {
    organizationId: r.id,
    name: r.name,
    slug: r.slug,
    licenseNumber: r.license_number,
    licenseIssuedAt: r.license_issued_at,
    plan: r.plan,
    status: r.license_status,
    state: s.state,
    canWrite: s.canWrite,
    validUntil: r.license_valid_until,
    graceUntil: s.graceUntil,
    daysLeft: s.daysLeft,
    maxUsers: r.license_max_users,
    activeUsers: r.active_users,
    createdAt: r.created_at,
  };
}

async function listAll(): Promise<LicenseRow[]> {
  return (await db.execute(sql`SELECT * FROM platform_list_licenses()`)) as unknown as LicenseRow[];
}

/** Número novo (organizations) ou número legado (tabela licenses, instalações antigas). */
async function findOrgByLicense(raw: string): Promise<string | null> {
  const n = normalizeLicenseNumber(raw);
  if (n) {
    const [row] = (await db.execute(sql`SELECT platform_find_org_by_license(${n}) AS org_id`)) as unknown as Array<{ org_id: string | null }>;
    if (row?.org_id) return row.org_id;
  }
  const [legacy] = (await db.execute(sql`SELECT platform_find_org_by_legacy_license(${raw}) AS org_id`)) as unknown as Array<{ org_id: string | null }>;
  return legacy?.org_id ?? null;
}

export const platformModule = new (Elysia as any)({ prefix: "/platform" })
  .onBeforeHandle(async ({ request, set }: any) => {
    if (!process.env.PLATFORM_ADMIN_TOKEN || process.env.PLATFORM_ADMIN_TOKEN.length < MIN_TOKEN) {
      set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Rota não encontrada." } };
    }
    const ip = getClientIp(request);
    if (!tokenOk(request.headers.get("x-platform-admin-token"))) {
      // Só as tentativas falhadas contam para o limite.
      if (!(await checkRateLimit(`platform-auth-fail:${ip}`, 10, 15 * 60_000))) {
        set.status = 429;
        return { error: { code: "RATE_LIMITED", message: "Demasiadas tentativas." } };
      }
      set.status = 401;
      return { error: { code: "UNAUTHORIZED", message: "Token da plataforma inválido." } };
    }
  })

  .get("/licenses", async ({ query }: any) => {
    let rows = (await listAll()).map(present);
    if (query.state) rows = rows.filter((r) => r.state === query.state);
    if (query.q) {
      const q = String(query.q).toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.includes(q) || r.licenseNumber.toLowerCase().includes(q));
    }
    return { data: rows, meta: { total: rows.length } };
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      state: t.Optional(t.Union([t.Literal("active"), t.Literal("grace"), t.Literal("expired"), t.Literal("suspended")])),
    }),
    detail: { summary: "Listar licenças de todas as organizações", tags: ["Plataforma"] },
  })

  .get("/licenses/:licenseNumber", async ({ params, set }: any) => {
    const orgId = await findOrgByLicense(params.licenseNumber);
    const row = orgId ? (await listAll()).find((r) => r.id === orgId) : undefined;
    if (!row) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Licença não encontrada." } }; }
    return { data: present(row) };
  }, {
    params: t.Object({ licenseNumber: t.String({ maxLength: 64 }) }),
    detail: { summary: "Consultar uma licença", tags: ["Plataforma"] },
  })

  .patch("/licenses/:licenseNumber", async ({ params, body, set, request }: any) => {
    const orgId = await findOrgByLicense(params.licenseNumber);
    if (body.validUntil !== undefined && body.extendDays !== undefined) {
      set.status = 422; return { error: { code: "VALIDATION_ERROR", message: "Use validUntil OU extendDays, não os dois." } };
    }
    let validUntil: Date | null | undefined;
    if (body.validUntil === null) validUntil = null;
    else if (typeof body.validUntil === "string") {
      validUntil = new Date(body.validUntil);
      if (Number.isNaN(validUntil.getTime())) { set.status = 422; return { error: { code: "VALIDATION_ERROR", message: "validUntil inválido (use AAAA-MM-DD)." } }; }
    }

    if (!orgId) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Licença não encontrada." } }; }

    try {
      await withTenant(orgId, async (tx) => {
        const current = await tx.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
        if (!current) throw new Error("Organização não encontrada.");
        const updates: Partial<typeof organizations.$inferInsert> = {};
        if (body.plan !== undefined) {
          const plan = await tx.query.plans.findFirst({ where: eq(plans.name, body.plan) });
          if (!plan) throw new Error(`Plano "${body.plan}" não existe.`);
          updates.planId = plan.id;
        }
        if (body.maxUsers !== undefined) updates.licenseMaxUsers = body.maxUsers;
        if (body.status !== undefined) updates.licenseStatus = body.status;
        if (validUntil !== undefined) updates.licenseValidUntil = validUntil;
        if (body.extendDays !== undefined) {
          // Renovar a partir do fim actual, ou de hoje se a licença já tiver expirado.
          const base = current.licenseValidUntil && current.licenseValidUntil > new Date() ? current.licenseValidUntil : new Date();
          updates.licenseValidUntil = new Date(base.getTime() + body.extendDays * 24 * 3600 * 1000);
        }
        if (Object.keys(updates).length === 0) throw new Error("Nada para alterar.");

        await tx.execute(sql`SELECT set_config('app.license_admin', 'on', true)`);
        await tx.update(organizations).set(updates).where(eq(organizations.id, orgId));
        await issueLicense(tx, {
          tenantId: orgId,
          ...(updates.planId !== undefined ? { planId: updates.planId } : {}),
          ...(body.maxUsers !== undefined ? { maxUsers: body.maxUsers } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(validUntil !== undefined ? { validUntil } : {}),
          ...(body.extendDays !== undefined ? { validUntil: updates.licenseValidUntil ?? null } : {}),
        });
        await tx.insert(auditLogs).values({
          tenantId: orgId, userId: null, action: "LICENSE_UPDATED", resource: "organizations", resourceId: orgId,
          ip: getClientIp(request),
          metadata: JSON.stringify({
            before: {
              planId: current.planId, validUntil: current.licenseValidUntil, maxUsers: current.licenseMaxUsers, status: current.licenseStatus,
            },
            changes: updates,
          }),
        });
      });
    } catch (err: any) {
      set.status = 400;
      const msg = err?.message === "Nada para alterar." ? err.message : safeError(err);
      return { error: { code: "LICENSE_UPDATE_ERROR", message: msg } };
    }
    invalidateLicenseCache(orgId);
    const row = (await listAll()).find((r) => r.id === orgId)!;
    return { data: present(row) };
  }, {
    params: t.Object({ licenseNumber: t.String({ maxLength: 64 }) }),
    body: t.Object({
      plan: t.Optional(t.String({ minLength: 2, maxLength: 40 })),
      validUntil: t.Optional(t.Union([t.String(), t.Null()])),
      extendDays: t.Optional(t.Integer({ minimum: 1, maximum: 3660 })),
      maxUsers: t.Optional(t.Union([t.Integer({ minimum: 1, maximum: 100000 }), t.Null()])),
      status: t.Optional(t.Union([t.Literal("active"), t.Literal("suspended")])),
    }),
    detail: { summary: "Renovar, mudar plano/limite ou suspender uma licença", tags: ["Plataforma"] },
  });
