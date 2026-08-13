import { getRedis } from "../lib/redis";

const IS_TEST = process.env.NODE_ENV === "test";

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
