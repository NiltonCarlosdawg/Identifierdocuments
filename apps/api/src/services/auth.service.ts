import { db } from "../db";
import { users, organizations, userRoles, roles } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { signToken, verifyTokenWithGrace } from "../middleware/auth";
import type { AuthPayload } from "../middleware/auth";

export async function login(email: string, password: string, organizationSlug?: string) {
  let whereCondition: any = eq(users.email, email);

  if (organizationSlug) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.slug, organizationSlug),
    });
    if (!org) throw new Error("Organização não encontrada.");
    whereCondition = and(eq(users.email, email), eq(users.tenantId, org.id));
  }

  const user = await db.query.users.findFirst({
    where: whereCondition,
    with: { organization: true, userRoles: { with: { role: true } } },
  });

  if (!user || !user.isActive) {
    throw new Error("Credenciais inválidas.");
  }

  const valid = await Bun.password.verify(password, user.passwordHash);
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
      roles: userRolesList,
      organization: user.organization?.name,
    },
  };
}

export async function getMe(auth: AuthPayload) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, auth.userId),
    with: { organization: true, sector: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    tenantId: user.tenantId,
    sectorId: user.sectorId,
    sectorName: user.sector?.name ?? null,
    organizationName: user.organization?.name ?? null,
    organizationSlug: user.organization?.slug ?? null,
    roles: auth.roles,
    createdAt: user.createdAt,
  };
}

export async function changePassword(auth: AuthPayload, currentPassword: string, newPassword: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, auth.userId) });
  if (!user) throw new Error("Utilizador não encontrado.");

  const valid = await Bun.password.verify(currentPassword, user.passwordHash);
  if (!valid) throw new Error("Password actual incorrecta.");

  const newHash = await Bun.password.hash(newPassword);
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, auth.userId));
  return { message: "Password alterada com sucesso." };
}

export async function refreshToken(token: string) {
  const payload = await verifyTokenWithGrace(token);
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
    with: { userRoles: { with: { role: true } } },
  });
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
      roles: userRolesList,
      organization: null,
    },
  };
}
