import Elysia from "elysia";
import { jwtVerify } from "jose";
import { SignJWT } from "jose";
import { db, type DB } from "../db";
import { getClientIp } from "../lib/ip";
import { userRoles, roles, users } from "../db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { withTenant } from "../db/withTenant";

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret) throw new Error("JWT_SECRET environment variable is required");
if (process.env.NODE_ENV === "production" && (rawSecret.length < 32 || rawSecret === "change-me-in-production")) {
  throw new Error("JWT_SECRET demasiado fraco para produção: use pelo menos 32 caracteres aleatórios.");
}
const JWT_SECRET = new TextEncoder().encode(rawSecret);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";

/** Duração máxima de uma sessão desde o último login com password. Depois disto a renovação falha. */
const SESSION_MAX_AGE_SECONDS = Math.max(1, Number(process.env.SESSION_MAX_AGE_HOURS) || 168) * 3600;

export interface AuthPayload {
  userId: string;
  tenantId: string;
  sectorId: string | null;
  roles: string[];
  /** Instante (segundos Unix) do último login com password; mantém-se igual nas renovações. */
  authTime?: number;
  /** `iat` do token verificado. Só é preenchido na leitura, nunca enviado em `signToken`. */
  issuedAt?: number;
}

export function sessionExpired(authTime: number | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return typeof authTime !== "number" || nowSeconds - authTime > SESSION_MAX_AGE_SECONDS;
}

export function signToken(payload: AuthPayload): Promise<string> {
  const claims = {
    userId: payload.userId,
    tenantId: payload.tenantId,
    sectorId: payload.sectorId,
    roles: payload.roles,
    authTime: payload.authTime ?? Math.floor(Date.now() / 1000),
  };
  return new SignJWT(claims)
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
  return {
    userId: p.userId,
    tenantId: p.tenantId,
    sectorId: typeof p.sectorId === "string" ? p.sectorId : null,
    roles: p.roles as string[],
    authTime: typeof p.authTime === "number" ? p.authTime : undefined,
    issuedAt: typeof p.iat === "number" ? p.iat : undefined,
  };
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
      const payload = await verifyTokenWithGrace(authHeader.slice(7));
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

export interface ProviderPayload {
  id: string;
  email: string;
}

const PROVIDER_JWT_VERIFY_OPTS = { issuer: "docid-api", audience: "docid-provider" };

export function signProviderToken(payload: ProviderPayload): Promise<string> {
  return new SignJWT({ ...payload, scope: "provider" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("docid-api")
    .setAudience("docid-provider")
    .setExpirationTime("8h")
    .sign(JWT_SECRET);
}

function validateProviderPayload(raw: unknown): ProviderPayload {
  const p = raw as Record<string, unknown>;
  if (p.scope !== "provider" || typeof p.id !== "string" || !p.id || typeof p.email !== "string" || !p.email) {
    throw new Error("Invalid provider token");
  }
  return { id: p.id, email: p.email };
}

const providerMiddleware = new (Elysia as any)()
  .derive({ as: "scoped" }, async (ctx: any): Promise<{ provider: ProviderPayload | null }> => {
    const authHeader = ctx.headers?.authorization;
    if (!authHeader?.startsWith("Bearer ")) return { provider: null };
    try {
      const { payload } = await jwtVerify(authHeader.slice(7), JWT_SECRET, PROVIDER_JWT_VERIFY_OPTS);
      return { provider: validateProviderPayload(payload) };
    } catch (err) {
      console.warn("[AUTH] Provider token verification failed:", err instanceof Error ? err.message : err);
      return { provider: null };
    }
  });

export function requireProvider() {
  return (app: any) => app
    .use(providerMiddleware)
    .guard({
      beforeHandle: (ctx: any) => {
        if (!ctx.provider) {
          ctx.set.status = 401;
          return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } };
        }
      },
    });
}

/** Papéis frescos do utilizador.
 *
 * `executor` permite correr dentro de uma transacção aberta passando o `tx`:
 * usar o `db` de raiz aqui roubaria uma segunda conexão ao pool e, com
 * transacções concorrentes iguais ao `max` do pool, bloqueava em deadlock. */
export async function getFreshRoles(userId: string, tenantId: string, executor?: DB): Promise<string[]> {
  const query = (t: DB) => t
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
  if (executor) return (await query(executor)).map((r) => r.roleName);
  const rows = await withTenant(tenantId, (tx: DB) => query(tx));
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
      const rows = await withTenant(ctx.auth.tenantId, (tx: DB) => tx
        .select({ sectorId: users.sectorId })
        .from(users)
        .where(eq(users.id, ctx.auth!.userId)));
      return { sectorScopeId: rows[0]?.sectorId ?? null };
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
