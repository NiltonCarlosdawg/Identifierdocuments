import { useCallback } from "react";
import { useAuthStore } from "../stores/authStore";
import { api, offlineCache } from "../../infrastructure/di/container";

export function useCachedAux() {
  const user = useAuthStore(s => s.user);

  return useCallback(async <T>(endpoint: string, params?: string, extract?: (res: any) => T): Promise<T | null> => {
    const context = user ? { tenantId: user.tenantId, userId: user.id } : null;
    try {
      const res = await api.get<any>(endpoint);
      const data = extract ? extract(res) : (res?.data as T);
      if (context && data != null) offlineCache.set(context, endpoint, data, params).catch(() => {});
      return data;
    } catch {
      if (context) {
        const cached = await offlineCache.get<T>(context, endpoint, params);
        if (cached) return cached.data;
      }
      return null;
    }
  }, [user]);
}
