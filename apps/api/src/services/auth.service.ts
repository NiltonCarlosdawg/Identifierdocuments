import { hashPassword, verifyPassword } from "../lib/password";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { users, organizations, userRoles, roles, passwordResetTokens } from "../db/schema";
import { eq, and, gt, isNull, sql } from "drizzle-orm";
import { signToken, verifyTokenWithGrace, getFreshRoles } from "../middleware/auth";
import type { AuthPayload } from "../middleware/auth";
import { enqueueResetPasswordEmail } from "../jobs/queues";
import { randomBytes, createHash } from "node:crypto";

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function login(email: string, password: string, organizationSlug?: string) {
  // Lookup por email via SECURITY DEFINER — o contexto de tenant ainda não existe.
  const emailRows = (await db.execute(sql`SELECT * FROM auth_find_user_by_email(${email})`)) as unknown as Array<{
    id: string; tenant_id: string; email: string; password_hash: string;
  }>;
  let matches = emailRows;

  if (organizationSlug) {
    const orgRows = (await db.execute(sql`SELECT * FROM auth_find_org_by_slug(${organizationSlug})`)) as unknown as Array<{ id: string }>;
    const org = orgRows[0];
    if (!org) throw new Error("Credenciais inválidas.");
    matches = matches.filter((u) => u.tenant_id === org.id);
  }

  // CORREÇÃO: users.email só é único por tenant (ver uniqueIndex composto no
  // schema), não globalmente. Sem organizationSlug, o findFirst anterior podia
  // devolver qualquer uma das contas com o mesmo email em tenants diferentes, de
  // forma não-determinística (a BD não garante ordem sem ORDER BY) — um risco real
  // de login entrar na conta errada quando duas organizações distintas têm
  // utilizadores com o mesmo email. Detectamos esse caso aqui e pedimos ao cliente
  // para especificar a organização, em vez de adivinhar.
  if (matches.length > 1) {
    throw new Error("Este email está associado a mais do que uma organização. Indique a organização para continuar.");
  }
  const rawUser = matches[0];
  if (!rawUser) throw new Error("Credenciais inválidas.");

  const user = await withTenant(rawUser.tenant_id, (tx) =>
    tx.query.users.findFirst({
      where: eq(users.id, rawUser.id),
      with: { organization: true, sector: true, userRoles: { with: { role: true } } },
    }),
  );

  if (!user || !user.isActive) {
    throw new Error("Credenciais inválidas.");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new Error("Credenciais inválidas.");
  }

  const userRolesList = user.userRoles.map((ur) => ur.role.name);
  const payload: AuthPayload = {
    userId: user.id,
    tenantId: user.tenantId,
    sectorId: user.sectorId,
    roles: userRolesList,
  };

  const token = await signToken(payload);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      tenantId: user.tenantId,
      sectorId: user.sectorId,
      sectorName: user.sector?.name ?? null,
      roles: userRolesList,
      organization: user.organization?.name,
    },
  };
}

export async function getMe(auth: AuthPayload) {
  const user = await withTenant(auth.tenantId, (tx) =>
    tx.query.users.findFirst({
      where: eq(users.id, auth.userId),
      with: { organization: true, sector: true },
    }),
  );
  if (!user) return null;
  const roles = await getFreshRoles(auth.userId, auth.tenantId);
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    tenantId: user.tenantId,
    sectorId: user.sectorId,
    sectorName: user.sector?.name ?? null,
    organization: user.organization?.name ?? null,
    organizationSlug: user.organization?.slug ?? null,
    notificationPreferences: user.notificationPreferences,
    roles,
    createdAt: user.createdAt,
  };
}

export async function changePassword(auth: AuthPayload, currentPassword: string, newPassword: string) {
  const user = await withTenant(auth.tenantId, (tx) =>
    tx.query.users.findFirst({ where: eq(users.id, auth.userId) }),
  );
  if (!user) throw new Error("Utilizador não encontrado.");

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw new Error("Password actual incorrecta.");

  const newHash = await hashPassword(newPassword);
  await withTenant(auth.tenantId, (tx) =>
    tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, auth.userId)),
  );
  return { message: "Password alterada com sucesso." };
}

export async function refreshToken(token: string) {
  const payload = await verifyTokenWithGrace(token);
  const user = await withTenant(payload.tenantId, (tx) =>
    tx.query.users.findFirst({
      where: eq(users.id, payload.userId),
      with: { organization: true, sector: true, userRoles: { with: { role: true } } },
    }),
  );
  if (!user || !user.isActive) throw new Error("Utilizador não encontrado ou inactivo.");

  const userRolesList = user.userRoles.map((ur) => ur.role.name);
  const newToken = await signToken({
    userId: user.id,
    tenantId: user.tenantId,
    sectorId: user.sectorId,
    roles: userRolesList,
  });

  return {
    token: newToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      tenantId: user.tenantId,
      sectorId: user.sectorId,
      sectorName: user.sector?.name ?? null,
      roles: userRolesList,
      organization: user.organization?.name ?? null,
    },
  };
}

export async function forgotPassword(email: string, organizationSlug?: string) {
  let user: { id: string; tenant_id: string; email: string; is_active: boolean } | undefined;

  if (organizationSlug) {
    const orgRows = (await db.execute(sql`SELECT * FROM auth_find_org_by_slug(${organizationSlug})`)) as unknown as Array<{ id: string }>;
    const org = orgRows[0];
    if (!org) return { message: "Se o email existir, irá receber um código de redefinição." };
    const emailRows = (await db.execute(sql`SELECT * FROM auth_find_user_by_email(${email})`)) as unknown as Array<{
      id: string; tenant_id: string; email: string; is_active: boolean;
    }>;
    user = emailRows.find((u) => u.tenant_id === org.id);
  } else {
    const emailRows = (await db.execute(sql`SELECT * FROM auth_find_user_by_email(${email})`)) as unknown as Array<{
      id: string; tenant_id: string; email: string; is_active: boolean;
    }>;
    if (emailRows.length > 1) {
      // Resposta uniforme — não revelar ambiguidade de forma explorável
      return { message: "Se o email existir, irá receber um código de redefinição." };
    }
    user = emailRows[0];
  }

  // Resposta uniforme: não revela se o email existe.
  if (!user || !user.is_active) return { message: "Se o email existir, irá receber um código de redefinição." };

  const token = generateResetToken();
  await withTenant(user.tenant_id, async (tx) => {
    await tx.delete(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, user!.id), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({
      userId: user!.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
  });

  await enqueueResetPasswordEmail(user.email, token);

  return { message: "Se o email existir, irá receber um código de redefinição." };
}

export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = hashToken(token);
  const rows = (await db.execute(sql`SELECT * FROM auth_find_reset_token_by_hash(${tokenHash})`)) as unknown as Array<{
    id: string; user_id: string; tenant_id: string;
  }>;
  const rec = rows[0];

  if (!rec) throw new Error("Código inválido ou expirado.");

  const newHash = await hashPassword(newPassword);

  await withTenant(rec.tenant_id, async (tx) => {
    await tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, rec.user_id));
    await tx.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, rec.id));
    await tx.delete(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, rec.user_id), isNull(passwordResetTokens.usedAt)));
  });

  return { message: "Password reposta com sucesso." };
}
