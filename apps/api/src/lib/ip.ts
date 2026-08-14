export function isIPv4(s: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
}

export function isIPv6(s: string): boolean {
  // very permissive IPv6 check (hex and colons), avoids heavy validation libs
  return /^[0-9a-fA-F:]+$/.test(s) && s.includes(":");
}

export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (isIPv4(first) || isIPv6(first)) return first;
  }
  const xr = request.headers.get("x-real-ip");
  if (xr && (isIPv4(xr) || isIPv6(xr))) return xr;
  return "unknown";
}
