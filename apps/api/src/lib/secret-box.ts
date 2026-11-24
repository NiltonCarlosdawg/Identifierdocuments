import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encriptação de segredos em repouso (passwords SMTP, chaves de API de e-mail).
 *
 * AES-256-GCM com a chave EMAIL_SECRETS_KEY (32 bytes em base64, fora da BD).
 * O `context` (o tenant_id) entra como dado autenticado (AAD): um segredo copiado
 * para a linha de outro tenant falha a desencriptação, o que reforça o isolamento.
 *
 * Formato: v1.<iv>.<tag>.<ciphertext> (base64url). O prefixo de versão permite rodar a chave.
 */
const VERSION = "v1";

function loadKey(): Buffer {
  const raw = process.env.EMAIL_SECRETS_KEY;
  if (!raw) throw new Error("EMAIL_SECRETS_KEY não está definida: não é possível guardar credenciais de e-mail.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("EMAIL_SECRETS_KEY tem de ter 32 bytes em base64 (openssl rand -base64 32).");
  return key;
}

export function isSecretBoxConfigured(): boolean {
  try { loadKey(); return true; } catch { return false; }
}

export function encryptSecret(plaintext: string, context: string, key: Buffer = loadKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, context: string, key: Buffer = loadKey()): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error("Segredo em formato desconhecido.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}
