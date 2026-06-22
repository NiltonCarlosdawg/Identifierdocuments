import { Elysia } from "elysia";
import { jwtVerify } from "jose";
import { SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export interface AuthPayload {
  userId: string;
  tenantId: string;
  sectorId: string | null;
  roles: string[];
}

export function signToken(payload: AuthPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(JWT_SECRET);
}

export function verifyToken(token: string): Promise<AuthPayload> {
  return jwtVerify(token, JWT_SECRET).then(({ payload }) => payload as unknown as AuthPayload);
}

export function verifyTokenWithGrace(token: string, graceSeconds = 86400): Promise<AuthPayload> {
  return jwtVerify(token, JWT_SECRET, { clockTolerance: `${graceSeconds}s` })
    .then(({ payload }) => payload as unknown as AuthPayload);
}

export const authMiddleware = new Elysia()
  .derive({ as: "global" }, async ({ headers }): Promise<{ auth: AuthPayload | null }> => {
    const authHeader = headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return { auth: null };
    }
    try {
      const payload = await verifyToken(authHeader.slice(7));
      return { auth: payload };
    } catch {
      return { auth: null };
    }
  });

export function requireAuth() {
  return (app: Elysia) => app
    .guard({
      beforeHandle: (ctx: any) => {
        if (!ctx.auth) {
          ctx.set.status = 401;
          return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } };
        }
      },
    });
}

export function requireRole(...roles: string[]) {
  return (app: Elysia) => app
    .guard({
      beforeHandle: (ctx: any) => {
        if (!ctx.auth) {
          ctx.set.status = 401;
          return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } };
        }
        if (!roles.some((r) => ctx.auth.roles.includes(r))) {
          ctx.set.status = 403;
          return { error: { code: "FORBIDDEN", message: "Permissão insuficiente." } };
        }
      },
    });
}
