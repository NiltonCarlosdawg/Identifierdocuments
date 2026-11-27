import { Redis } from "ioredis";

const IS_TEST = process.env.NODE_ENV === "test";

/**
 * Sem um listener de "error", o ioredis escreve "Unhandled error event" com o stack
 * completo a cada tentativa de ligação. Com o Redis em baixo isso encheu o
 * docid-api.log de produção (750 MB). Regista no máximo uma linha a cada 5 minutos.
 */
export function quietRedisErrors(client: Redis, label: string, everyMs = 5 * 60_000): Redis {
  let last = 0;
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - last < everyMs) return;
    last = now;
    console.warn(`[${label}] Redis indisponível: ${err?.message || (err as any)?.code || err}`);
  });
  return client;
}

let redis: Redis | null = null;
let redisUnavailable = false;

export function getRedis(): Redis | null {
  if (IS_TEST) return null;
  if (!redis && !redisUnavailable) {
    try {
      const password = process.env.REDIS_PASSWORD;
      redis = quietRedisErrors(new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        lazyConnect: true,
        ...(password ? { password } : {}),
      }), "REDIS");
      redis.connect().catch((err) => {
        console.warn("[REDIS] Ligação falhou — cache/rate-limit desactivados:", (err as Error)?.message ?? err);
        redis = null;
        redisUnavailable = true;
      });
    } catch (err) {
      console.warn("[REDIS] Ligação falhou — cache/rate-limit desactivados:", (err as Error)?.message ?? err);
      redisUnavailable = true;
    }
  }
  return redis;
}

export async function cacheGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get(key);
  } catch (err) {
    console.warn("[REDIS] cacheGet falhou:", err);
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, value, "EX", ttlSeconds);
  } catch (err) {
    console.warn("[REDIS] cacheSet falhou:", err);
  }
}
