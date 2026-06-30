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
    if (!isTauri()) return null;
    try {
      const store = await getTauriStore();
      return (await store.get<string>(name)) ?? null;
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (!isTauri()) return;
    try {
      const store = await getTauriStore();
      await store.set(name, value);
      await store.save();
    } catch {
      /* silent fail — auth state will be lost on restart */
    }
  },
  removeItem: async (name: string): Promise<void> => {
    if (!isTauri()) return;
    try {
      const store = await getTauriStore();
      await store.delete(name);
      await store.save();
    } catch {
      /* silent fail */
    }
  },
};

export const tauriJsonStorage = createJSONStorage(() => tauriStorage);
