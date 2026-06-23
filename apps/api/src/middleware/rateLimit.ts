const attempts = new Map<string, { count: number; resetAt: number }>();

const IS_TEST = process.env.NODE_ENV === "test";
const DEFAULT_MAX = IS_TEST ? 1000 : (Number(process.env.RATE_LIMIT_MAX) || 5);

export function checkRateLimit(
  key: string,
  maxAttempts = DEFAULT_MAX,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxAttempts) return false;

  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(key);
  }
}, 300_000);
