import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { sync } from "../../infrastructure/di/container";
import { pendingCount, useQueueStore } from "../stores/queueStore";
import { useAuthStore } from "../stores/authStore";
import { CloudOff, RefreshCw, Trash2, RotateCcw, X, Upload, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { SyncStatusLabels, SyncStatusColors } from "../../domain/value-objects/SyncStatus";

export default function OfflineQueuePanel() {
  const { items, online, panelOpen, setPanelOpen, refresh, loadQueue } = useQueueStore();
  const token = useAuthStore(s => s.token);
  const pending = pendingCount(items);

  useEffect(() => {
    if (!token || !sync.isAvailable()) return;
    sync.setCredentials(token);
    refresh();
    const interval = setInterval(refresh, 8000);
    let unlistenSync: (() => void) | undefined;
    sync.onSyncEvent(() => { loadQueue(); }).then(fn => { unlistenSync = fn; });
    return () => { clearInterval(interval); unlistenSync?.(); };
  }, [token, refresh, loadQueue]);

  if (!panelOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={() => setPanelOpen(false)} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-docid-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-docid-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-docid-text">Fila Offline</h2>
            <p className="text-xs text-docid-muted">{online ? <span className="flex items-center gap-1 text-docid-secondary"><CheckCircle2 className="h-3 w-3" /> Online</span> : <span className="flex items-center gap-1 text-orange-500"><CloudOff className="h-3 w-3" /> Offline</span>}</p>
          </div>
          <button onClick={() => setPanelOpen(false)} className="rounded-lg p-1.5 hover:bg-docid-surface-low text-docid-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex items-center gap-2 border-b border-docid-border px-5 py-3">
          <button onClick={async () => { await sync.forceSync(); await refresh(); }} disabled={!online || pending === 0} className="flex items-center gap-2 rounded-lg bg-docid-primary px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Sincronizar agora</button>
          <span className="text-xs text-docid-muted">{pending} pendente(s)</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 && <div className="flex flex-col items-center justify-center py-12 text-docid-muted"><Upload className="h-10 w-10 mb-2 opacity-50" /><p className="text-sm">Nenhum ficheiro na fila.</p></div>}
          {items.map(item => (
            <div key={item.id} className="rounded-lg border border-docid-border bg-docid-surface-low p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-docid-text">{item.filename}</p><p className="truncate font-mono text-xs text-docid-muted">{item.identifier}</p></div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SyncStatusColors[item.status]}`}>{item.status === "uploading" ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {SyncStatusLabels[item.status]}</span> : SyncStatusLabels[item.status]}</span>
              </div>
              {item.last_error && <div className="mt-2 flex items-start gap-1.5 text-xs text-docid-error"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="line-clamp-2">{item.last_error}</span></div>}
              {item.attempts > 0 && item.status !== "uploaded" && <p className="mt-1 text-xs text-docid-muted">Tentativas: {item.attempts}/3</p>}
              <div className="mt-3 flex gap-2">
                {item.status === "failed" && <button onClick={async () => { await sync.retryItem(item.id); await refresh(); }} className="flex items-center gap-1 rounded-lg bg-docid-surface-highest px-2.5 py-1 text-xs font-medium text-docid-text hover:bg-docid-border"><RotateCcw className="h-3 w-3" /> Retentar</button>}
                {item.status !== "uploading" && <button onClick={async () => { await sync.removeItem(item.id); await refresh(); }} className="flex items-center gap-1 rounded-lg bg-docid-error/10 px-2.5 py-1 text-xs font-medium text-docid-error hover:bg-docid-error/20"><Trash2 className="h-3 w-3" /> Remover</button>}
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
    if (sync.isAvailable()) {
      listen<{ uploaded: number }>("sync:complete", e => { refresh(); if (e.payload.uploaded > 0) { setSyncToast(`${e.payload.uploaded} sincronizado(s)`); setTimeout(() => setSyncToast(null), 4000); } }).then(fn => { unlisten = fn; });
    }
    return () => { clearInterval(interval); unlisten?.(); };
  }, [refresh]);

  return (<>
    {syncToast && <div className="fixed right-6 top-16 z-50 rounded-lg bg-docid-secondary px-4 py-2 text-sm text-white shadow-lg">{syncToast}</div>}
    <button onClick={() => setPanelOpen(true)} className="relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-docid-surface-low transition-colors text-docid-muted" title="Fila offline">
      {!online ? <CloudOff className="h-4 w-4 text-orange-500" /> : <Upload className="h-4 w-4 text-docid-muted" />}
      {pending > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">{pending}</span>}
    </button>
  </>);
}
