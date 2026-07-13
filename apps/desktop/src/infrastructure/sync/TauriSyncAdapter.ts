import type { ISyncService, UnlistenFn } from "../../application/ports/ISyncService";
import type { QueueItem } from "../../domain/entities/QueueItem";
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
  async enqueueFromFile(file: File, identifier: string, tenantId: string, userId: string): Promise<QueueItem | null> {
    if (!isTauri()) return null;
    if (file.size > 52_428_800) throw new Error("Ficheiro demasiado grande. Máximo: 50MB.");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<QueueItem>("enqueue_upload_bytes", { filename: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())), identifier, tenantId, userId });
  }
  async removeItem(id: string): Promise<void> { if (!isTauri()) return; const { invoke } = await import("@tauri-apps/api/core"); await invoke("remove_queue_item", { id }); }
  async retryItem(id: string): Promise<void> { if (!isTauri()) return; const { invoke } = await import("@tauri-apps/api/core"); await invoke("retry_queue_item", { id }); await invoke("force_sync"); }
  async forceSync(): Promise<number> { if (!isTauri()) return 0; const { invoke } = await import("@tauri-apps/api/core"); return invoke<number>("force_sync"); }
  async clearUploaded(): Promise<number> { if (!isTauri()) return 0; const { invoke } = await import("@tauri-apps/api/core"); return invoke<number>("clear_uploaded"); }
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
