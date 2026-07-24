export interface StoredUser {
  id: string;
  email: string;
  fullName: string;
  tenantId: string;
  sectorId: string | null;
  sectorName: string | null;
  roles: string[];
  organization: string | null;
}

export interface DecodedUser {
  userId: string;
  tenantId: string;
  sectorId: string | null;
  roles: string[];
}

export function decodeJwtUser(token: string): DecodedUser | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId, tenantId: payload.tenantId, sectorId: payload.sectorId || null, roles: payload.roles || [] };
  } catch { return null; }
}
