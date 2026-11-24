import { getRedis } from "../lib/redis";

const IS_TEST = process.env.NODE_ENV === "test";

/**
 * Reserva em memória para quando o Redis não está disponível. Antes, sem Redis o
 * limite desligava-se por completo (fail-open), o que deixava o login sem protecção
 * contra adivinhação de passwords. Só vale para este processo, mas no cPanel corre
 * uma única instância da API, por isso é suficiente.
 */
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();
const MEMORY_MAX_KEYS = 50_000;
let warnedFallback = false;

function memoryHit(key: string, maxAttempts: number, windowMs: number, now = Date.now()): boolean {
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (memoryBuckets.size >= MEMORY_MAX_KEYS) {
      for (const [k, b] of memoryBuckets) if (b.resetAt <= now) memoryBuckets.delete(k);
      // Ainda cheio: descartar as entradas mais antigas (ordem de inserção do Map).
      while (memoryBuckets.size >= MEMORY_MAX_KEYS) {
        const oldest = memoryBuckets.keys().next().value;
        if (oldest === undefined) break;
        memoryBuckets.delete(oldest);
      }
    }
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return 1 <= maxAttempts;
  }
  bucket.count += 1;
  return bucket.count <= maxAttempts;
}

function warnFallback(err?: unknown) {
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn("[RATELIMIT] Redis indisponível — a usar limite em memória.", err ?? "");
}

export async function checkRateLimit(
  key: string,
  maxAttempts = 5,
  windowMs = 60_000,
): Promise<boolean> {
  if (IS_TEST) return true;

  const windowKey = `ratelimit:${key}`;
  const r = getRedis();
  if (!r) {
    warnFallback();
    return memoryHit(windowKey, maxAttempts, windowMs);
  }

  try {
    const count = await r.incr(windowKey);
    if (count === 1) {
      await r.pexpire(windowKey, windowMs);
    }
    return count <= maxAttempts;
  } catch (err) {
    warnFallback(err);
    return memoryHit(windowKey, maxAttempts, windowMs);
  }
}

/** Só para testes. */
export const __rateLimitInternals = { memoryHit, memoryBuckets };
