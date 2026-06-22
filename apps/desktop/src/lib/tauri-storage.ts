import { type StateStorage, createJSONStorage } from "zustand/middleware";

const STORE_NAME = "docid-auth";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getTauriStore() {
  const { load } = await import("@tauri-apps/plugin-store");
  return load(STORE_NAME);
}

const tauriStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (!isTauri()) return localStorage.getItem(name);
    try {
      const store = await getTauriStore();
      return (await store.get<string>(name)) ?? null;
    } catch {
      return localStorage.getItem(name);
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (!isTauri()) { localStorage.setItem(name, value); return; }
    try {
      const store = await getTauriStore();
      await store.set(name, value);
      await store.save();
    } catch {
      localStorage.setItem(name, value);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    if (!isTauri()) { localStorage.removeItem(name); return; }
    try {
      const store = await getTauriStore();
      await store.delete(name);
      await store.save();
    } catch {
      localStorage.removeItem(name);
    }
  },
};

export const tauriJsonStorage = createJSONStorage(() => tauriStorage);
