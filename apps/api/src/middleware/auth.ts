import Elysia from "elysia";
import { jwtVerify } from "jose";
import { SignJWT } from "jose";
import { db } from "../db";
import { getClientIp } from "../lib/ip";
import { userRoles, roles, users } from "../db/schema";
import { eq, and, or, isNull } from "drizzle-orm";

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

export const authMiddleware = new (Elysia as any)()
  .derive({ as: "global" }, async (ctx: any): Promise<{ auth: AuthPayload | null; clientIp: string }> => {
    const { request, headers } = ctx;
    const clientIp = getClientIp(request);

    const authHeader = headers?.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return { auth: null, clientIp };
    }
    try {
      const payload = await verifyToken(authHeader.slice(7));
      return { auth: payload, clientIp };
    } catch (err) {
      console.warn("[AUTH] Token verification failed:", err instanceof Error ? err.message : err);
      return { auth: null, clientIp };
    }
  });

export function requireAuth() {
  return (app: any) => app
    .guard({
      beforeHandle: (ctx: any) => {
        if (!ctx.auth) {
          ctx.set.status = 401;
          return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } };
        }
      },
    });
}

export async function getFreshRoles(userId: string, tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(
      eq(userRoles.userId, userId),
      or(
        eq(roles.tenantId, tenantId),
        isNull(roles.tenantId), // roles de sistema (tenantId null) aplicam-se a todas as organizações
      ),
    ));
  return rows.map((r) => r.roleName);
}

export function requireRole(...requiredRoles: string[]) {
  return (app: any) => app
    .guard({
      beforeHandle: async (ctx: any) => {
        if (!ctx.auth) {
          ctx.set.status = 401;
          return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } };
        }
        const roleNames = await getFreshRoles(ctx.auth.userId, ctx.auth.tenantId);
        if (!requiredRoles.some((r) => roleNames.includes(r))) {
          ctx.set.status = 403;
          return { error: { code: "FORBIDDEN", message: "Permissão insuficiente." } };
        }
      },
    });
}

/** Garante que o utilizador autenticado tem um sector atribuído.
 *
 * - `derive`: busca o sector do utilizador (PK lookup, sem risco cross-tenant)
 *   e expõe `sectorScopeId` no contexto para os handlers consumirem.
 *   Usa `db` directamente (não `withTenant`) porque os hooks Elysia correm
 *   antes do handler e não têm acesso à transacção — seguro porque a query
 *   é `WHERE users.id = ?` (PK única, sem leak entre tenants).
 * - `guard`: nega 401 sem auth, 403 sem sector.
 *
 * Opcionalmente aceita `bypassRoles` — array de nomes de role que passam
 * o guard mesmo sem `sectorId` (ex.: `requireSectorScope({ bypassRoles: ["ORG_ADMIN"] })`). */
export function requireSectorScope(opts?: { bypassRoles?: string[] }) {
  return (app: any) => app
    .derive({ as: "scoped" }, async (ctx: any) => {
      if (!ctx.auth) return {};
      const [user] = await db
        .select({ sectorId: users.sectorId })
        .from(users)
        .where(eq(users.id, ctx.auth.userId));
      return { sectorScopeId: user?.sectorId ?? null };
    })
    .guard({
      beforeHandle: async (ctx: any) => {
        if (!ctx.auth) {
          ctx.set.status = 401;
          return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } };
        }
        if (opts?.bypassRoles?.length) {
          const roleNames = await getFreshRoles(ctx.auth.userId, ctx.auth.tenantId);
          if (opts.bypassRoles.some((r) => roleNames.includes(r))) return;
        }
        if (!ctx.sectorScopeId) {
          ctx.set.status = 403;
          return { error: { code: "FORBIDDEN", message: "Utilizador sem sector atribuído." } };
        }
      },
    });
}
