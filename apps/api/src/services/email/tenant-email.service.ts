import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../../db";
import {
  documents, documentVersions, emailLogs, organizations, sectors, tenantEmailSettings, users,
  type EmailEventType,
} from "../../db/schema";
import { decryptSecret } from "../../lib/secret-box";
import { resolveSafeSmtpHost } from "../../lib/smtp-guard";
import { isValidEmail, type ResolvedSender } from "./transport";
import type { DocumentApprovedData, DocumentSharedData } from "./templates";

/* ───────────────────────── Configuração do remetente ───────────────────────── */

export type SenderResolution =
  | { ok: true; sender: ResolvedSender }
  | { ok: false; reason: "NOT_CONFIGURED" | "DISABLED" | "CONFIG_ERROR"; message: string };

/** "platform" (defeito): sem configuração própria, envia pelo SMTP da plataforma em nome do tenant.
 *  "block": sem configuração própria, o e-mail fica registado como `skipped`. */
export function fallbackMode(): "platform" | "block" {
  return process.env.EMAIL_FALLBACK_MODE === "block" ? "block" : "platform";
}

function parseAddress(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: "", email: raw.trim() };
}

async function platformSender(tenantName: string): Promise<SenderResolution> {
  const host = process.env.SMTP_HOST;
  if (!host) return { ok: false, reason: "NOT_CONFIGURED", message: "Sem configuração de e-mail do tenant nem SMTP da plataforma." };
  const port = Number(process.env.SMTP_PORT || 587);
  const from = parseAddress(process.env.SMTP_FROM || "DocID <no-reply@docid.local>");
  return {
    ok: true,
    sender: {
      source: "platform",
      provider: "smtp",
      fromEmail: from.email,
      // O destinatário vê a organização, mas o domínio é o da plataforma (SPF/DKIM correctos).
      fromName: `${tenantName} via DocID`,
      smtp: {
        host,
        connectHost: host, // SMTP da plataforma é configuração do operador, não do tenant
        port,
        // Igual ao mailer.service: SSL se SMTP_SECURE=true; senão STARTTLS quando disponível.
        security: process.env.SMTP_SECURE === "true" ? "ssl" : "auto",
        user: process.env.SMTP_USER || null,
        pass: process.env.SMTP_PASS || null,
      },
    },
  };
}

/**
 * Carrega a configuração de envio do tenant, em tempo de execução.
 * `tx` TEM de estar dentro de withTenant(tenantId): o RLS garante que só a linha
 * desse tenant é visível, e a desencriptação usa o tenant_id como dado autenticado.
 */
export async function resolveSender(tx: DB, tenantId: string): Promise<SenderResolution> {
  const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, tenantId) });
  const tenantName = org?.name ?? "DocID";
  const cfg = await tx.query.tenantEmailSettings.findFirst({ where: eq(tenantEmailSettings.tenantId, tenantId) });

  if (cfg && cfg.tenantId !== tenantId) {
    // Defesa em profundidade: nunca deve acontecer com o RLS activo.
    return { ok: false, reason: "CONFIG_ERROR", message: "Configuração de e-mail de outro tenant." };
  }
  if (!cfg) {
    return fallbackMode() === "platform"
      ? platformSender(tenantName)
      : { ok: false, reason: "NOT_CONFIGURED", message: "A organização ainda não configurou o envio de e-mail." };
  }
  if (!cfg.enabled) return { ok: false, reason: "DISABLED", message: "Envio de e-mail desactivado pela organização." };

  try {
    const secret = cfg.secretEncrypted ? decryptSecret(cfg.secretEncrypted, tenantId) : null;
    const base = {
      source: "tenant" as const,
      provider: cfg.provider,
      fromEmail: cfg.fromEmail,
      fromName: cfg.fromName || tenantName,
      replyTo: cfg.replyTo,
    };
    if (cfg.provider === "smtp") {
      const connectHost = await resolveSafeSmtpHost(cfg.smtpHost!, cfg.smtpPort!);
      return {
        ok: true,
        sender: {
          ...base,
          smtp: { host: cfg.smtpHost!, connectHost, port: cfg.smtpPort!, security: cfg.smtpSecurity ?? "starttls", user: cfg.smtpUser, pass: secret },
        },
      };
    }
    if (!secret) return { ok: false, reason: "CONFIG_ERROR", message: "Falta a chave de API do fornecedor de e-mail." };
    return { ok: true, sender: { ...base, apiKey: secret } };
  } catch (err: any) {
    return { ok: false, reason: "CONFIG_ERROR", message: err?.message ?? String(err) };
  }
}

/* ───────────────────────────── Fila (outbox) ───────────────────────────── */

export function emailNotificationsEnabled(): boolean {
  return process.env.EMAIL_NOTIFICATIONS_ENABLED !== "false";
}

interface EnqueueInput {
  tenantId: string;
  eventType: EmailEventType;
  recipientEmail: string;
  recipientUserId?: string | null;
  documentId?: string | null;
  subject: string;
  templateData: Record<string, unknown>;
  dedupeKey?: string | null;
}

/** Insere o e-mail na fila dentro da transacção do evento (commit/rollback juntos). */
export async function enqueueEmail(tx: DB, input: EnqueueInput): Promise<void> {
  await tx.insert(emailLogs).values({
    tenantId: input.tenantId,
    eventType: input.eventType,
    recipientEmail: input.recipientEmail,
    recipientUserId: input.recipientUserId ?? null,
    documentId: input.documentId ?? null,
    subject: input.subject,
    templateData: input.templateData,
    dedupeKey: input.dedupeKey ?? null,
  }).onConflictDoNothing();
  scheduleKick();
}

let kickHook: (() => void) | null = null;
/** O worker regista-se aqui para acordar logo após novos e-mails (em vez de esperar pelo intervalo). */
export function onEmailEnqueued(fn: () => void) { kickHook = fn; }
function scheduleKick() {
  // Pequeno atraso: dá tempo à transacção do pedido para fazer commit.
  if (kickHook) setTimeout(kickHook, 1500).unref?.();
}

/* ─────────────────────── Destinatários e dados do documento ─────────────────────── */

type Prefs = Record<string, unknown> | null | undefined;

/** O utilizador pode desligar e-mails em notification_preferences: `email: false` ou `email_<evento>: false`. */
export function wantsEmail(prefs: Prefs, event: EmailEventType): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  if (prefs.email === false) return false;
  return prefs[`email_${event}`] !== false;
}

async function loadRecipients(tx: DB, tenantId: string, userIds: string[], event: EmailEventType) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = await tx.select({
    id: users.id, email: users.email, fullName: users.fullName, isActive: users.isActive,
    tenantId: users.tenantId, prefs: users.notificationPreferences,
  }).from(users).where(and(inArray(users.id, ids), eq(users.tenantId, tenantId)));
  return rows.filter((u) => u.isActive && isValidEmail(u.email) && wantsEmail(u.prefs as Prefs, event));
}

async function loadDocumentInfo(tx: DB, tenantId: string, documentId: string) {
  const doc = await tx.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)),
    with: { identifier: true },
  });
  if (!doc) return null;
  const [version] = await tx.select({ filename: documentVersions.filename })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version))
    .limit(1);
  const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, tenantId) });
  const identifier = doc.identifier?.identifier ?? documentId;
  const description = doc.identifier?.description?.trim() || null;
  return {
    doc,
    tenantName: org?.name ?? "DocID",
    identifier,
    title: doc.label?.trim() || version?.filename || identifier,
    summary: description ? description.slice(0, 300) : null,
  };
}

async function userName(tx: DB, userId: string): Promise<string> {
  const u = await tx.query.users.findFirst({ where: eq(users.id, userId), columns: { fullName: true } });
  return u?.fullName ?? "Um utilizador";
}

/* ───────────────────────────── Handlers de eventos ───────────────────────────── */

/**
 * Evento "Documento aprovado". Destinatários: quem carregou o documento e os
 * interessados indicados (requerente do pedido de acesso, autor da partilha), sem o aprovador.
 */
export async function onDocumentApproved(tx: DB, e: {
  tenantId: string;
  documentId: string;
  approvalId: string;
  approverId: string;
  approvedAt: Date;
  notes?: string | null;
  interestedUserIds?: Array<string | null | undefined>;
}): Promise<number> {
  if (!emailNotificationsEnabled()) return 0;
  const info = await loadDocumentInfo(tx, e.tenantId, e.documentId);
  if (!info) return 0;
  const candidateIds = [info.doc.uploadedBy, ...(e.interestedUserIds ?? [])]
    .filter((id): id is string => typeof id === "string" && id !== e.approverId);
  const recipients = await loadRecipients(tx, e.tenantId, candidateIds, "document_approved");
  if (recipients.length === 0) return 0;
  const approverName = await userName(tx, e.approverId);

  for (const r of recipients) {
    const data: DocumentApprovedData & { withLink: boolean } = {
      tenantName: info.tenantName,
      recipientName: r.fullName,
      documentIdentifier: info.identifier,
      documentTitle: info.title,
      approverName,
      approvedAt: e.approvedAt.toISOString(),
      notes: e.notes ?? null,
      withLink: true, // o link assinado é gerado no envio, nunca guardado na BD
    };
    await enqueueEmail(tx, {
      tenantId: e.tenantId,
      eventType: "document_approved",
      recipientEmail: r.email,
      recipientUserId: r.id,
      documentId: e.documentId,
      subject: `Documento aprovado: ${info.identifier}`,
      templateData: data as unknown as Record<string, unknown>,
      dedupeKey: `approved:${e.approvalId}:${r.id}`,
    });
  }
  return recipients.length;
}

/**
 * Evento "Documento enviado a um destinatário". Só se chama quando a partilha fica
 * activa (directa, ou depois da aprovação cross-sector): um destinatário nunca recebe
 * um link para um documento a que ainda não tem acesso.
 */
export async function onDocumentShared(tx: DB, e: {
  tenantId: string;
  documentId: string;
  shareId: string;
  senderId: string;
  sharedWithUserId?: string | null;
  sharedWithSectorId?: string | null;
  sharedAt?: Date;
}): Promise<number> {
  if (!emailNotificationsEnabled()) return 0;
  const info = await loadDocumentInfo(tx, e.tenantId, e.documentId);
  if (!info) return 0;

  let candidateIds: string[] = [];
  let sectorName: string | null = null;
  if (e.sharedWithUserId) {
    candidateIds = [e.sharedWithUserId];
  } else if (e.sharedWithSectorId) {
    const sector = await tx.query.sectors.findFirst({
      where: and(eq(sectors.id, e.sharedWithSectorId), eq(sectors.tenantId, e.tenantId)),
    });
    if (!sector) return 0;
    sectorName = sector.name;
    const members = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.sectorId, e.sharedWithSectorId), eq(users.tenantId, e.tenantId)));
    candidateIds = members.map((m) => m.id);
  }
  candidateIds = candidateIds.filter((id) => id !== e.senderId);
  const recipients = await loadRecipients(tx, e.tenantId, candidateIds, "document_shared");
  if (recipients.length === 0) return 0;
  const senderName = await userName(tx, e.senderId);

  for (const r of recipients) {
    const data: DocumentSharedData & { withLink: boolean } = {
      tenantName: info.tenantName,
      recipientName: r.fullName,
      senderName,
      documentIdentifier: info.identifier,
      documentTitle: info.title,
      summary: info.summary,
      sectorName,
      sharedAt: (e.sharedAt ?? new Date()).toISOString(),
      withLink: true,
    };
    await enqueueEmail(tx, {
      tenantId: e.tenantId,
      eventType: "document_shared",
      recipientEmail: r.email,
      recipientUserId: r.id,
      documentId: e.documentId,
      subject: `${senderName} enviou-lhe um documento`,
      templateData: data as unknown as Record<string, unknown>,
      dedupeKey: `shared:${e.shareId}:${r.id}`,
    });
  }
  return recipients.length;
}
