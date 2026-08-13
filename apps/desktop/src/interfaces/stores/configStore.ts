import { create } from "zustand";
import { persist } from "zustand/middleware";
import { tauriJsonStorage } from "../../infrastructure/storage/TauriStorageAdapter";
import { DEFAULT_API_URL } from "../../shared/constants";

type Theme = "light" | "dark";

interface AppConfigState {
  apiBaseUrl: string;
  theme: Theme;
  avatar: string | null;
  defaultScanner: string | null;
  defaultPrinter: string | null;
  notificationPrefs: Record<string, boolean>;
  setApiBaseUrl: (url: string) => void;
  resetApiBaseUrl: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setAvatar: (avatar: string | null) => void;
  setDefaultScanner: (name: string | null) => void;
  setDefaultPrinter: (name: string | null) => void;
  setNotificationPrefs: (prefs: Record<string, boolean>) => void;
  patchNotificationPref: (key: string, value: boolean) => void;
}

export const useAppConfigStore = create<AppConfigState>()(
  persist(
    (set, get) => ({
      apiBaseUrl: DEFAULT_API_URL, theme: "dark", avatar: null, defaultScanner: null, defaultPrinter: null,
      notificationPrefs: {},
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
      setDefaultScanner: (name) => set({ defaultScanner: name }),
      setDefaultPrinter: (name) => set({ defaultPrinter: name }),
      setNotificationPrefs: (prefs) => set({ notificationPrefs: prefs ?? {} }),
      patchNotificationPref: (key, value) => set({ notificationPrefs: { ...get().notificationPrefs, [key]: value } }),
    }),
    { name: "docid-config", storage: tauriJsonStorage },
  ),
);
