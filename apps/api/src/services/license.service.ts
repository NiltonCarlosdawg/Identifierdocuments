import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, type DB } from "../db";
import { withTenant } from "../db/withTenant";
import { licenses, plans, organizations } from "../db/schema";
import { invalidateLicenseCache } from "./license-enforcement.service";
import { formatLicenseNumber, licenseState, type LicenseState, type LicenseStatus } from "../lib/license";
import { LICENSE_ALPHABET, licenseCheckChar } from "../lib/license-check";

export function generateLicenseNumber(now = new Date()): string {
  const bytes = randomBytes(11);
  let body = "";
  for (const b of bytes) body += LICENSE_ALPHABET[b % LICENSE_ALPHABET.length];
  const year = String(now.getUTCFullYear());
  return formatLicenseNumber(Number(year), body + licenseCheckChar(year + body));
}

/** Deriva o estado e os limites a partir da licença, sem tocar na BD. */
export function deriveLicenseContext(
  license: typeof licenses.$inferSelect | null,
  plan: typeof plans.$inferSelect | null,
  now = new Date(),
): { state: LicenseState | "none"; readOnly: boolean; maxUsers: number | null; planId: string | null; validUntil: Date | null } {
  if (!license) return { state: "none", readOnly: true, maxUsers: null, planId: null, validUntil: null };
  const state = licenseState({ status: license.status as LicenseStatus, validUntil: license.validUntil }, now);
  return {
    state,
    readOnly: state === "read_only" || state === "suspended",
    maxUsers: license.maxUsers ?? plan?.maxUsers ?? null,
    planId: license.planId ?? plan?.id ?? null,
    validUntil: license.validUntil,
  };
}

/** Licença de teste criada no onboarding (14 dias / 5 utilizadores). */
export function trialLicenseInput(tenantId: string, plan: { id: string }, now = new Date()) {
  const days = Number(process.env.LICENSE_TRIAL_DAYS) || 14;
  const maxUsers = Number(process.env.LICENSE_TRIAL_MAX_USERS) || 5;
  return {
    tenantId,
    planId: plan.id,
    maxUsers,
    status: "trial" as const,
    validUntil: new Date(now.getTime() + days * 86_400_000),
  };
}

/** Deve correr dentro do tenant (RLS). */
export async function getLicenseContext(tenantId: string, executor?: DB) {
  const run = (t: DB) => t.select({ license: licenses, plan: plans })
    .from(licenses)
    .leftJoin(plans, eq(licenses.planId, plans.id))
    .where(eq(licenses.tenantId, tenantId))
    .limit(1);
  const rows = executor ? await run(executor) : await withTenant(tenantId, run);
  const row = rows[0];
  return { license: row?.license ?? null, plan: row?.plan ?? null, ...deriveLicenseContext(row?.license ?? null, row?.plan ?? null) };
}

/** Cria ou actualiza a licença do tenant. Deve correr dentro do tenant. */
export async function issueLicense(
  tx: DB,
  input: {
    tenantId: string;
    planId?: string | null;
    maxUsers?: number | null;
    status?: LicenseStatus;
    validUntil?: Date | null;
    providerUserId?: string | null;
  },
) {
  const [existing] = await tx.select().from(licenses).where(eq(licenses.tenantId, input.tenantId)).limit(1);
  const values = {
    tenantId: input.tenantId,
    licenseNumber: existing?.licenseNumber ?? generateLicenseNumber(),
    planId: input.planId ?? existing?.planId ?? null,
    maxUsers: input.maxUsers === undefined ? (existing?.maxUsers ?? null) : input.maxUsers,
    status: input.status ?? existing?.status ?? "active",
    validUntil: input.validUntil === undefined ? (existing?.validUntil ?? null) : input.validUntil,
    updatedAt: new Date(),
    updatedBy: input.providerUserId ?? existing?.updatedBy ?? null,
  };
  if (existing) {
    const [updated] = await tx.update(licenses).set(values).where(eq(licenses.id, existing.id)).returning();
    await syncOrgLicense(tx, input, values);
    return updated;
  }
  const [created] = await tx.insert(licenses).values(values).returning();
  await syncOrgLicense(tx, input, values);
  return created;
}

/** Ponte: a tabela licenses continua a ser a fonte de verdade; espelha as
 * alterações nos campos de licença da organizations usados pelo licenseGuard. */
async function syncOrgLicense(
  tx: DB,
  input: { tenantId: string; maxUsers?: number | null; validUntil?: Date | null; status?: LicenseStatus },
  values: { maxUsers: number | null; validUntil: Date | null; status: string },
) {
  const patch: Partial<typeof organizations.$inferInsert> = {
    licenseStatus: values.status === "suspended" || values.status === "expired" ? "suspended" : "active",
    licenseUpdatedAt: new Date(),
  };
  if (input.maxUsers !== undefined) patch.licenseMaxUsers = values.maxUsers;
  if (input.validUntil !== undefined) patch.licenseValidUntil = values.validUntil;
  await tx.execute(sql`SELECT set_config('app.license_admin', 'on', true)`);
  await tx.update(organizations).set(patch).where(eq(organizations.id, input.tenantId));
  invalidateLicenseCache(input.tenantId);
}
