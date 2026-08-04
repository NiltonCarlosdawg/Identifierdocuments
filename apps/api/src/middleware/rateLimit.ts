import { Redis } from "ioredis";

const IS_TEST = process.env.NODE_ENV === "test";

let redis: Redis | null = null;
let redisUnavailable = false;

function getRedis(): Redis | null {
  if (!redis && !redisUnavailable) {
    try {
      redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        lazyConnect: true,
      });
      redis.connect().catch((err) => {
        console.warn("[RATELIMIT] Redis connection failed — rate limiting disabled:", (err as Error)?.message ?? err);
        redis = null;
        redisUnavailable = true;
      });
    } catch (err) {
      console.warn("[RATELIMIT] Redis connection failed — rate limiting disabled:", (err as Error)?.message ?? err);
      redisUnavailable = true;
    }
  }
  return redis;
}

export async function checkRateLimit(
  key: string,
  maxAttempts = 5,
  windowMs = 60_000,
): Promise<boolean> {
  if (IS_TEST) return true;

  const r = getRedis();
  if (!r) return true;

  try {
    const windowKey = `ratelimit:${key}`;
    const count = await r.incr(windowKey);
    if (count === 1) {
      await r.pexpire(windowKey, windowMs);
    }
    return count <= maxAttempts;
  } catch (err) {
    console.warn("[RATELIMIT] Redis failure — rate limiting disabled:", err);
    return true;
  }
}
