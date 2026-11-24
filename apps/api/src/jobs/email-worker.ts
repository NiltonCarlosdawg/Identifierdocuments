import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { emailLogs } from "../db/schema";
import { logger } from "../lib/logger";
import { buildDownloadUrl } from "../lib/signed-link";
import { renderEmail } from "../services/email/templates";
import { EmailSendError, sendEmail, formatAddress } from "../services/email/transport";
import { onEmailEnqueued, resolveSender } from "../services/email/tenant-email.service";

/**
 * Worker da fila de e-mails (outbox em PostgreSQL).
 *
 * 1. `email_outbox_claim` reclama um lote (FOR UPDATE SKIP LOCKED + lease), para
 *    várias instâncias da API nunca enviarem o mesmo e-mail.
 * 2. Cada e-mail é preparado dentro de withTenant(tenant_id): o RLS limita a leitura
 *    à configuração e aos dados desse tenant.
 * 3. O envio acontece fora da transacção (não prende ligações à BD durante a rede).
 * 4. Falha temporária → nova tentativa com espera exponencial; falha definitiva ou
 *    tentativas esgotadas → `failed` com a mensagem de erro.
 */

const BATCH = 10;
const LEASE_SECONDS = 120;

/** Espera antes da tentativa seguinte: 1 min, 5 min, 25 min, ~2 h, máx. 6 h. */
export function backoffSeconds(attempt: number): number {
  return Math.min(60 * 5 ** Math.max(0, attempt - 1), 6 * 3600);
}

/** Decide o estado depois de uma falha. */
export function nextStateAfterFailure(attempts: number, maxAttempts: number, permanent: boolean, now = Date.now()) {
  if (permanent || attempts >= maxAttempts) return { status: "failed" as const, nextAttemptAt: null };
  return { status: "queued" as const, nextAttemptAt: new Date(now + backoffSeconds(attempts) * 1000) };
}

function truncate(s: string, n = 1000) { return s.length > n ? `${s.slice(0, n)}…` : s; }

async function processOne(id: string, tenantId: string): Promise<void> {
  // Fase 1 — preparar, no contexto RLS do tenant do e-mail.
  const prepared = await withTenant(tenantId, async (tx) => {
    const row = await tx.query.emailLogs.findFirst({ where: and(eq(emailLogs.id, id), eq(emailLogs.tenantId, tenantId)) });
    if (!row || row.status !== "sending") return null;
    const resolution = await resolveSender(tx, tenantId);
    return { row, resolution };
  });
  if (!prepared) return;
  const { row, resolution } = prepared;

  if (resolution.ok === false) {
    await withTenant(tenantId, (tx) => tx.update(emailLogs).set({
      status: "skipped", lastError: `${resolution.reason}: ${resolution.message}`, lockedUntil: null, updatedAt: new Date(),
    }).where(eq(emailLogs.id, id)));
    logger.warn({ emailId: id, tenantId, reason: resolution.reason }, "[EMAIL] envio ignorado");
    return;
  }

  // Fase 2 — renderizar e enviar (fora da transacção).
  const sender = resolution.sender;
  try {
    const data = { ...(row.templateData as Record<string, unknown>) };
    if (data.withLink && row.recipientUserId && row.documentId) {
      data.link = buildDownloadUrl({ t: tenantId, d: row.documentId, u: row.recipientUserId });
    }
    const rendered = renderEmail(row.eventType, data);
    const messageId = await sendEmail(sender, { ...rendered, to: row.recipientEmail });
    await withTenant(tenantId, (tx) => tx.update(emailLogs).set({
      status: "sent", sentAt: new Date(), messageId, lastError: null, lockedUntil: null,
      provider: `${sender.source}:${sender.provider}`, sender: formatAddress(sender.fromName, sender.fromEmail),
      subject: rendered.subject, updatedAt: new Date(),
    }).where(eq(emailLogs.id, id)));
    logger.info({ emailId: id, tenantId, event: row.eventType }, "[EMAIL] enviado");
  } catch (err: any) {
    const permanent = err instanceof EmailSendError ? err.permanent : false;
    const next = nextStateAfterFailure(row.attempts, row.maxAttempts, permanent);
    await withTenant(tenantId, (tx) => tx.update(emailLogs).set({
      status: next.status,
      ...(next.nextAttemptAt ? { nextAttemptAt: next.nextAttemptAt } : {}),
      lastError: truncate(String(err?.message ?? err)),
      lockedUntil: null,
      provider: `${sender.source}:${sender.provider}`,
      updatedAt: new Date(),
    }).where(eq(emailLogs.id, id)));
    logger.warn({ emailId: id, tenantId, attempts: row.attempts, permanent, status: next.status, err: err?.message }, "[EMAIL] falha no envio");
  }
}

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Processa a fila até a esvaziar (ou até não haver nada pronto para envio). */
export async function runEmailWorkerOnce(): Promise<number> {
  if (running) return 0;
  running = true;
  let processed = 0;
  try {
    await db.execute(sql`SELECT email_outbox_expire_stuck()`);
    for (;;) {
      const claimed = (await db.execute(
        sql`SELECT id, tenant_id FROM email_outbox_claim(${BATCH}, ${LEASE_SECONDS})`,
      )) as unknown as Array<{ id: string; tenant_id: string }>;
      if (claimed.length === 0) break;
      for (const c of claimed) {
        try { await processOne(c.id, c.tenant_id); } catch (err) {
          logger.error({ err, emailId: c.id }, "[EMAIL] erro inesperado a processar e-mail");
        }
        processed++;
      }
      if (claimed.length < BATCH) break;
    }
  } catch (err) {
    logger.error({ err }, "[EMAIL] ciclo do worker falhou");
  } finally {
    running = false;
  }
  return processed;
}

export function startEmailWorker(): void {
  if (timer || process.env.NODE_ENV === "test" || process.env.EMAIL_WORKER_ENABLED === "false") return;
  const interval = Math.max(1000, Number(process.env.EMAIL_WORKER_INTERVAL_MS) || 10_000);
  timer = setInterval(() => { void runEmailWorkerOnce(); }, interval);
  timer.unref?.();
  onEmailEnqueued(() => { void runEmailWorkerOnce(); });
  logger.info({ intervalMs: interval }, "[EMAIL] worker da fila de e-mails activo");
}
