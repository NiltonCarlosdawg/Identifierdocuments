import { describe, it, expect, beforeAll } from "bun:test";

process.env.JWT_SECRET ??= "test-secret-com-pelo-menos-32-caracteres!!";

let auth: typeof import("../middleware/auth");
let ip: typeof import("../lib/ip");
let rl: typeof import("../middleware/rateLimit");

beforeAll(async () => {
  auth = await import("../middleware/auth");
  ip = await import("../lib/ip");
  rl = await import("../middleware/rateLimit");
});

const req = (headers: Record<string, string>) => new Request("http://localhost/", { headers });

describe("getClientIp (proxy de confiança)", () => {
  it("ignora o IP falsificado pelo cliente no início do X-Forwarded-For", () => {
    expect(ip.getClientIp(req({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), 1)).toBe("9.9.9.9");
  });
  it("com um único valor usa esse valor", () => {
    expect(ip.getClientIp(req({ "x-forwarded-for": "9.9.9.9" }), 1)).toBe("9.9.9.9");
  });
  it("com 2 proxies usa o penúltimo", () => {
    expect(ip.getClientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 10.0.0.1" }), 2)).toBe("2.2.2.2");
  });
  it("valor inválido devolve unknown", () => {
    expect(ip.getClientIp(req({ "x-forwarded-for": "lixo" }), 1)).toBe("unknown");
  });
  it("hops=0 ignora cabeçalhos", () => {
    expect(ip.getClientIp(req({ "x-forwarded-for": "9.9.9.9" }), 0)).toBe("unknown");
  });
  it("X-Real-IP só sem X-Forwarded-For", () => {
    expect(ip.getClientIp(req({ "x-real-ip": "8.8.8.8" }), 1)).toBe("8.8.8.8");
  });
});

describe("rate limit em memória (Redis indisponível)", () => {
  it("bloqueia depois do máximo e reabre no fim da janela", () => {
    const { memoryHit, memoryBuckets } = rl.__rateLimitInternals;
    memoryBuckets.clear();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(memoryHit("k", 3, 1000, t0)).toBe(true);
    expect(memoryHit("k", 3, 1000, t0 + 10)).toBe(false);
    expect(memoryHit("k", 3, 1000, t0 + 1001)).toBe(true);
  });
});

describe("sessões", () => {
  it("sessão sem authTime (token antigo) não renova", () => {
    expect(auth.sessionExpired(undefined)).toBe(true);
  });
  it("sessão recente é válida e sessão com mais de 7 dias expira", () => {
    const now = 2_000_000_000;
    expect(auth.sessionExpired(now - 3600, now)).toBe(false);
    expect(auth.sessionExpired(now - 8 * 24 * 3600, now)).toBe(true);
  });
  it("o token transporta authTime e iat, e authTime mantém-se na renovação", async () => {
    const authTime = Math.floor(Date.now() / 1000) - 100;
    const token = await auth.signToken({ userId: "u", tenantId: "t", sectorId: null, roles: [], authTime });
    const p = await auth.verifyToken(token);
    expect(p.authTime).toBe(authTime);
    expect(typeof p.issuedAt).toBe("number");
    const renewed = await auth.verifyToken(await auth.signToken(p));
    expect(renewed.authTime).toBe(authTime);
  });
});
