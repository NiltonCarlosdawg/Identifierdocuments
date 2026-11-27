/**
 * Templates de e-mail (HTML responsivo + texto simples).
 *
 * Regras:
 * - Todas as variáveis passam por `esc()`: o título de um documento ou o nome de um
 *   utilizador nunca podem injectar HTML no e-mail.
 * - Layout em tabelas com estilos inline (o que o Outlook, o Gmail e a app Mail suportam).
 * - Os templates são renderizados no momento do envio a partir de `template_data`,
 *   por isso uma correcção ao template aplica-se também aos e-mails ainda na fila.
 */

export interface DocumentApprovedData {
  tenantName: string;
  recipientName: string;
  documentIdentifier: string;
  documentTitle: string;
  approverName: string;
  approvedAt: string; // ISO 8601
  notes?: string | null;
  link?: string | null;
}

export interface DocumentSharedData {
  tenantName: string;
  recipientName: string;
  senderName: string;
  documentIdentifier: string;
  documentTitle: string;
  summary?: string | null;
  sectorName?: string | null; // preenchido quando a partilha foi com o sector do destinatário
  sharedAt: string; // ISO 8601
  link?: string | null;
}

export interface TestEmailData {
  tenantName: string;
  sender: string;
}

/**
 * Aviso genérico de "acção que pede atenção" (pedido de aprovação, recusa, password
 * alterada, novo dispositivo...). Os handlers em tenant-email.service.ts montam estes
 * dados; aqui só há texto simples, por isso tudo passa por esc().
 */
export interface AttentionData {
  tenantName: string;
  recipientName: string;
  /** Título no corpo do e-mail. */
  title: string;
  subject: string;
  /** Etiqueta curta acima do título (ex.: "Aprovação pendente"). */
  badge?: string | null;
  tone?: "info" | "warning" | "danger" | "success";
  /** Parágrafos de introdução (texto simples). */
  intro: string[];
  rows?: Array<[string, string]>;
  /** Citação destacada, ex.: o motivo de uma recusa. */
  note?: { label: string; text: string } | null;
  /** O que o destinatário deve fazer a seguir. */
  action?: string | null;
  /** Data do evento (ISO 8601), mostrada como "Data e hora". */
  at?: string | null;
  /** Para documentos: o worker gera um link de download assinado no envio. */
  withLink?: boolean;
  link?: string | null;
  linkLabel?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Só aceitamos links http(s); qualquer outra coisa (ex.: javascript:) é descartada. */
function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Remove quebras de linha do assunto (evita injecção de cabeçalhos) e limita o tamanho. */
function cleanSubject(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}

export function formatDateTime(iso: string, timeZone = process.env.EMAIL_TIMEZONE || "Africa/Luanda"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("pt-PT", {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} às ${get("hour")}h${get("minute")}`;
}

const COLORS = {
  bg: "#f3f4f6",
  card: "#ffffff",
  text: "#1f2937",
  muted: "#6b7280",
  border: "#e5e7eb",
  primary: "#1d4ed8",
  success: "#047857",
  successBg: "#ecfdf5",
};

const TONES: Record<NonNullable<AttentionData["tone"]>, { fg: string; bg: string }> = {
  info: { fg: "#1d4ed8", bg: "#eff6ff" },
  warning: { fg: "#b45309", bg: "#fffbeb" },
  danger: { fg: "#b91c1c", bg: "#fef2f2" },
  success: { fg: COLORS.success, bg: COLORS.successBg },
};

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;color:${COLORS.muted};font-size:14px;width:38%;vertical-align:top;">${esc(label)}</td>
    <td style="padding:8px 0;color:${COLORS.text};font-size:14px;font-weight:600;vertical-align:top;">${value}</td>
  </tr>`;
}

function button(url: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px;">
    <tr><td style="border-radius:6px;background:${COLORS.primary};">
      <a href="${esc(url)}" target="_blank" rel="noopener"
         style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

function layout(opts: { preheader: string; tenantName: string; badge?: string; tone?: { fg: string; bg: string }; title: string; body: string }): string {
  const tone = opts.tone ?? { fg: COLORS.success, bg: COLORS.successBg };
  const badge = opts.badge
    ? `<div style="display:inline-block;padding:4px 10px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-size:12px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;margin-bottom:12px;">${esc(opts.badge)}</div>`
    : "";
  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(opts.title)}</title>
<style>
  @media (max-width:620px){ .container{width:100% !important;} .px{padding-left:20px !important;padding-right:20px !important;} }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COLORS.bg};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
      <tr><td class="px" style="padding:0 32px 16px;color:${COLORS.muted};font-size:13px;font-weight:600;">${esc(opts.tenantName)}</td></tr>
      <tr><td class="px" style="background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:10px;padding:32px;">
        ${badge}
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;color:${COLORS.text};">${esc(opts.title)}</h1>
        ${opts.body}
      </td></tr>
      <tr><td class="px" style="padding:16px 32px;color:${COLORS.muted};font-size:12px;line-height:1.5;">
        Mensagem automática enviada por ${esc(opts.tenantName)} através do DocID. Não responda a este e-mail se não for necessário.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function renderDocumentApproved(d: DocumentApprovedData): RenderedEmail {
  const when = formatDateTime(d.approvedAt);
  const link = safeUrl(d.link);
  const subject = cleanSubject(`Documento aprovado: ${d.documentIdentifier} — ${d.documentTitle}`);
  const notes = d.notes?.trim()
    ? `<div style="margin-top:16px;padding:12px 14px;border-left:3px solid ${COLORS.border};color:${COLORS.text};font-size:14px;line-height:1.5;">
         <div style="color:${COLORS.muted};font-size:12px;margin-bottom:4px;">Observações de ${esc(d.approverName)}</div>${esc(d.notes.trim())}
       </div>`
    : "";
  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.text};">Olá ${esc(d.recipientName)},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.text};">O documento <strong>${esc(d.documentTitle)}</strong> foi aprovado.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:8px 0;">
      ${row("Identificador", esc(d.documentIdentifier))}
      ${row("Documento", esc(d.documentTitle))}
      ${row("Aprovado por", esc(d.approverName))}
      ${row("Data e hora", esc(when))}
    </table>
    ${notes}
    ${link ? button(link, "Ver documento") : ""}
    ${link ? `<p style="margin:8px 0 0;font-size:12px;color:${COLORS.muted};">O link é pessoal e expira. Também pode abrir o documento na aplicação DocID.</p>` : ""}`;
  const text = [
    `Olá ${d.recipientName},`,
    ``,
    `O documento "${d.documentTitle}" foi aprovado.`,
    ``,
    `Identificador: ${d.documentIdentifier}`,
    `Aprovado por: ${d.approverName}`,
    `Data e hora: ${when}`,
    d.notes?.trim() ? `Observações: ${d.notes.trim()}` : null,
    link ? `\nVer documento: ${link}` : null,
    ``,
    `— ${d.tenantName} (DocID)`,
  ].filter((l) => l !== null).join("\n");
  return {
    subject,
    text,
    html: layout({ preheader: `${d.approverName} aprovou ${d.documentIdentifier}.`, tenantName: d.tenantName, badge: "Aprovado", title: "Documento aprovado", body }),
  };
}

export function renderDocumentShared(d: DocumentSharedData): RenderedEmail {
  const when = formatDateTime(d.sharedAt);
  const link = safeUrl(d.link);
  const subject = cleanSubject(`${d.senderName} enviou-lhe um documento: ${d.documentTitle}`);
  const target = d.sectorName ? ` com o sector <strong>${esc(d.sectorName)}</strong>` : " consigo";
  const summary = d.summary?.trim()
    ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:${COLORS.text};"><span style="color:${COLORS.muted};">Resumo:</span> ${esc(d.summary.trim())}</p>`
    : "";
  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.text};">Olá ${esc(d.recipientName)},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.text};"><strong>${esc(d.senderName)}</strong> partilhou um documento${target}.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:8px 0;">
      ${row("Documento", esc(d.documentTitle))}
      ${row("Identificador", esc(d.documentIdentifier))}
      ${row("Enviado por", esc(d.senderName))}
      ${row("Data e hora", esc(when))}
    </table>
    ${summary}
    ${link ? button(link, "Abrir documento") : ""}
    ${link ? `<p style="margin:8px 0 0;font-size:12px;color:${COLORS.muted};">O link é pessoal, expira e só funciona enquanto tiver acesso ao documento.</p>` : `<p style="margin:16px 0 0;font-size:14px;color:${COLORS.muted};">Abra a aplicação DocID para consultar o documento.</p>`}`;
  const text = [
    `Olá ${d.recipientName},`,
    ``,
    `${d.senderName} partilhou um documento${d.sectorName ? ` com o sector ${d.sectorName}` : " consigo"}.`,
    ``,
    `Documento: ${d.documentTitle}`,
    `Identificador: ${d.documentIdentifier}`,
    `Enviado por: ${d.senderName}`,
    `Data e hora: ${when}`,
    d.summary?.trim() ? `Resumo: ${d.summary.trim()}` : null,
    link ? `\nAbrir documento: ${link}` : `\nAbra a aplicação DocID para consultar o documento.`,
    ``,
    `— ${d.tenantName} (DocID)`,
  ].filter((l) => l !== null).join("\n");
  return {
    subject,
    text,
    html: layout({ preheader: `${d.senderName} enviou-lhe ${d.documentIdentifier}.`, tenantName: d.tenantName, title: "Recebeu um documento", body }),
  };
}

export function renderTestEmail(d: TestEmailData): RenderedEmail {
  const body = `<p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.text};">Este é um e-mail de teste. Se o recebeu, o envio a partir de <strong>${esc(d.sender)}</strong> está a funcionar.</p>`;
  return {
    subject: cleanSubject(`Teste de envio — ${d.tenantName}`),
    text: `Este é um e-mail de teste. Se o recebeu, o envio a partir de ${d.sender} está a funcionar.\n\n— ${d.tenantName} (DocID)`,
    html: layout({ preheader: "Teste de configuração de e-mail.", tenantName: d.tenantName, title: "Configuração de e-mail OK", body }),
  };
}

export function renderAttention(d: AttentionData): RenderedEmail {
  const link = safeUrl(d.link);
  const tone = TONES[d.tone ?? "info"] ?? TONES.info;
  const rows = [...(d.rows ?? [])];
  if (d.at) rows.push(["Data e hora", formatDateTime(d.at)]);
  const p = (t: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.text};">${esc(t)}</p>`;
  const table = rows.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:8px 0;">
      ${rows.map(([k, v]) => row(k, esc(v))).join("")}
    </table>`
    : "";
  const note = d.note?.text?.trim()
    ? `<div style="margin-top:16px;padding:12px 14px;border-left:3px solid ${tone.fg};color:${COLORS.text};font-size:14px;line-height:1.5;">
         <div style="color:${COLORS.muted};font-size:12px;margin-bottom:4px;">${esc(d.note.label)}</div>${esc(d.note.text.trim())}
       </div>`
    : "";
  const action = d.action ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:${COLORS.text};">${esc(d.action)}</p>` : "";
  const body = `
    ${p(`Olá ${d.recipientName},`)}
    ${d.intro.map(p).join("")}
    ${table}
    ${note}
    ${action}
    ${link ? button(link, d.linkLabel || "Abrir documento") : ""}
    ${link ? `<p style="margin:8px 0 0;font-size:12px;color:${COLORS.muted};">O link é pessoal, expira e só funciona enquanto tiver acesso ao documento.</p>` : ""}`;
  const text = [
    `Olá ${d.recipientName},`,
    ``,
    ...d.intro.flatMap((t) => [t, ``]),
    ...rows.map(([k, v]) => `${k}: ${v}`),
    d.note?.text?.trim() ? `\n${d.note.label}: ${d.note.text.trim()}` : null,
    d.action ? `\n${d.action}` : null,
    link ? `\n${d.linkLabel || "Abrir documento"}: ${link}` : null,
    ``,
    `— ${d.tenantName} (DocID)`,
  ].filter((l) => l !== null).join("\n");
  return {
    subject: cleanSubject(d.subject),
    text,
    html: layout({ preheader: d.intro[0] ?? d.title, tenantName: d.tenantName, badge: d.badge ?? undefined, tone, title: d.title, body }),
  };
}

export function renderEmail(eventType: string, data: Record<string, unknown>): RenderedEmail {
  switch (eventType) {
    case "document_approved": return renderDocumentApproved(data as unknown as DocumentApprovedData);
    case "document_shared": return renderDocumentShared(data as unknown as DocumentSharedData);
    case "test": return renderTestEmail(data as unknown as TestEmailData);
    case "approval_requested":
    case "access_requested":
    case "document_rejected":
    case "password_changed":
    case "role_granted":
    case "device_registered":
    case "identifier_cancelled":
    case "license_alert":
      return renderAttention(data as unknown as AttentionData);
    default: throw new Error(`Template desconhecido: ${eventType}`);
  }
}
