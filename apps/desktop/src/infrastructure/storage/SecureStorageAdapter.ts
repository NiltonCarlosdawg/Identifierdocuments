import { type StateStorage, createJSONStorage } from "zustand/middleware";
import type { ISecureStorage } from "../../application/ports/ISecureStorage";

const KEY = "docid-encryption-key";
const ALGO = "AES-GCM";
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function getStore() { const { load } = await import("@tauri-apps/plugin-store"); return load("docid-secure"); }

let keyPromise: Promise<CryptoKey> | null = null;

/** A chave fica em memória depois da primeira leitura; se falhar, tenta de novo na próxima chamada. */
function getOrCreateKey(): Promise<CryptoKey> {
  if (!keyPromise) keyPromise = loadKey().catch(err => { keyPromise = null; throw err; });
  return keyPromise;
}

/**
 * A chave mestra vive no cofre do sistema (Gestor de Credenciais do Windows), não no
 * ficheiro `docid-secure` que guarda os dados encriptados. Instalações antigas tinham a
 * chave nesse ficheiro: é migrada para o cofre e apagada do ficheiro na primeira execução.
 * Em plataformas sem cofre suportado, mantém-se o comportamento antigo.
 */
async function loadKey(): Promise<CryptoKey> {
  const store = await getStore();
  const legacy = await store.get<string>(KEY);
  const candidate = legacy ?? btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  let keyB64: string;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    keyB64 = await invoke<string>("secure_key_get_or_init", { candidate });
    if (legacy) { await store.delete(KEY); await store.save(); }
  } catch {
    keyB64 = candidate;
    if (!legacy) { await store.set(KEY, candidate); await store.save(); }
  }
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(keyB64), c => c.charCodeAt(0)), ALGO, false, ["encrypt", "decrypt"]);
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

const browserKey = (name: string) => `browser_${name}`;

export const secureStorageInner: ISecureStorage = {
  getItem: async name => { if (!isTauri()) return typeof localStorage === "undefined" ? null : localStorage.getItem(browserKey(name)); try { const store = await getStore(); const raw = await store.get<string>(`enc_${name}`); return raw ? decrypt(raw) : null; } catch { return null; } },
  setItem: async (name, value) => { if (!isTauri()) { if (typeof localStorage !== "undefined") localStorage.setItem(browserKey(name), value); return; } try { const store = await getStore(); await store.set(`enc_${name}`, await encrypt(value)); await store.save(); } catch {} },
  removeItem: async name => { if (!isTauri()) { if (typeof localStorage !== "undefined") localStorage.removeItem(browserKey(name)); return; } try { const store = await getStore(); await store.delete(`enc_${name}`); await store.save(); } catch {} },
};

export const secureJsonStorage = createJSONStorage(() => ({
  getItem: name => secureStorageInner.getItem(name),
  setItem: (name, value) => secureStorageInner.setItem(name, value),
  removeItem: name => secureStorageInner.removeItem(name),
}));
