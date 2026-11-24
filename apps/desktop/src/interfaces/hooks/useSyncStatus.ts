import { useCallback, useEffect, useState } from "react";
import { sync } from "../../infrastructure/di/container";
import { useAppConfigStore } from "../stores/configStore";
import { useAuthStore } from "../stores/authStore";
import { pendingCount, useQueueStore } from "../stores/queueStore";
import { activeWriteCount, useWriteQueueStore } from "../stores/writeQueueStore";

/** Texto curto da barra lateral, em linguagem corrente. */
export function syncStatusLabel(
  online: boolean,
  syncing: boolean,
  pending: number,
  lastSyncedAt: string | null,
): string {
  if (!online) return "Sem ligação";
  if (syncing) return "A sincronizar…";
  if (pending === 0) return lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "Em dia";
  return "Por sincronizar";
}

export function useSyncStatus() {
  const token = useAuthStore(s => s.token);
  const apiBaseUrl = useAppConfigStore(s => s.apiBaseUrl);
  const uploadItems = useQueueStore(s => s.items);
  const uploadOnline = useQueueStore(s => s.online);
  const refreshUploads = useQueueStore(s => s.refresh);
  const writeItems = useWriteQueueStore(s => s.items);
  const writeOnline = useWriteQueueStore(s => s.online);
  const refreshWrites = useWriteQueueStore(s => s.refresh);

  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    await Promise.all([refreshUploads(), refreshWrites()]);
  }, [refreshUploads, refreshWrites]);

  useEffect(() => {
    if (!token || !sync.isAvailable()) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void sync.setCredentials(token, apiBaseUrl).catch(() => {});
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10_000);
    void sync.onSyncEvent((name, payload) => {
      if (!alive) return;
      void refresh();
      if (name === "sync:complete" || (name === "sync:progress" && (payload as { status?: string } | undefined)?.status === "uploaded")) {
        setLastSyncedAt(new Date().toISOString());
        setLastError(null);
      }
      if (name === "sync:failed") setLastError("A última sincronização teve um problema. Tente novamente.");
    }).then(fn => { if (alive) unlisten = fn; else fn(); });
    return () => { alive = false; clearInterval(timer); unlisten?.(); };
  }, [token, apiBaseUrl, refresh]);

  const syncNow = useCallback(async () => {
    if (syncing || !uploadOnline && !writeOnline) return;
    setSyncing(true);
    setLastError(null);
    try {
      await sync.forceSync();
      setLastSyncedAt(new Date().toISOString());
    } catch {
      setLastError("Não foi possível sincronizar agora. Tente novamente.");
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [syncing, uploadOnline, writeOnline, refresh]);

  return {
    pendingUploads: pendingCount(uploadItems),
    pendingWrites: activeWriteCount(writeItems),
    online: uploadOnline && writeOnline,
    syncing,
    lastSyncedAt,
    lastError,
    syncNow,
  };
}
