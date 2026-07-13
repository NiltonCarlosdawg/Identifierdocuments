import { type StateStorage, createJSONStorage } from "zustand/middleware";
import type { ISecureStorage } from "../../application/ports/ISecureStorage";

const KEY = "docid-encryption-key";
const ALGO = "AES-GCM";
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function getStore() { const { load } = await import("@tauri-apps/plugin-store"); return load("docid-secure"); }

async function getOrCreateKey(): Promise<CryptoKey> {
  const store = await getStore();
  let stored = await store.get<string>(KEY);
  if (!stored) {
    const key = await crypto.subtle.generateKey({ name: ALGO, length: 256 }, true, ["encrypt", "decrypt"]);
    stored = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", key))));
    await store.set(KEY, stored); await store.save();
  }
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(stored), c => c.charCodeAt(0)), ALGO, false, ["encrypt", "decrypt"]);
}

async function encrypt(text: string): Promise<string> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: ALGO, iv }, key, new TextEncoder().encode(text));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0); combined.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(data: string): Promise<string> {
  try {
    const key = await getOrCreateKey();
    const raw = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: ALGO, iv: raw.slice(0, 12) }, key, raw.slice(12)));
  } catch { throw new Error("Falha ao descodificar dados seguros."); }
}

export const secureStorageInner: ISecureStorage = {
  getItem: async name => { if (!isTauri()) return null; try { const store = await getStore(); const raw = await store.get<string>(`enc_${name}`); return raw ? decrypt(raw) : null; } catch { return null; } },
  setItem: async (name, value) => { if (!isTauri()) return; try { const store = await getStore(); await store.set(`enc_${name}`, await encrypt(value)); await store.save(); } catch {} },
  removeItem: async name => { if (!isTauri()) return; try { const store = await getStore(); await store.delete(`enc_${name}`); await store.save(); } catch {} },
};

export const secureJsonStorage = createJSONStorage(() => ({
  getItem: name => secureStorageInner.getItem(name),
  setItem: (name, value) => secureStorageInner.setItem(name, value),
  removeItem: name => secureStorageInner.removeItem(name),
}));
