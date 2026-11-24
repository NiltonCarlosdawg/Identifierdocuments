export function isIPv4(s: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
}

export function isIPv6(s: string): boolean {
  // very permissive IPv6 check (hex and colons), avoids heavy validation libs
  return /^[0-9a-fA-F:]+$/.test(s) && s.includes(":");
}

const isIp = (s: string) => isIPv4(s) || isIPv6(s);

/** Número de proxies de confiança à frente da API (LiteSpeed do cPanel = 1).
 *  A API só escuta em 127.0.0.1, por isso há sempre um proxy; 0 desliga a leitura dos cabeçalhos. */
function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  const n = raw === undefined || raw === "" ? 1 : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/**
 * IP real do cliente.
 *
 * O primeiro valor do X-Forwarded-For é escrito pelo próprio cliente e pode ser
 * falsificado; cada proxy acrescenta o IP que viu no FIM da lista. Por isso, com N
 * proxies de confiança, o IP fiável é o N-ésimo a contar do fim.
 */
export function getClientIp(request: Request, hops = trustedProxyHops()): string {
  if (hops === 0) return "unknown";
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const candidate = parts[parts.length - hops];
    if (candidate && isIp(candidate)) return candidate;
    return "unknown";
  }
  // Sem X-Forwarded-For: só aceitar X-Real-IP quando há exactamente um proxy, que o define.
  const xr = request.headers.get("x-real-ip")?.trim();
  if (hops === 1 && xr && isIp(xr)) return xr;
  return "unknown";
}
