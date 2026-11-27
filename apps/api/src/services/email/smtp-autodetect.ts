import { resolveMx } from "node:dns/promises";
import nodemailer from "nodemailer";
import { resolveSafeSmtpHost, SmtpHostError } from "../../lib/smtp-guard";

/**
 * Configuração rápida do e-mail do tenant: a partir de "e-mail + palavra-passe",
 * descobre o servidor SMTP (fornecedor conhecido pelo MX, ou mail./smtp. do domínio)
 * e confirma o login antes de guardar. Assim o administrador não precisa de saber
 * host, porta nem tipo de segurança.
 */

export type SmtpSecurity = "ssl" | "starttls";
export interface SmtpCandidate { host: string; port: number; security: SmtpSecurity; provider?: string }

/** Fornecedores conhecidos, reconhecidos pelo servidor MX do domínio. */
const KNOWN: Array<{ mx: RegExp; provider: string; candidates: SmtpCandidate[]; hint?: string }> = [
  {
    mx: /(google\.com|googlemail\.com)\.?$/i, provider: "Google",
    candidates: [{ host: "smtp.gmail.com", port: 465, security: "ssl" }],
    hint: "No Gmail e no Google Workspace use uma \"palavra-passe de aplicação\" (Conta Google › Segurança › Palavras-passe de aplicações), não a palavra-passe normal.",
  },
  {
    mx: /(outlook\.com|office365\.us)\.?$/i, provider: "Microsoft 365",
    candidates: [{ host: "smtp.office365.com", port: 587, security: "starttls" }],
    // Sem números nem siglas: o desktop troca mensagens "técnicas" por uma genérica (mapError).
    hint: "Nas contas Microsoft da empresa, o envio autenticado tem de estar activo para esta caixa (centro de administração › Utilizadores › Correio › Aplicações de e-mail).",
  },
  {
    mx: /zoho\.(com|eu|in)\.?$/i, provider: "Zoho",
    candidates: [{ host: "smtp.zoho.com", port: 465, security: "ssl" }, { host: "smtp.zoho.eu", port: 465, security: "ssl" }],
  },
];

const KNOWN_DOMAINS: Record<string, string> = {
  "gmail.com": "Google", "googlemail.com": "Google",
  "outlook.com": "Microsoft 365", "hotmail.com": "Microsoft 365", "live.com": "Microsoft 365",
};

export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
}

/** Lista ordenada de servidores a experimentar (função pura, testável). */
export function candidateServers(domain: string, mxHosts: string[]): { provider: string | null; hint: string | null; candidates: SmtpCandidate[] } {
  const known = KNOWN.find((k) => mxHosts.some((mx) => k.mx.test(mx)))
    ?? KNOWN.find((k) => k.provider === KNOWN_DOMAINS[domain]);
  if (known) return { provider: known.provider, hint: known.hint ?? null, candidates: known.candidates.map((c) => ({ ...c, provider: known.provider })) };

  // Alojamento próprio (cPanel, Plesk...): normalmente mail.<domínio>, com SSL na 465 ou STARTTLS na 587.
  const hosts = [`mail.${domain}`, `smtp.${domain}`, ...mxHosts.slice(0, 2).map((h) => h.replace(/\.$/, "").toLowerCase())];
  const seen = new Set<string>();
  const candidates: SmtpCandidate[] = [];
  for (const host of hosts) {
    if (seen.has(host)) continue;
    seen.add(host);
    candidates.push({ host, port: 465, security: "ssl" }, { host, port: 587, security: "starttls" });
  }
  return { provider: null, hint: null, candidates };
}

export type DetectResult =
  | { ok: true; host: string; port: number; security: SmtpSecurity; provider: string | null }
  | { ok: false; reason: "AUTH_FAILED" | "NOT_FOUND"; message: string; hint: string | null };

type Verify = (c: SmtpCandidate, user: string, pass: string) => Promise<void>;

/** Liga e autentica, sem enviar nada. Lança o erro do nodemailer (com `responseCode` em 5xx/4xx). */
const verifyLogin: Verify = async (c, user, pass) => {
  const connectHost = await resolveSafeSmtpHost(c.host, c.port); // SSRF: só IPs públicos e portas SMTP
  const transporter = nodemailer.createTransport({
    host: connectHost, port: c.port, secure: c.security === "ssl", requireTLS: c.security === "starttls",
    auth: { user, pass }, tls: { servername: c.host }, name: c.host,
    connectionTimeout: 6_000, greetingTimeout: 6_000, socketTimeout: 10_000,
  });
  try { await transporter.verify(); } finally { transporter.close(); }
};

const isAuthError = (err: any) => err?.code === "EAUTH" || [534, 535].includes(Number(err?.responseCode));

export async function detectSmtp(email: string, password: string, opts: { verify?: Verify; mx?: (d: string) => Promise<string[]> } = {}): Promise<DetectResult> {
  const domain = domainOf(email);
  const lookupMx = opts.mx ?? (async (d: string) => (await resolveMx(d)).sort((a, b) => a.priority - b.priority).map((m) => m.exchange));
  const mx = await lookupMx(domain).catch(() => [] as string[]);
  const { provider, hint, candidates } = candidateServers(domain, mx);
  const verify = opts.verify ?? verifyLogin;

  for (const c of candidates) {
    try {
      await verify(c, email, password);
      return { ok: true, host: c.host, port: c.port, security: c.security, provider };
    } catch (err: any) {
      // O servidor existe e recusou o login: é este o servidor, a palavra-passe é que está errada.
      // Parar aqui evita mais tentativas de login (e bloqueios da conta).
      if (isAuthError(err)) {
        return {
          ok: false, reason: "AUTH_FAILED", hint,
          // Sem o nome do servidor: "smtp.…" seria escondido pelo filtro de termos técnicos do desktop.
          message: "O servidor de e-mail recusou o e-mail ou a palavra-passe. Confirme a palavra-passe da caixa.",
        };
      }
      if (err instanceof SmtpHostError) continue;
      // Sem resposta / porta fechada / sem DNS: experimentar o próximo.
    }
  }
  return {
    ok: false, reason: "NOT_FOUND", hint,
    message: `Não encontrámos o servidor de envio de ${domain}. Use a configuração manual com os dados do seu fornecedor de e-mail.`,
  };
}
