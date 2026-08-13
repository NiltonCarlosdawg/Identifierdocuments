import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { sync } from "../../infrastructure/di/container";
import { activeWriteCount, useWriteQueueStore } from "../stores/writeQueueStore";
import { useAuthStore } from "../stores/authStore";
import { DatabaseBackup, RefreshCw, Trash2, RotateCcw, X, PenLine, AlertCircle, CheckCircle2, Loader2, CloudOff } from "lucide-react";

const WriteStatusLabels: Record<string, string> = {
  pending: "Pendente",
  applying: "A aplicar...",
  done: "Aplicado",
  failed: "Falhou",
  conflict: "Conflito",
};

const WriteStatusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  applying: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  done: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  conflict: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

export default function WriteQueuePanel() {
  const { items, online, panelOpen, setPanelOpen, refresh, loadQueue } = useWriteQueueStore();
  const token = useAuthStore(s => s.token);
  const active = activeWriteCount(items);

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
            <h2 className="text-lg font-semibold text-docid-text">Escritas Pendentes</h2>
            <p className="text-xs text-docid-muted">{online ? <span className="flex items-center gap-1 text-docid-secondary"><CheckCircle2 className="h-3 w-3" /> Online</span> : <span className="flex items-center gap-1 text-orange-500"><CloudOff className="h-3 w-3" /> Offline</span>}</p>
          </div>
          <button onClick={() => setPanelOpen(false)} className="rounded-lg p-1.5 hover:bg-docid-surface-low text-docid-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex items-center gap-2 border-b border-docid-border px-5 py-3">
          <button onClick={async () => { await sync.forceSync(); await refresh(); }} disabled={!online || active === 0} className="flex items-center gap-2 rounded-lg bg-docid-primary px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Sincronizar agora</button>
          <span className="text-xs text-docid-muted">{active} pendente(s)</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 && <div className="flex flex-col items-center justify-center py-12 text-docid-muted"><PenLine className="h-10 w-10 mb-2 opacity-50" /><p className="text-sm">Nenhuma escrita pendente.</p></div>}
          {items.map(item => (
            <div key={item.id} className="rounded-lg border border-docid-border bg-docid-surface-low p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-docid-text"><span className="font-mono text-xs text-docid-secondary">{item.method}</span> {item.resource_key ?? item.path}</p>
                  <p className="truncate font-mono text-xs text-docid-muted">{item.path}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${WriteStatusColors[item.status]}`}>{item.status === "applying" ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {WriteStatusLabels[item.status]}</span> : WriteStatusLabels[item.status]}</span>
              </div>
              {item.status === "conflict" && <p className="mt-2 flex items-start gap-1.5 text-xs text-docid-error"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="line-clamp-2">O estado no servidor prevalece. Reveja esta operação.</span></p>}
              {item.last_error && item.status !== "conflict" && <div className="mt-2 flex items-start gap-1.5 text-xs text-docid-error"><AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="line-clamp-2">{item.last_error}</span></div>}
              {item.attempts > 0 && item.status !== "done" && <p className="mt-1 text-xs text-docid-muted">Tentativas: {item.attempts}/5</p>}
              <div className="mt-3 flex gap-2">
                {(item.status === "failed" || item.status === "conflict") && <button onClick={async () => { await sync.retryWriteItem(item.id); await refresh(); }} className="flex items-center gap-1 rounded-lg bg-docid-surface-highest px-2.5 py-1 text-xs font-medium text-docid-text hover:bg-docid-border"><RotateCcw className="h-3 w-3" /> Retentar</button>}
                {item.status !== "applying" && <button onClick={async () => { await sync.removeWriteItem(item.id); await refresh(); }} className="flex items-center gap-1 rounded-lg bg-docid-error/10 px-2.5 py-1 text-xs font-medium text-docid-error hover:bg-docid-error/20"><Trash2 className="h-3 w-3" /> Remover</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WriteQueueBadge() {
  const { items, online, setPanelOpen, refresh } = useWriteQueueStore();
  const active = activeWriteCount(items);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    let unlisten: (() => void) | undefined;
    if (sync.isAvailable()) {
      listen("sync:complete", () => { refresh(); }).then(fn => { unlisten = fn; });
    }
    return () => { clearInterval(interval); unlisten?.(); };
  }, [refresh]);

  return (
    <button onClick={() => setPanelOpen(true)} className="relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-docid-surface-low transition-colors text-docid-muted" title="Escritas pendentes (offline)">
      {!online ? <CloudOff className="h-4 w-4 text-orange-500" /> : <DatabaseBackup className="h-4 w-4 text-docid-muted" />}
      {active > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-docid-secondary px-1 text-[10px] font-bold text-white">{active}</span>}
    </button>
  );
}
