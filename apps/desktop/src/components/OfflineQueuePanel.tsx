import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { syncService } from "../services/sync";
import { pendingCount, useQueueStore } from "../stores/queue";
import { useAuthStore } from "../stores/auth";
import {
  CloudOff, RefreshCw, Trash2, RotateCcw, X, Upload, AlertCircle, CheckCircle2, Loader2,
} from "lucide-react";

const statusLabel: Record<string, string> = {
  pending: "Pendente",
  uploading: "A enviar...",
  uploaded: "Enviado",
  failed: "Falhou",
};

const statusColor: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  uploading: "bg-blue-100 text-blue-800",
  uploaded: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export default function OfflineQueuePanel() {
  const { items, online, panelOpen, setPanelOpen, refresh, loadQueue } = useQueueStore();
  const token = useAuthStore((s) => s.token);
  const pending = pendingCount(items);

  useEffect(() => {
    if (!token || !syncService.isAvailable()) return;

    syncService.setCredentials(token);
    refresh();

    const interval = setInterval(refresh, 8000);
    let unlistenTauri: (() => void) | undefined;
    let unlistenSync: (() => void) | undefined;

    syncService.onSyncEvent((event) => {
      if (event === "sync:complete" || event === "sync:progress" || event === "sync:failed") {
        loadQueue();
      }
    }).then((fn) => { unlistenSync = fn; });

    listen<{ uploaded: number }>("sync:complete", () => {
      loadQueue();
    }).then((fn) => { unlistenTauri = fn; });

    return () => {
      clearInterval(interval);
      unlistenTauri?.();
      unlistenSync?.();
    };
  }, [token, refresh, loadQueue]);

  if (!panelOpen) return null;

  const handleForceSync = async () => {
    await syncService.forceSync();
    await refresh();
  };

  const handleRetry = async (id: string) => {
    await syncService.retryItem(id);
    await refresh();
  };

  const handleRemove = async (id: string) => {
    await syncService.removeItem(id);
    await refresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={() => setPanelOpen(false)} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Fila Offline</h2>
            <p className="text-xs text-gray-500">
              {online ? (
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3 w-3" /> Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-orange-600">
                  <CloudOff className="h-3 w-3" /> Offline
                </span>
              )}
            </p>
          </div>
          <button onClick={() => setPanelOpen(false)} className="rounded-lg p-1.5 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b px-5 py-3">
          <button
            onClick={handleForceSync}
            disabled={!online || pending === 0}
            className="flex items-center gap-2 rounded-lg bg-verano-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-verano-700 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Sincronizar agora
          </button>
          <span className="text-xs text-gray-500">{pending} pendente(s)</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Upload className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">Nenhum ficheiro na fila.</p>
            </div>
          )}

          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-gray-100 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{item.filename}</p>
                  <p className="truncate font-mono text-xs text-gray-500">{item.identifier}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[item.status]}`}>
                  {item.status === "uploading" ? (
                    <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {statusLabel[item.status]}</span>
                  ) : statusLabel[item.status]}
                </span>
              </div>

              {item.last_error && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span className="line-clamp-2">{item.last_error}</span>
                </div>
              )}

              {item.attempts > 0 && item.status !== "uploaded" && (
                <p className="mt-1 text-xs text-gray-400">Tentativas: {item.attempts}/3</p>
              )}

              <div className="mt-3 flex gap-2">
                {item.status === "failed" && (
                  <button
                    onClick={() => handleRetry(item.id)}
                    className="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium hover:bg-gray-200"
                  >
                    <RotateCcw className="h-3 w-3" /> Retentar
                  </button>
                )}
                {item.status !== "uploading" && (
                  <button
                    onClick={() => handleRemove(item.id)}
                    className="flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                  >
                    <Trash2 className="h-3 w-3" /> Remover
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OfflineQueueBadge() {
  const { items, online, setPanelOpen, refresh } = useQueueStore();
  const pending = pendingCount(items);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    let unlisten: (() => void) | undefined;
    if (syncService.isAvailable()) {
      listen<{ uploaded: number }>("sync:complete", (e) => {
        refresh();
        if (e.payload.uploaded > 0) {
          setSyncToast(`${e.payload.uploaded} sincronizado(s)`);
          setTimeout(() => setSyncToast(null), 4000);
        }
      }).then((fn) => { unlisten = fn; });
    }
    return () => { clearInterval(interval); unlisten?.(); };
  }, [refresh]);

  return (
    <>
      {syncToast && (
        <div className="fixed right-6 top-16 z-50 rounded-lg bg-green-700 px-4 py-2 text-sm text-white shadow-lg">
          {syncToast}
        </div>
      )}
      <button
      onClick={() => setPanelOpen(true)}
      className="relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-gray-100 transition-colors"
      title="Fila offline"
    >
      {!online ? (
        <CloudOff className="h-4 w-4 text-orange-500" />
      ) : (
        <Upload className="h-4 w-4 text-gray-500" />
      )}
      {pending > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
          {pending}
        </span>
      )}
    </button>
    </>
  );
}
