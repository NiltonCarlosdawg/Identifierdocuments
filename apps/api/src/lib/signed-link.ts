import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Links de download assinados para os e-mails.
 *
 * O token liga um documento a um destinatário (utilizador) e a um tenant, com prazo.
 * Não dá acesso por si só: no download, o servidor volta a confirmar que o utilizador
 * está activo e continua a ter acesso ao documento (partilha revogada = link morto).
 */
export interface DownloadLinkClaims {
  t: string; // tenant_id
  d: string; // document_id
  u: string; // user_id do destinatário
  e: number; // expiração (segundos Unix)
}

function secret(): Buffer {
  const s = process.env.EMAIL_LINK_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error("EMAIL_LINK_SECRET (ou JWT_SECRET) é obrigatório para assinar links.");
  // Etiqueta de domínio: um token de link nunca serve como JWT nem vice-versa.
  return createHmac("sha256", s).update("docid:email-download-link:v1").digest();
}

function sign(body: string, key = secret()): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function linkTtlSeconds(): number {
  const hours = Number(process.env.EMAIL_LINK_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 72) * 3600;
}

export function createDownloadToken(c: Omit<DownloadLinkClaims, "e">, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const claims: DownloadLinkClaims = { ...c, e: nowSeconds + linkTtlSeconds() };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyDownloadToken(token: string, nowSeconds = Math.floor(Date.now() / 1000)): DownloadLinkClaims | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DownloadLinkClaims;
    if (typeof c.t !== "string" || typeof c.d !== "string" || typeof c.u !== "string" || typeof c.e !== "number") return null;
    if (c.e < nowSeconds) return null;
    return c;
  } catch {
    return null;
  }
}

/** URL pública da API usada nos links dos e-mails. */
export function publicApiUrl(): string {
  return (process.env.PUBLIC_API_URL || "https://didall.milvendas.ao").replace(/\/+$/, "");
}

export function buildDownloadUrl(c: Omit<DownloadLinkClaims, "e">): string {
  return `${publicApiUrl()}/email-links/download?token=${encodeURIComponent(createDownloadToken(c))}`;
}
