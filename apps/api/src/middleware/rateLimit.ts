import { Redis } from "ioredis";

const IS_TEST = process.env.NODE_ENV === "test";

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  }
  return redis;
}

export async function checkRateLimit(
  key: string,
  maxAttempts = 5,
  windowMs = 60_000,
): Promise<boolean> {
  if (IS_TEST) return true;

  try {
    const r = getRedis();
    const windowKey = `ratelimit:${key}`;
    const count = await r.incr(windowKey);
    if (count === 1) {
      await r.pexpire(windowKey, windowMs);
    }
    return count <= maxAttempts;
  } catch {
    return true;
  }
}
