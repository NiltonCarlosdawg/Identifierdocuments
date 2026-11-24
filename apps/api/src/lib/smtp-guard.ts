import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Protecção contra SSRF: o SMTP é configurado por cada tenant, por isso um admin de
 * tenant podia apontar o host para 127.0.0.1:6379 (Redis) ou para a rede interna do
 * servidor. Só aceitamos portas SMTP conhecidas e endereços públicos, e devolvemos o IP
 * resolvido para o transporte ligar a esse IP (evita DNS rebinding entre validar e ligar).
 */
export const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.some(([b, n]) => inCidr(ip, b, n));
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9")
    || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

export class SmtpHostError extends Error {}

/** Valida host/porta e devolve o IP público a usar na ligação. */
export async function resolveSafeSmtpHost(host: string, port: number): Promise<string> {
  if (!ALLOWED_SMTP_PORTS.includes(port)) {
    throw new SmtpHostError(`Porta SMTP não permitida (${port}). Use ${ALLOWED_SMTP_PORTS.join(", ")}.`);
  }
  if (process.env.EMAIL_ALLOW_PRIVATE_SMTP === "true") return host; // só para desenvolvimento (ex.: MailHog)
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0) throw new SmtpHostError("Host SMTP não resolve.");
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new SmtpHostError("O host SMTP aponta para um endereço interno ou reservado.");
  }
  return addresses[0].address;
}
