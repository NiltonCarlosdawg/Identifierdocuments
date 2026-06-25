import { create } from "zustand";
import { persist } from "zustand/middleware";
import { tauriJsonStorage } from "../lib/tauri-storage";

const DEFAULT_API_URL = "http://localhost:3000";

type Theme = "light" | "dark";

interface AppConfigState {
  apiBaseUrl: string;
  theme: Theme;
  avatar: string | null;
  setApiBaseUrl: (url: string) => void;
  resetApiBaseUrl: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setAvatar: (avatar: string | null) => void;
}

export const useAppConfigStore = create<AppConfigState>()(
  persist(
    (set, get) => ({
      apiBaseUrl: DEFAULT_API_URL,
      theme: "dark",
      avatar: null,
      setApiBaseUrl: (url) => set({ apiBaseUrl: url.trim().replace(/\/$/, "") }),
      resetApiBaseUrl: () => set({ apiBaseUrl: DEFAULT_API_URL }),
      setTheme: (theme) => {
        set({ theme });
        if (theme === "dark") {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      },
      toggleTheme: () => {
        const next = get().theme === "dark" ? "light" : "dark";
        get().setTheme(next);
      },
      setAvatar: (avatar) => set({ avatar }),
    }),
    { name: "docid-config", storage: tauriJsonStorage },
  ),
);
