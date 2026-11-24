import nodemailer from "nodemailer";
import type { RenderedEmail } from "./templates";

/** Configuração de envio já resolvida (tenant ou plataforma), com o segredo em claro só em memória. */
export interface ResolvedSender {
  source: "tenant" | "platform";
  provider: "smtp" | "resend" | "sendgrid";
  fromEmail: string;
  fromName: string;
  replyTo?: string | null;
  smtp?: {
    host: string; // nome original (usado no SNI/verificação TLS)
    connectHost: string; // IP já validado contra SSRF
    port: number;
    /** "auto": STARTTLS só se o servidor o oferecer (comportamento do mailer da plataforma). */
    security: "ssl" | "starttls" | "none" | "auto";
    user?: string | null;
    pass?: string | null;
  };
  apiKey?: string | null;
}

export interface OutgoingEmail extends RenderedEmail {
  to: string;
}

/** `permanent = true`: não vale a pena repetir (credenciais erradas, destinatário rejeitado...). */
export class EmailSendError extends Error {
  constructor(message: string, readonly permanent: boolean) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;

export function isValidEmail(s: string | null | undefined): s is string {
  return typeof s === "string" && s.length <= 254 && EMAIL_RE.test(s);
}

/** Nome de remetente seguro para cabeçalhos: sem quebras de linha nem aspas. */
export function cleanDisplayName(s: string): string {
  return s.replace(/[\r\n"<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function formatAddress(name: string, email: string): string {
  const n = cleanDisplayName(name);
  return n ? `"${n}" <${email}>` : email;
}

function classifyHttp(status: number, body: string, provider: string): EmailSendError {
  const transient = status === 429 || status >= 500;
  return new EmailSendError(`${provider} respondeu ${status}: ${body.slice(0, 300)}`, !transient);
}

async function sendSmtp(s: ResolvedSender, m: OutgoingEmail): Promise<string | null> {
  const c = s.smtp!;
  const transporter = nodemailer.createTransport({
    host: c.connectHost,
    port: c.port,
    secure: c.security === "ssl",
    requireTLS: c.security === "starttls",
    ignoreTLS: c.security === "none",
    auth: c.user ? { user: c.user, pass: c.pass ?? "" } : undefined,
    tls: { servername: c.host },
    name: c.host,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    const info = await transporter.sendMail({
      from: { name: cleanDisplayName(s.fromName), address: s.fromEmail },
      to: m.to,
      replyTo: s.replyTo || undefined,
      subject: m.subject,
      text: m.text,
      html: m.html,
    });
    return info.messageId ?? null;
  } catch (err: any) {
    const code = Number(err?.responseCode);
    // 5xx do servidor SMTP = rejeição definitiva (auth falhada, destinatário inexistente, etc.)
    const permanent = Number.isFinite(code) && code >= 500 && code < 600;
    throw new EmailSendError(`SMTP: ${err?.message ?? err}`, permanent);
  } finally {
    transporter.close();
  }
}

async function sendResend(s: ResolvedSender, m: OutgoingEmail): Promise<string | null> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${s.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: formatAddress(s.fromName, s.fromEmail),
      to: [m.to],
      subject: m.subject,
      html: m.html,
      text: m.text,
      ...(s.replyTo ? { reply_to: s.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => { throw new EmailSendError(`Resend: ${err?.message ?? err}`, false); });
  const body = await res.text();
  if (!res.ok) throw classifyHttp(res.status, body, "Resend");
  try { return (JSON.parse(body) as { id?: string }).id ?? null; } catch { return null; }
}

async function sendSendgrid(s: ResolvedSender, m: OutgoingEmail): Promise<string | null> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${s.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: m.to }] }],
      from: { email: s.fromEmail, name: cleanDisplayName(s.fromName) },
      ...(s.replyTo ? { reply_to: { email: s.replyTo } } : {}),
      subject: m.subject,
      content: [{ type: "text/plain", value: m.text }, { type: "text/html", value: m.html }],
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => { throw new EmailSendError(`SendGrid: ${err?.message ?? err}`, false); });
  if (!res.ok) throw classifyHttp(res.status, await res.text(), "SendGrid");
  return res.headers.get("x-message-id");
}

/** Envia um e-mail com a configuração indicada. Devolve o message-id do fornecedor, se houver. */
export async function sendEmail(sender: ResolvedSender, message: OutgoingEmail): Promise<string | null> {
  if (!isValidEmail(message.to)) throw new EmailSendError(`Destinatário inválido: ${message.to}`, true);
  switch (sender.provider) {
    case "smtp": return sendSmtp(sender, message);
    case "resend": return sendResend(sender, message);
    case "sendgrid": return sendSendgrid(sender, message);
  }
}
