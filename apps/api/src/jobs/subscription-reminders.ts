import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
// Job corre fora de qualquer tenant: organizations tem RLS (ver lookupDb).
import { lookupDb as db } from "../db";
import { organizations } from "../db/schema";
import { logger } from "../lib/logger";
import { sendProviderExpiryAlertEmail, sendRenewalReminderEmail } from "../services/mailer.service";
import { getTenantContactEmail } from "../services/subscription.service";
import { runLicenseAlerts } from "./license-alerts";

interface ExpiringTenant {
  tenantId: string;
  name: string;
  daysLeft: number;
  contactEmail: string | null;
  expiresAt: Date;
}

const daysLeft = (now: Date) => {
  const dia = now.toISOString(); // postgres-js não aceita Date directamente em parâmetro SQL cru
  return sql<number>`(date_trunc('day', ${organizations.subscriptionExpiresAt})::date - date_trunc('day', ${dia}::timestamptz)::date)::int`;
};

async function findByDaysLeft(now: Date, days: number[], dueOnly = false): Promise<ExpiringTenant[]> {
  const filters = [
    eq(organizations.subscriptionStatus, "paid"),
    isNotNull(organizations.subscriptionExpiresAt),
  ];
  // dueOnly = todas as vencidas, qualquer que seja o bucket de dias.
  if (dueOnly) filters.push(lt(organizations.subscriptionExpiresAt, now));
  else filters.push(inArray(daysLeft(now), days));
  const rows = await db.select({
    tenantId: organizations.id,
    name: organizations.name,
    daysLeft: daysLeft(now),
    expiresAt: organizations.subscriptionExpiresAt,
  }).from(organizations).where(and(...filters));

  return Promise.all(rows.map(async (row) => ({
    ...row,
    contactEmail: await getTenantContactEmail(row.tenantId),
  })));
}

export function findExpiringTenants(now: Date): Promise<ExpiringTenant[]> {
  return findByDaysLeft(now, [30, 14, 2]);
}

export async function flipExpiredTenants(now: Date): Promise<number> {
  const rows = await db.update(organizations)
    .set({ subscriptionStatus: "expired" })
    .where(and(
      eq(organizations.subscriptionStatus, "paid"),
      isNotNull(organizations.subscriptionExpiresAt),
      lt(organizations.subscriptionExpiresAt, now),
    ))
    .returning({ id: organizations.id });
  return rows.length;
}

export async function runRenewalSweep(now: Date): Promise<{ reminded: number; expired: number; licenseAlerts: number }> {
  // Capturar antes do flip: depois dele estas organizações deixam de ser "paid".
  const overdue = await findByDaysLeft(now, [], true);
  const expiring = await findByDaysLeft(now, [30, 14, 2]);
  const expired = await flipExpiredTenants(now);

  let reminded = 0;
  for (const org of expiring) {
    if (!org.contactEmail) continue;
    try {
      await sendRenewalReminderEmail(org.contactEmail, {
        tenantName: org.name, expiresAt: org.expiresAt!, daysLeft: org.daysLeft,
      });
      reminded++;
    } catch (err) {
      logger.warn({ err, tenantId: org.tenantId }, "[SWEEP] Falha ao enviar lembrete de renovação.");
    }
  }

  for (const org of overdue) {
    try {
      await sendProviderExpiryAlertEmail(process.env.PROVIDER_NOTIFY_EMAIL || "", {
        tenantId: org.tenantId, tenantName: org.name, contactEmail: org.contactEmail,
      });
    } catch (err) {
      logger.warn({ err, tenantId: org.tenantId }, "[SWEEP] Falha ao alertar a provedora.");
    }
  }

  // Avisos de licença aos administradores de cada organização (e-mail do tenant ou da plataforma).
  let licenseAlerts = 0;
  try {
    licenseAlerts = await runLicenseAlerts(now);
  } catch (err) {
    logger.warn({ err }, "[SWEEP] Falha nos avisos de licença.");
  }

  return { reminded, expired, licenseAlerts };
}
