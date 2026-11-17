// Abstração mínima para as hashes de password: Bun.password em runtime Bun,
// bcryptjs em runtime Node (mesmo formato $2b$ — verificável em ambos).

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export async function hashPassword(plain: string): Promise<string> {
  if (isBun) {
    return (globalThis as unknown as { Bun: { password: { hash: (pw: string) => Promise<string> } } }).Bun.password.hash(plain);
  }
  const bcrypt = (await import("bcryptjs")).default;
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (isBun) {
    return (globalThis as unknown as { Bun: { password: { verify: (pw: string, h: string) => Promise<boolean> } } }).Bun.password.verify(plain, hash);
  }
  const bcrypt = (await import("bcryptjs")).default;
  return bcrypt.compare(plain, hash);
}
