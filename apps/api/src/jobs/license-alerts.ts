// A verificação corre fora de qualquer tenant: lê as organizações pelo pool de lookup.
import { lookupDb } from "../db";
import { withTenant } from "../db/withTenant";
import { organizations } from "../db/schema";
import { logger } from "../lib/logger";
import { computeLicenseState, licenseConfig } from "../services/license-enforcement.service";
import { onLicenseAlert } from "../services/email/tenant-email.service";

/**
 * Avisos de licença aos administradores, na verificação diária (BullMQ, 08:00 UTC).
 *
 * Momentos ("milestones"): faltam 14, 7, 3 e 1 dias; a licença terminou (início da
 * tolerância); último dia da tolerância; organização em "só consulta".
 * Cada momento sai no máximo uma vez por prazo de licença: a chave de dedupe leva a data
 * de fim da licença, por isso uma renovação recomeça a contagem. Usar "≤ N dias" em vez
 * de "= N dias" garante o aviso mesmo que a verificação falhe num dia.
 */
export const EXPIRY_BUCKETS = [14, 7, 3, 1] as const;

export type LicenseMilestone =
  | { kind: "expiring"; bucket: number; daysLeft: number }
  | { kind: "grace"; graceUntil: Date }
  | { kind: "grace_last"; graceUntil: Date }
  | { kind: "read_only" };

const DAY = 24 * 3600 * 1000;

/** Regra pura: que aviso (se algum) corresponde a esta licença neste momento. */
export function licenseMilestone(
  l: { licenseValidUntil: Date | null; licenseStatus: string },
  now: Date,
  graceDays = licenseConfig.graceDays(),
): LicenseMilestone | null {
  // Sem prazo, ou suspensa pela provedora (decisão deliberada, comunicada por ela).
  if (!l.licenseValidUntil || l.licenseStatus === "suspended") return null;
  const s = computeLicenseState(l, now, graceDays);
  if (s.state === "active") {
    const daysLeft = s.daysLeft ?? Infinity;
    const bucket = [...EXPIRY_BUCKETS].reverse().find((b) => daysLeft <= b);
    return bucket === undefined ? null : { kind: "expiring", bucket, daysLeft: Math.max(0, daysLeft) };
  }
  if (s.state === "grace") {
    const left = s.graceUntil!.getTime() - now.getTime();
    // Tolerância de 1 dia ou menos: o primeiro aviso já é o de "último dia".
    return left <= DAY ? { kind: "grace_last", graceUntil: s.graceUntil! } : { kind: "grace", graceUntil: s.graceUntil! };
  }
  if (s.state === "expired") {
    // Só avisa nos primeiros 30 dias em só consulta: não incomodar organizações abandonadas.
    return now.getTime() - s.graceUntil!.getTime() <= 30 * DAY ? { kind: "read_only" } : null;
  }
  return null;
}

export function milestoneKey(m: LicenseMilestone): string {
  return m.kind === "expiring" ? `expiring-${m.bucket}` : m.kind;
}

/** Percorre as organizações e põe na fila os avisos devidos. Devolve quantos e-mails entraram. */
export async function runLicenseAlerts(now: Date): Promise<number> {
  const orgs = await lookupDb.select({
    id: organizations.id,
    licenseValidUntil: organizations.licenseValidUntil,
    licenseStatus: organizations.licenseStatus,
  }).from(organizations);

  let queued = 0;
  for (const org of orgs) {
    const m = licenseMilestone(org, now);
    if (!m) continue;
    try {
      queued += await withTenant(org.id, (tx) => onLicenseAlert(tx, {
        tenantId: org.id, milestone: m, key: milestoneKey(m), validUntil: org.licenseValidUntil!, now,
      }));
    } catch (err) {
      logger.warn({ err, tenantId: org.id }, "[LICENSE] Falha ao preparar o aviso de licença.");
    }
  }
  if (queued > 0) logger.info({ queued }, "[LICENSE] avisos de licença em fila");
  return queued;
}
