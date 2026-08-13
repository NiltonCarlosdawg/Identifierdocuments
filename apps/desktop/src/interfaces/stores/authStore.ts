import { create } from "zustand";
import { persist } from "zustand/middleware";
import { secureJsonStorage } from "../../infrastructure/storage/SecureStorageAdapter";
import { offlineCache } from "../../infrastructure/storage/OfflineCache";
import type { StoredUser } from "../../domain/entities/User";

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
      token: null, user: null,
      login: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => {
        offlineCache.clearAll().catch(() => {});
        offlineCache.clearKey().catch(() => {});
        set({ token: null, user: null });
      },
    }),
    { name: "docid-auth", storage: secureJsonStorage, partialize: (state) => ({ token: state.token }) },
  ),
);
