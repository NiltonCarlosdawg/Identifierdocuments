import type { StoredUser } from "../../domain/entities/User";
export interface LoginRequestDTO { email: string; password: string; }
export interface LoginResponseDTO { data: { token: string; user: StoredUser; }; }
export interface UserResponseDTO { data: { id: string; email: string; fullName: string; isActive: boolean; tenantId: string; sectorId: string | null; sectorName: string | null; organizationName: string | null; roles: string[]; createdAt: string; } | null; }
