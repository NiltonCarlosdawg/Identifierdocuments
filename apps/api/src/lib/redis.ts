import { Redis } from "ioredis";

const IS_TEST = process.env.NODE_ENV === "test";

let redis: Redis | null = null;
let redisUnavailable = false;

export function getRedis(): Redis | null {
  if (IS_TEST) return null;
  if (!redis && !redisUnavailable) {
    try {
      const password = process.env.REDIS_PASSWORD;
      redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        lazyConnect: true,
        ...(password ? { password } : {}),
      });
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
