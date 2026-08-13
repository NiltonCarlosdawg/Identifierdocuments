import type { ISyncService, UnlistenFn } from "../../application/ports/ISyncService";
import type { QueueItem } from "../../domain/entities/QueueItem";
import type { WriteItem } from "../../domain/entities/WriteItem";
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class TauriSyncAdapter implements ISyncService {
  isAvailable(): boolean { return isTauri(); }
  async setCredentials(token: string, apiBaseUrl = "http://localhost:3000"): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_sync_credentials", { token, apiBaseUrl });
  }
  async clearCredentials(): Promise<void> { if (!isTauri()) return; const { invoke } = await import("@tauri-apps/api/core"); await invoke("clear_sync_credentials"); }
  async getApiBaseUrl(): Promise<string> { if (!isTauri()) return "http://localhost:3000"; const { invoke } = await import("@tauri-apps/api/core"); return invoke<string>("get_api_base_url"); }
  async setApiBaseUrl(url: string): Promise<void> { if (!isTauri()) return; const { invoke } = await import("@tauri-apps/api/core"); await invoke("set_api_base_url", { url }); }
  async isOnline(): Promise<boolean> {
    if (!isTauri()) { try { const res = await fetch("http://localhost:3000/"); return res.ok; } catch { return false; } }
    const { invoke } = await import("@tauri-apps/api/core"); return invoke<boolean>("is_online");
  }
  async getQueue(): Promise<QueueItem[]> { if (!isTauri()) return []; const { invoke } = await import("@tauri-apps/api/core"); return invoke<QueueItem[]>("get_queue"); }
  async enqueueFromFile(file: File, identifier: string, tenantId: string, userId: string, uploadMode: "attach" | "attachment" = "attach"): Promise<QueueItem | null> {
    if (!isTauri()) return null;
    if (file.size > 52_428_800) throw new Error("Ficheiro demasiado grande. Máximo: 50MB.");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<QueueItem>("enqueue_upload_bytes", { filename: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())), identifier, tenantId, userId, uploadMode });
  }
  async enqueueFromPath(path: string, identifier: string, tenantId: string, userId: string, uploadMode: "attach" | "attachment" = "attach"): Promise<QueueItem | null> {
    if (!isTauri()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<QueueItem>("enqueue_upload", { sourcePath: path, identifier, tenantId, userId, uploadMode });
  }
  async removeItem(id: string): Promise<void> { if (!isTauri()) return; const { invoke } = await import("@tauri-apps/api/core"); await invoke("remove_queue_item", { id }); }
  async retryItem(id: string): Promise<void> { if (!isTauri()) return; const { invoke } = await import("@tauri-apps/api/core"); await invoke("retry_queue_item", { id }); await invoke("force_sync"); }
  async forceSync(): Promise<number> { if (!isTauri()) return 0; const { invoke } = await import("@tauri-apps/api/core"); return invoke<number>("force_sync"); }
  async clearUploaded(): Promise<number> { if (!isTauri()) return 0; const { invoke } = await import("@tauri-apps/api/core"); return invoke<number>("clear_uploaded"); }
  async downloadOffline(documentParam: string, filename: string): Promise<string | null> {
    if (!isTauri()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("download_document_offline", { documentParam, filename });
  }
  async openLocalFile(path: string): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_local_file", { path });
  }
  async isDocumentCached(documentParam: string): Promise<boolean> {
    if (!isTauri()) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("is_document_cached", { documentParam });
  }
  async getWriteQueue(): Promise<WriteItem[]> { if (!isTauri()) return []; const { invoke } = await import("@tauri-apps/api/core"); return invoke<WriteItem[]>("get_write_queue"); }
  async enqueueWrite(method: string, path: string, body: string | null, idempotencyKey: string, resourceKey?: string): Promise<WriteItem | null> {
    if (!isTauri()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<WriteItem>("enqueue_write", { method, path, body, idempotencyKey, resourceKey });
  }
  async removeWriteItem(id: string): Promise<void> { if (!isTauri()) return; const { invoke } = await import("@tauri-apps/api/core"); await invoke("remove_write_item", { id }); }
  async retryWriteItem(id: string): Promise<void> { if (!isTauri()) return; const { invoke } = await import("@tauri-apps/api/core"); await invoke("retry_write_item", { id }); await invoke("force_sync"); }
  async onSyncEvent(handler: (event: string, payload?: unknown) => void): Promise<UnlistenFn> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    const unlisteners: UnlistenFn[] = [];
    await Promise.all([
      listen("sync:progress", e => handler("sync:progress", e.payload)),
      listen("sync:complete", e => handler("sync:complete", e.payload)),
      listen("sync:failed", e => handler("sync:failed", e.payload)),
    ]).then(fns => { unlisteners.push(...fns); });
    return () => unlisteners.forEach(fn => fn());
  }
}
