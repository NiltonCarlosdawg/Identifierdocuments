import { type StateStorage, createJSONStorage } from "zustand/middleware";
const STORE = "docid-auth";
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function getStore() { const { load } = await import("@tauri-apps/plugin-store"); return load(STORE); }

const tauriStorage: StateStorage = {
  getItem: async name => { if (!isTauri()) return null; try { const store = await getStore(); return (await store.get<string>(name)) ?? null; } catch { return null; } },
  setItem: async (name, value) => { if (!isTauri()) return; try { const store = await getStore(); await store.set(name, value); await store.save(); } catch {} },
  removeItem: async name => { if (!isTauri()) return; try { const store = await getStore(); await store.delete(name); await store.save(); } catch {} },
};

export const tauriJsonStorage = createJSONStorage(() => tauriStorage);
