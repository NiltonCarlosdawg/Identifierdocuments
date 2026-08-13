import { secureStorageInner } from "./SecureStorageAdapter";

export const CACHE_VERSION = 1;
const STORE_NAME = "docid-cache";
const KEY_NAME = "docid-cache-key";
const ALGO = "AES-GCM";
const IV_LENGTH = 12;
const MAX_KEYS = 50;
export const DEFAULT_TTL_MS = 60 * 60 * 1000;

export const CACHE_TTLS: Record<string, number> = {
  "/stats": 60 * 60 * 1000,
  "/identifiers": 60 * 60 * 1000,
  "/documents": 60 * 60 * 1000,
  "/approvals": 60 * 60 * 1000,
  "/sectors": 24 * 60 * 60 * 1000,
  "/users": 60 * 60 * 1000,
  "/audit": 60 * 60 * 1000,
  "/tenants/me": 24 * 60 * 60 * 1000,
  "/devices": 60 * 60 * 1000,
  "/auth/me": 60 * 60 * 1000,
  "/categories": 60 * 60 * 1000,
  "/sectors/:id/members": 60 * 60 * 1000,
};

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function getStore(): Promise<any> {
  const { load } = await import("@tauri-apps/plugin-store");
  return load(STORE_NAME);
}

async function getKey(): Promise<CryptoKey> {
  let stored = await secureStorageInner.getItem(KEY_NAME);
  if (!stored) {
    stored = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await secureStorageInner.setItem(KEY_NAME, stored);
  }
  const bytes = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", bytes, ALGO, false, ["encrypt", "decrypt"]);
}

async function encrypt(text: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = await crypto.subtle.encrypt({ name: ALGO, iv }, key, new TextEncoder().encode(text));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(data: string): Promise<string> {
  const key = await getKey();
  const raw = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: ALGO, iv: raw.slice(0, IV_LENGTH) }, key, raw.slice(IV_LENGTH)));
}

export interface CacheContext {
  tenantId: string;
  userId: string;
}

export interface CacheEntry<T> {
  version: number;
  cachedAt: string;
  ttlMs: number;
  data: T;
}

export function resolveCacheTtl(endpoint: string, ttlByEndpoint: Record<string, number> = CACHE_TTLS): number {
  if (ttlByEndpoint[endpoint] != null) return ttlByEndpoint[endpoint];
  for (const [pattern, ttl] of Object.entries(ttlByEndpoint)) {
    if (!pattern.includes(":")) continue;
    const segments = pattern.split("/").map(s => (s.startsWith(":") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    if (new RegExp(`^${segments.join("/")}$`).test(endpoint)) return ttl;
  }
  return DEFAULT_TTL_MS;
}

export class OfflineCache {
  constructor(private readonly ttlByEndpoint: Record<string, number> = {}) {}

  private ttlFor(endpoint: string): number {
    return resolveCacheTtl(endpoint, this.ttlByEndpoint);
  }

  private keyFor(context: CacheContext, endpoint: string, params?: string): string {
    const parts = [`cache:v${CACHE_VERSION}:${context.tenantId}:${context.userId}:${endpoint}`];
    if (params) parts.push(params);
    return parts.join(":");
  }

  private prefixFor(context: CacheContext, endpoint: string): string {
    return `cache:v${CACHE_VERSION}:${context.tenantId}:${context.userId}:${endpoint}`;
  }

  async get<T>(context: CacheContext, endpoint: string, params?: string): Promise<CacheEntry<T> | null> {
    if (!isTauri()) return null;
    try {
      const store = await getStore();
      const raw = (await store.get(this.keyFor(context, endpoint, params))) as string | null;
      if (!raw) return null;
      const entry = JSON.parse(await decrypt(raw)) as CacheEntry<T>;
      if (entry.version !== CACHE_VERSION) return null;
      const age = Date.now() - new Date(entry.cachedAt).getTime();
      if (age > entry.ttlMs) return null;
      return entry;
    } catch {
      return null;
    }
  }

  async set<T>(context: CacheContext, endpoint: string, data: T, params?: string): Promise<void> {
    if (!isTauri()) return;
    try {
      const entry: CacheEntry<T> = {
        version: CACHE_VERSION,
        cachedAt: new Date().toISOString(),
        ttlMs: this.ttlFor(endpoint),
        data,
      };
      const store = await getStore();
      await store.set(this.keyFor(context, endpoint, params), await encrypt(JSON.stringify(entry)));
      await this.enforceLimit(store, context);
      await store.save();
    } catch {}
  }

  async invalidate(context: CacheContext, endpoint: string, params?: string): Promise<void> {
    if (!isTauri()) return;
    try {
      const store = await getStore();
      await store.delete(this.keyFor(context, endpoint, params));
      await store.save();
    } catch {}
  }

  async invalidateEndpoint(context: CacheContext, endpoint: string): Promise<void> {
    if (!isTauri()) return;
    try {
      const store = await getStore();
      const prefix = this.prefixFor(context, endpoint);
      const keys = await store.keys();
      for (const k of keys) {
        if (typeof k === "string" && k.startsWith(prefix)) await store.delete(k);
      }
      await store.save();
    } catch {}
  }

  async clearAll(): Promise<void> {
    if (!isTauri()) return;
    try {
      const store = await getStore();
      const keys = await store.keys();
      for (const k of keys) {
        if (typeof k === "string" && k.startsWith("cache:v")) await store.delete(k);
      }
      await store.save();
    } catch {}
  }

  async purgeStaleVersions(): Promise<void> {
    if (!isTauri()) return;
    try {
      const store = await getStore();
      const keys = await store.keys();
      for (const k of keys) {
        if (typeof k === "string" && k.startsWith("cache:v") && !k.startsWith(`cache:v${CACHE_VERSION}:`)) {
          await store.delete(k);
        }
      }
      await store.save();
    } catch {}
  }

  async clearKey(): Promise<void> {
    await secureStorageInner.removeItem(KEY_NAME);
  }

  private async enforceLimit(store: any, context: CacheContext): Promise<void> {
    try {
      const prefix = this.prefixFor(context, "");
      const keys = await store.keys();
      const cacheKeys = keys.filter((k: unknown): k is string => typeof k === "string" && k.startsWith(prefix));
      if (cacheKeys.length <= MAX_KEYS) return;
      const withDate: { key: string; cachedAt: number }[] = [];
      for (const k of cacheKeys) {
        const raw = (await store.get(k)) as string | null;
        if (!raw) continue;
        try {
          const entry = JSON.parse(await decrypt(raw)) as CacheEntry<unknown>;
          withDate.push({ key: k, cachedAt: new Date(entry.cachedAt).getTime() });
        } catch {
          withDate.push({ key: k, cachedAt: 0 });
        }
      }
      withDate.sort((a, b) => a.cachedAt - b.cachedAt);
      for (const oldest of withDate.slice(0, cacheKeys.length - MAX_KEYS)) {
        await store.delete(oldest.key);
      }
    } catch {}
  }
}

export const offlineCache = new OfflineCache(CACHE_TTLS);
