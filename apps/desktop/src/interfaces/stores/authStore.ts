import { create } from "zustand";
import { persist } from "zustand/middleware";
import { secureJsonStorage } from "../../infrastructure/storage/SecureStorageAdapter";
import { offlineCache } from "../../infrastructure/storage/OfflineCache";
import type { StoredUser } from "../../domain/entities/User";

async function clearNativeSyncCredentials(): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_sync_credentials");
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
      token: null, user: null,
      login: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => {
        offlineCache.clearAll().catch(() => {});
        offlineCache.clearKey().catch(() => {});
        // O motor de sync nativo guarda o seu próprio token: sem isto continuava a
        // sincronizar com a sessão de quem saiu.
        clearNativeSyncCredentials().catch(() => {});
        set({ token: null, user: null });
      },
    }),
    { name: "docid-auth", storage: secureJsonStorage, partialize: (state) => ({ token: state.token }) },
  ),
);
