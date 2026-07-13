import { create } from "zustand";
import { persist } from "zustand/middleware";
import { tauriJsonStorage } from "../../infrastructure/storage/TauriStorageAdapter";
import { DEFAULT_API_URL } from "../../shared/constants";

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
      apiBaseUrl: DEFAULT_API_URL, theme: "dark", avatar: null,
      setApiBaseUrl: (url) => {
        const clean = url.trim().replace(/\/$/, "");
        if (!clean.startsWith("http://") && !clean.startsWith("https://")) return;
        if (clean.startsWith("http://") && !clean.includes("localhost") && !clean.includes("127.0.0.1")) return;
        set({ apiBaseUrl: clean });
      },
      resetApiBaseUrl: () => set({ apiBaseUrl: DEFAULT_API_URL }),
      setTheme: (theme) => { set({ theme }); document.documentElement.classList.toggle("dark", theme === "dark"); },
      toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
      setAvatar: (avatar) => set({ avatar }),
    }),
    { name: "docid-config", storage: tauriJsonStorage },
  ),
);
