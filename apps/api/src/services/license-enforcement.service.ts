import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "../db/withTenant";
import { organizations, users, plans } from "../db/schema";

/**
 * Estado da licença de uma organização e regras de acesso.
 *
 * Decisões de negócio (configuráveis por variáveis de ambiente):
 *   - organizações novas: período de teste de LICENSE_TRIAL_DAYS (14) dias,
 *     com no máximo LICENSE_TRIAL_MAX_USERS (5) utilizadores activos;
 *   - depois do fim da licença há LICENSE_GRACE_DAYS (7) dias de tolerância em que tudo
 *     funciona, com aviso;
 *   - depois disso (ou se a licença for suspensa) a organização fica em "só consulta":
 *     entra, vê e descarrega, mas não cria nada novo.
 */
export type LicenseState = "active" | "grace" | "expired" | "suspended";

export interface LicenseInfo {
  licenseNumber: string;
  plan: string;
  state: LicenseState;
  /** false = só consulta. */
  canWrite: boolean;
  validUntil: string | null;
  graceUntil: string | null;
  /** Dias até ao fim da licença (negativo se já passou). null = sem prazo. */
  daysLeft: number | null;
  maxUsers: number | null;
  activeUsers: number;
}

const DAY = 24 * 3600 * 1000;

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

export const licenseConfig = {
  trialDays: () => envInt("LICENSE_TRIAL_DAYS", 14),
  trialMaxUsers: () => envInt("LICENSE_TRIAL_MAX_USERS", 5),
  graceDays: () => envInt("LICENSE_GRACE_DAYS", 7),
};

/** Valores para uma organização nova (período de teste). */
export function trialLicenseValues(now = new Date()) {
  const maxUsers = licenseConfig.trialMaxUsers();
  return {
    licenseValidUntil: new Date(now.getTime() + licenseConfig.trialDays() * DAY),
    licenseMaxUsers: maxUsers > 0 ? maxUsers : null,
    licenseStatus: "active" as const,
  };
}

/** Regra pura: calcula o estado a partir dos campos da licença. */
export function computeLicenseState(
  l: { licenseValidUntil: Date | null; licenseStatus: string },
  now = new Date(),
  graceDays = licenseConfig.graceDays(),
): { state: LicenseState; canWrite: boolean; graceUntil: Date | null; daysLeft: number | null } {
  const validUntil = l.licenseValidUntil;
  const graceUntil = validUntil ? new Date(validUntil.getTime() + graceDays * DAY) : null;
  const daysLeft = validUntil ? Math.ceil((validUntil.getTime() - now.getTime()) / DAY) : null;
  if (l.licenseStatus === "suspended") return { state: "suspended", canWrite: false, graceUntil, daysLeft };
  if (!validUntil || now <= validUntil) return { state: "active", canWrite: true, graceUntil, daysLeft };
  if (graceUntil && now <= graceUntil) return { state: "grace", canWrite: true, graceUntil, daysLeft };
  return { state: "expired", canWrite: false, graceUntil, daysLeft };
}

/* ───────── Cache curta por tenant (evita uma consulta à BD em cada pedido de escrita) ───────── */

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; info: LicenseInfo }>();

export function invalidateLicenseCache(tenantId?: string) {
  if (tenantId) cache.delete(tenantId); else cache.clear();
}

export async function getTenantLicense(tenantId: string, opts: { fresh?: boolean } = {}): Promise<LicenseInfo | null> {
  const hit = cache.get(tenantId);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.info;

  const row = await withTenant(tenantId, async (tx) => {
    const org = await tx.query.organizations.findFirst({
      where: eq(organizations.id, tenantId),
      columns: { licenseNumber: true, planId: true, licenseValidUntil: true, licenseMaxUsers: true, licenseStatus: true },
      with: { plan: true },
    });
    if (!org) return null;
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
    return { org, activeUsers: n };
  });
  if (!row) return null;

  const s = computeLicenseState(row.org);
  const info: LicenseInfo = {
    licenseNumber: row.org.licenseNumber,
    plan: row.org.plan?.name ?? "",
    state: s.state,
    canWrite: s.canWrite,
    validUntil: row.org.licenseValidUntil?.toISOString() ?? null,
    graceUntil: s.graceUntil?.toISOString() ?? null,
    daysLeft: s.daysLeft,
    maxUsers: row.org.licenseMaxUsers,
    activeUsers: row.activeUsers,
  };
  cache.set(tenantId, { at: Date.now(), info });
  return info;
}

/* ───────────── Que pedidos continuam permitidos em "só consulta" ───────────── */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Escritas permitidas mesmo com a licença expirada/suspensa:
 *  - conta do próprio utilizador (login, refresh, password, preferências);
 *  - marcar notificações como lidas;
 *  - registo de dispositivos;
 *  - sincronizar identificadores fiscais JÁ emitidos offline e devolver números não usados
 *    (recusá-los deixava faturas emitidas por registar e buracos na numeração legal);
 *  - endpoints da plataforma (autenticação própria).
 */
const READ_ONLY_ALLOWED: RegExp[] = [
  /^\/auth\//,
  /^\/notifications\/[^/]+\/read$/,
  /^\/devices\/?$/,
  /^\/identifiers\/(register-offline|register-offline-loose|release|force-release)$/,
  /^\/platform\//,
];

export function isBlockedWhenReadOnly(method: string, path: string): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  const p = path.replace(/\/+$/, "") || "/";
  return !READ_ONLY_ALLOWED.some((re) => re.test(p));
}

export function readOnlyMessage(info: LicenseInfo): string {
  const motivo = info.state === "suspended" ? "está suspensa" : "expirou";
  const contacto = process.env.LICENSE_SUPPORT_CONTACT || "o suporte DocID";
  return `A licença ${info.licenseNumber} ${motivo}. A organização está em modo só consulta: pode ver e descarregar documentos, mas não criar, carregar ou partilhar. Contacte ${contacto} para renovar.`;
}
