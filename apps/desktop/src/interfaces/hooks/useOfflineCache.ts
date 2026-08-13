import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { offlineCache } from "../../infrastructure/di/container";
import { mapError } from "../../shared/errors/mapError";

export interface UseOfflineCacheOptions<T> {
  endpoint: string;
  params?: string;
  fetcher: () => Promise<T>;
  onData: (data: T) => void;
  enabled?: boolean;
}

export interface UseOfflineCacheResult {
  loading: boolean;
  error: string | null;
  isStale: boolean;
  cachedAt: string | null;
  refresh: () => Promise<void>;
}

export function useOfflineCache<T>({ endpoint, params, fetcher, onData, enabled = true }: UseOfflineCacheOptions<T>): UseOfflineCacheResult {
  const user = useAuthStore(s => s.user);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const context = user ? { tenantId: user.tenantId, userId: user.id } : null;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      onDataRef.current(result);
      setIsStale(false);
      setCachedAt(new Date().toISOString());
      if (context) offlineCache.set(context, endpoint, result, params).catch(() => {});
    } catch (e) {
      let served = false;
      if (context) {
        const cached = await offlineCache.get<T>(context, endpoint, params);
        if (cached) {
          onDataRef.current(cached.data);
          setCachedAt(cached.cachedAt);
          setIsStale(true);
          served = true;
        }
      }
      if (!served) {
        setIsStale(false);
        setCachedAt(null);
        setError(mapError(e));
      }
    } finally {
      setLoading(false);
    }
  }, [endpoint, params, user]);

  useEffect(() => { if (enabled) refresh(); }, [refresh, enabled]);

  return { loading, error, isStale, cachedAt, refresh };
}
