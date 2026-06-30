import { create } from "zustand";
import { persist } from "zustand/middleware";
import { secureJsonStorage } from "../lib/secure-storage";

export interface StoredUser {
  id: string;
  email: string;
  fullName: string;
  tenantId: string;
  sectorId: string | null;
  roles: string[];
  organization: string | null;
}

export function decodeJwtUser(token: string): { userId: string; tenantId: string; sectorId: string | null; roles: string[] } | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId, tenantId: payload.tenantId, sectorId: payload.sectorId || null, roles: payload.roles || [] };
  } catch {
    return null;
  }
}

interface AuthState {
  token: string | null;
  user: StoredUser | null;
  login: (token: string, user: StoredUser) => void;
  setUser: (user: StoredUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    {
      name: "docid-auth",
      storage: secureJsonStorage,
      partialize: (state) => ({ token: state.token }),
    },
  ),
);
