import { Elysia } from "elysia";
import { jwtVerify } from "jose";
import { SignJWT } from "jose";
import { db } from "../db";
import { userRoles, roles } from "../db/schema";
import { eq, and } from "drizzle-orm";

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret) throw new Error("JWT_SECRET environment variable is required");
const JWT_SECRET = new TextEncoder().encode(rawSecret);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";

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
    .setIssuer("docid-api")
    .setAudience("docid-desktop")
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(JWT_SECRET);
}

function validateAuthPayload(raw: unknown): AuthPayload {
  const p = raw as Record<string, unknown>;
  if (typeof p.userId !== "string" || !p.userId) throw new Error("Invalid token: missing userId");
  if (typeof p.tenantId !== "string" || !p.tenantId) throw new Error("Invalid token: missing tenantId");
  if (!Array.isArray(p.roles)) throw new Error("Invalid token: missing roles");
  return { userId: p.userId, tenantId: p.tenantId, sectorId: typeof p.sectorId === "string" ? p.sectorId : null, roles: p.roles as string[] };
}

const JWT_VERIFY_OPTS = { issuer: "docid-api", audience: "docid-desktop" };

export function verifyToken(token: string): Promise<AuthPayload> {
  return jwtVerify(token, JWT_SECRET, JWT_VERIFY_OPTS).then(({ payload }) => validateAuthPayload(payload));
}

export function verifyTokenWithGrace(token: string, graceSeconds = 60): Promise<AuthPayload> {
  return jwtVerify(token, JWT_SECRET, { ...JWT_VERIFY_OPTS, clockTolerance: `${graceSeconds}s` })
    .then(({ payload }) => validateAuthPayload(payload));
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
    } catch (err) {
      console.warn("[AUTH] Token verification failed:", err instanceof Error ? err.message : err);
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

export function requireRole(...requiredRoles: string[]) {
  return (app: Elysia) => app
    .guard({
      beforeHandle: async (ctx: any) => {
        if (!ctx.auth) {
          ctx.set.status = 401;
          return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } };
        }
        const currentRoles = await db
          .select({ roleName: roles.name })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .where(and(
            eq(userRoles.userId, ctx.auth.userId),
            eq(roles.tenantId, ctx.auth.tenantId),
          ));
        const roleNames = currentRoles.map((r) => r.roleName);
        if (!requiredRoles.some((r) => roleNames.includes(r))) {
          ctx.set.status = 403;
          return { error: { code: "FORBIDDEN", message: "Permissão insuficiente." } };
        }
      },
    });
}
