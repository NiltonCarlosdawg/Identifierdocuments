import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  token: string | null;
  user: {
    id: string;
    email: string;
    fullName: string;
    tenantId: string;
    sectorId: string | null;
    roles: string[];
    organization: string | null;
  } | null;
  login: (token: string, user: AuthState["user"]) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: "docid-auth" },
  ),
);
