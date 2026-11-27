import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { DB } from "../../db";
import {
  documents, documentVersions, emailLogs, organizations, roles, sectors, tenantEmailSettings, userRoles, users,
  type EmailEventType,
} from "../../db/schema";
import { decryptSecret } from "../../lib/secret-box";
import { resolveSafeSmtpHost } from "../../lib/smtp-guard";
import { isValidEmail, type ResolvedSender } from "./transport";
import type { AttentionData, DocumentApprovedData, DocumentSharedData } from "./templates";

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
/** Avisos de segurança: saem sempre, mesmo com os e-mails desligados nas preferências. */
// license_alert: sem ele um administrador podia não saber que a organização vai deixar de poder criar documentos.
export const MANDATORY_EMAIL_EVENTS: ReadonlySet<EmailEventType> = new Set(["password_changed", "license_alert"]);

export function wantsEmail(prefs: Prefs, event: EmailEventType): boolean {
  if (MANDATORY_EMAIL_EVENTS.has(event)) return true;
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

/* ───────────────────── Acções que pedem atenção (aviso genérico) ───────────────────── */

const ROLE_LABELS: Record<string, string> = {
  ORG_ADMIN: "Administrador",
  MEMBER: "Membro",
  SECTOR_SUPERVISOR: "Supervisor de sector",
};

async function tenantName(tx: DB, tenantId: string): Promise<string> {
  const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, tenantId), columns: { name: true } });
  return org?.name ?? "DocID";
}

/** Administradores activos da organização (excepto quem fez a acção). */
async function adminIds(tx: DB, tenantId: string, exceptUserId?: string | null): Promise<string[]> {
  const rows = await tx.select({ id: users.id }).from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(
      eq(users.tenantId, tenantId),
      eq(roles.name, "ORG_ADMIN"),
      or(isNull(roles.tenantId), eq(roles.tenantId, tenantId)),
    ));
  return [...new Set(rows.map((r) => r.id))].filter((id) => id !== exceptUserId);
}

type AttentionBase = Omit<AttentionData, "tenantName" | "recipientName">;

/** Põe na fila um aviso genérico para cada destinatário que o quer receber. */
async function enqueueAttention(tx: DB, e: {
  tenantId: string;
  event: EmailEventType;
  recipientIds: Array<string | null | undefined>;
  documentId?: string | null;
  dedupe: string;
  build: AttentionBase;
}): Promise<number> {
  if (!emailNotificationsEnabled()) return 0;
  const recipients = await loadRecipients(tx, e.tenantId, e.recipientIds.filter((id): id is string => !!id), e.event);
  if (recipients.length === 0) return 0;
  const org = await tenantName(tx, e.tenantId);
  for (const r of recipients) {
    const data: AttentionData = { ...e.build, tenantName: org, recipientName: r.fullName };
    await enqueueEmail(tx, {
      tenantId: e.tenantId,
      eventType: e.event,
      recipientEmail: r.email,
      recipientUserId: r.id,
      documentId: e.documentId ?? null,
      subject: e.build.subject,
      templateData: data as unknown as Record<string, unknown>,
      dedupeKey: `${e.dedupe}:${r.id}`,
    });
  }
  return recipients.length;
}

/**
 * Pedido de aprovação: partilha entre sectores (`share`) ou pedido de acesso (`access`).
 * Destinatário: o supervisor que tem de decidir. Sem link: ainda não há decisão a ver.
 */
export async function onApprovalRequested(tx: DB, e: {
  tenantId: string;
  kind: "share" | "access";
  documentId: string;
  approvalId: string;
  supervisorId: string;
  requesterId: string;
  /** Destino da partilha: nome do sector, ou o utilizador destino. */
  targetName?: string | null;
  targetUserId?: string | null;
  at?: Date;
}): Promise<number> {
  if (!emailNotificationsEnabled() || e.supervisorId === e.requesterId) return 0;
  const info = await loadDocumentInfo(tx, e.tenantId, e.documentId);
  if (!info) return 0;
  const who = await userName(tx, e.requesterId);
  const target = e.targetName ?? (e.targetUserId ? await userName(tx, e.targetUserId) : null);
  const share = e.kind === "share";
  return enqueueAttention(tx, {
    tenantId: e.tenantId,
    event: share ? "approval_requested" : "access_requested",
    recipientIds: [e.supervisorId],
    documentId: e.documentId,
    dedupe: `${share ? "approval-req" : "access-req"}:${e.approvalId}`,
    build: {
      subject: share
        ? `Aprovação pendente: ${info.identifier} — ${info.title}`
        : `${who} pede acesso a ${info.identifier}`,
      title: share ? "Um documento aguarda a sua aprovação" : "Pedido de acesso a um documento",
      badge: share ? "Aprovação pendente" : "Pedido de acesso",
      tone: "warning",
      intro: [share
        ? `${who} quer enviar um documento para fora do sector. A partilha só fica activa depois de a aprovar.`
        : `${who} pediu acesso a um documento do seu sector.`],
      rows: [
        ["Documento", info.title],
        ["Identificador", info.identifier],
        ["Pedido por", who],
        ...(target ? [["Destino", target] as [string, string]] : []),
      ],
      at: (e.at ?? new Date()).toISOString(),
      action: "Abra a aplicação DocID, em Aprovações, para aprovar ou recusar.",
    },
  });
}

/** Recusa de uma partilha ou de um pedido de acesso. Destinatários: quem pediu / quem carregou. */
export async function onDocumentRejected(tx: DB, e: {
  tenantId: string;
  documentId: string;
  approvalId: string;
  rejecterId: string;
  recipientIds: Array<string | null | undefined>;
  kind: "share" | "access";
  notes?: string | null;
  at?: Date;
}): Promise<number> {
  if (!emailNotificationsEnabled()) return 0;
  const info = await loadDocumentInfo(tx, e.tenantId, e.documentId);
  if (!info) return 0;
  const who = await userName(tx, e.rejecterId);
  return enqueueAttention(tx, {
    tenantId: e.tenantId,
    event: "document_rejected",
    recipientIds: e.recipientIds.filter((id) => id !== e.rejecterId),
    documentId: e.documentId,
    dedupe: `rejected:${e.approvalId}`,
    build: {
      subject: e.kind === "access"
        ? `Pedido de acesso recusado: ${info.identifier}`
        : `Partilha recusada: ${info.identifier} — ${info.title}`,
      title: e.kind === "access" ? "O seu pedido de acesso foi recusado" : "A partilha do documento foi recusada",
      badge: "Recusado",
      tone: "danger",
      intro: [e.kind === "access"
        ? `${who} recusou o pedido de acesso ao documento.`
        : `${who} recusou o envio do documento para fora do sector. O destinatário não recebeu acesso.`],
      rows: [["Documento", info.title], ["Identificador", info.identifier], ["Recusado por", who]],
      note: e.notes?.trim() ? { label: `Motivo indicado por ${who}`, text: e.notes } : null,
      at: (e.at ?? new Date()).toISOString(),
    },
  });
}

/** Password alterada ou reposta. Aviso de segurança obrigatório para o próprio utilizador. */
export async function onPasswordChanged(tx: DB, e: {
  tenantId: string;
  userId: string;
  via: "change" | "reset";
  ip?: string | null;
  at?: Date;
}): Promise<number> {
  const at = e.at ?? new Date();
  return enqueueAttention(tx, {
    tenantId: e.tenantId,
    event: "password_changed",
    recipientIds: [e.userId],
    dedupe: `password:${e.userId}:${at.getTime()}`,
    build: {
      subject: "A password da sua conta DocID foi alterada",
      title: "Password alterada",
      badge: "Segurança",
      tone: "info",
      intro: [e.via === "reset"
        ? "A password da sua conta foi reposta com um código enviado para este e-mail."
        : "A password da sua conta foi alterada."],
      rows: e.ip ? [["Endereço IP", e.ip]] : [],
      at: at.toISOString(),
      action: "Se não foi você, peça já a um administrador da organização para bloquear a conta e repor a password. As sessões abertas noutros computadores já foram terminadas.",
    },
  });
}

/** Nova função atribuída a um utilizador (ex.: Administrador, Supervisor de sector). */
export async function onRoleGranted(tx: DB, e: {
  tenantId: string;
  userId: string;
  roleId: string;
  grantedBy: string;
  sectorId?: string | null;
  userRoleId: string;
}): Promise<number> {
  if (!emailNotificationsEnabled() || e.userId === e.grantedBy) return 0;
  const role = await tx.query.roles.findFirst({ where: eq(roles.id, e.roleId), columns: { name: true } });
  if (!role) return 0;
  const label = ROLE_LABELS[role.name] ?? role.name;
  const sector = e.sectorId
    ? await tx.query.sectors.findFirst({ where: and(eq(sectors.id, e.sectorId), eq(sectors.tenantId, e.tenantId)), columns: { name: true } })
    : null;
  const who = await userName(tx, e.grantedBy);
  return enqueueAttention(tx, {
    tenantId: e.tenantId,
    event: "role_granted",
    recipientIds: [e.userId],
    dedupe: `role:${e.userRoleId}`,
    build: {
      subject: `Tem uma nova função no DocID: ${label}`,
      title: "Recebeu uma nova função",
      badge: "Permissões",
      tone: "info",
      intro: [`${who} atribuiu-lhe a função ${label}${sector ? ` no sector ${sector.name}` : ""}.`],
      rows: [["Função", label], ...(sector ? [["Sector", sector.name] as [string, string]] : []), ["Atribuída por", who]],
      at: new Date().toISOString(),
      action: "As novas permissões ficam disponíveis da próxima vez que abrir a aplicação DocID.",
    },
  });
}

/** Novo computador registado na organização. Destinatários: os administradores. */
export async function onDeviceRegistered(tx: DB, e: {
  tenantId: string;
  deviceId: string;
  deviceName: string;
  userId: string;
  ip?: string | null;
}): Promise<number> {
  if (!emailNotificationsEnabled()) return 0;
  const who = await userName(tx, e.userId);
  return enqueueAttention(tx, {
    tenantId: e.tenantId,
    event: "device_registered",
    recipientIds: await adminIds(tx, e.tenantId, e.userId),
    dedupe: `device:${e.deviceId}`,
    build: {
      subject: `Novo computador registado: ${e.deviceName}`,
      title: "Novo computador na organização",
      badge: "Segurança",
      tone: "warning",
      intro: [`${who} registou um novo computador. A partir dele é possível gerar identificadores, incluindo sem ligação à internet.`],
      rows: [["Computador", e.deviceName], ["Registado por", who], ...(e.ip ? [["Endereço IP", e.ip] as [string, string]] : [])],
      at: new Date().toISOString(),
      action: "Se não reconhece este computador, desactive-o em Configurações › Dispositivos.",
    },
  });
}

/** Identificador anulado (afecta a numeração, incluindo a fiscal). Destinatários: os administradores. */
export async function onIdentifierCancelled(tx: DB, e: {
  tenantId: string;
  identifier: string;
  userId: string;
  reason?: string | null;
}): Promise<number> {
  if (!emailNotificationsEnabled()) return 0;
  const who = await userName(tx, e.userId);
  return enqueueAttention(tx, {
    tenantId: e.tenantId,
    event: "identifier_cancelled",
    recipientIds: await adminIds(tx, e.tenantId, e.userId),
    dedupe: `cancel:${e.identifier}`,
    build: {
      subject: `Identificador anulado: ${e.identifier}`,
      title: "Um identificador foi anulado",
      badge: "Anulação",
      tone: "warning",
      intro: [`${who} anulou o identificador ${e.identifier}. O número não volta a ser usado e fica registado na auditoria.`],
      rows: [["Identificador", e.identifier], ["Anulado por", who]],
      note: e.reason?.trim() ? { label: "Motivo", text: e.reason } : null,
      at: new Date().toISOString(),
    },
  });
}

/** Data por extenso curta (dd/mm/aaaa), no fuso dos e-mails. */
function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("pt-PT", { timeZone: process.env.EMAIL_TIMEZONE || "Africa/Luanda", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/**
 * Licença a terminar / em tolerância / em só consulta. Destinatários: todos os
 * administradores (aviso obrigatório). Ver jobs/license-alerts.ts.
 */
export async function onLicenseAlert(tx: DB, e: {
  tenantId: string;
  milestone: import("../../jobs/license-alerts").LicenseMilestone;
  key: string;
  validUntil: Date;
  now: Date;
}): Promise<number> {
  const org = await tx.query.organizations.findFirst({
    where: eq(organizations.id, e.tenantId),
    columns: { name: true, licenseNumber: true },
    with: { plan: true },
  });
  if (!org) return 0;
  const m = e.milestone;
  const until = shortDate(e.validUntil);
  const rows: Array<[string, string]> = [
    ["Organização", org.name],
    ...(org.licenseNumber ? [["Licença", org.licenseNumber] as [string, string]] : []),
    ...(org.plan?.name ? [["Plano", org.plan.name] as [string, string]] : []),
    ["Válida até", until],
  ];
  const renew = "Para renovar: na aplicação DocID, Configurações › Organização › \"Renovar / Actualizar\".";
  const readOnly = "Em só consulta continua a entrar, ver e descarregar documentos, mas não pode criar documentos nem identificadores.";

  let build: AttentionBase;
  if (m.kind === "expiring") {
    const dias = m.daysLeft <= 1 ? (m.daysLeft === 1 ? "amanhã" : "hoje") : `daqui a ${m.daysLeft} dias`;
    build = {
      subject: m.daysLeft <= 1 ? `A licença do DocID termina ${dias}` : `A licença do DocID termina daqui a ${m.daysLeft} dias`,
      title: "A licença está a terminar",
      badge: "Licença",
      tone: m.bucket <= 3 ? "danger" : "warning",
      intro: [
        `A licença de ${org.name} termina ${dias} (${until}).`,
        `Depois disso há um período de tolerância; no fim dele a organização passa a só consulta. ${readOnly}`,
      ],
      rows,
      action: renew,
    };
  } else if (m.kind === "grace" || m.kind === "grace_last") {
    const last = m.kind === "grace_last";
    build = {
      subject: last ? "Último dia de tolerância da licença do DocID" : "A licença do DocID terminou: período de tolerância",
      title: last ? "Último dia de tolerância" : "A licença terminou",
      badge: "Licença",
      tone: "danger",
      intro: [
        last
          ? `A licença de ${org.name} terminou a ${until} e a tolerância acaba a ${shortDate(m.graceUntil)}. A partir daí a organização passa a só consulta.`
          : `A licença de ${org.name} terminou a ${until}. Tudo continua a funcionar até ${shortDate(m.graceUntil)}; depois a organização passa a só consulta.`,
        readOnly,
      ],
      rows: [...rows, ["Tolerância até", shortDate(m.graceUntil)]],
      action: renew,
    };
  } else {
    build = {
      subject: "A organização está em só consulta no DocID",
      title: "Organização em só consulta",
      badge: "Licença",
      tone: "danger",
      intro: [`A licença de ${org.name} terminou a ${until} e o período de tolerância acabou.`, readOnly],
      rows,
      action: `${renew} Assim que a renovação for aprovada, tudo volta a funcionar.`,
    };
  }
  return enqueueAttention(tx, {
    tenantId: e.tenantId,
    event: "license_alert",
    recipientIds: await adminIds(tx, e.tenantId),
    dedupe: `license:${e.validUntil.toISOString().slice(0, 10)}:${e.key}`,
    build: { ...build, at: e.now.toISOString() },
  });
}
