import { type StateStorage, createJSONStorage } from "zustand/middleware";

const KEY_ENCRYPTION_KEY = "docid-encryption-key";
const ALGORITHM = "AES-GCM";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getTauriStore() {
  const { load } = await import("@tauri-apps/plugin-store");
  return load("docid-secure");
}

async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  const store = await getTauriStore();
  let stored = await store.get<string>(KEY_ENCRYPTION_KEY);

  if (!stored) {
    const key = await crypto.subtle.generateKey(
      { name: ALGORITHM, length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const raw = await crypto.subtle.exportKey("raw", key);
    stored = btoa(String.fromCharCode(...new Uint8Array(raw)));
    await store.set(KEY_ENCRYPTION_KEY, stored);
    await store.save();
  }

  const raw = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, ALGORITHM, false, ["encrypt", "decrypt"]);
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function encrypt(plaintext: string): Promise<string> {
  const key = await getOrCreateEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded,
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

async function decrypt(data: string): Promise<string> {
  try {
    const key = await getOrCreateEncryptionKey();
    const combined = base64ToBytes(data);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decoded = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(decoded);
  } catch {
    throw new Error("Falha ao descodificar dados seguros.");
  }
}

const secureStorageInner: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (!isTauri()) return null;
    try {
      const store = await getTauriStore();
      const raw = await store.get<string>(`enc_${name}`);
      if (!raw) return null;
      return decrypt(raw);
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (!isTauri()) return;
    try {
      const store = await getTauriStore();
      const encrypted = await encrypt(value);
      await store.set(`enc_${name}`, encrypted);
      await store.save();
    } catch {
      /* silent fail */
    }
  },
  removeItem: async (name: string): Promise<void> => {
    if (!isTauri()) return;
    try {
      const store = await getTauriStore();
      await store.delete(`enc_${name}`);
      await store.save();
    } catch {
      /* silent fail */
    }
  },
};

export const secureJsonStorage = createJSONStorage(() => secureStorageInner);
