import type { ISyncService, UnlistenFn } from "../ports/ISyncService";
import type { QueueItem } from "../../domain/entities/QueueItem";

export class SyncService implements ISyncService {
  private isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  isAvailable(): boolean { return this.isTauri(); }
  async setCredentials(token: string, apiBaseUrl = "http://localhost:3000"): Promise<void> {
    if (!this.isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_sync_credentials", { token, apiBaseUrl });
  }
  async clearCredentials(): Promise<void> {
    if (!this.isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("clear_sync_credentials");
  }
  async getApiBaseUrl(): Promise<string> {
    if (!this.isTauri()) return "http://localhost:3000";
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("get_api_base_url");
  }
  async setApiBaseUrl(url: string): Promise<void> {
    if (!this.isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_api_base_url", { url });
  }
  async isOnline(): Promise<boolean> {
    if (!this.isTauri()) { try { const res = await fetch("http://localhost:3000/"); return res.ok; } catch { return false; } }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("is_online");
  }
  async getQueue(): Promise<QueueItem[]> {
    if (!this.isTauri()) return [];
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<QueueItem[]>("get_queue");
  }
  async enqueueFromFile(file: File, identifier: string, tenantId: string, userId: string): Promise<QueueItem | null> {
    if (!this.isTauri()) return null;
    const MAX_IPC_SIZE = 52_428_800;
    if (file.size > MAX_IPC_SIZE) throw new Error("Ficheiro demasiado grande. Máximo: 50MB.");
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    return invoke<QueueItem>("enqueue_upload_bytes", { filename: file.name, bytes, identifier, tenantId, userId });
  }
  async removeItem(id: string): Promise<void> { if (!this.isTauri()) return; const { invoke } = await import("@tauri-apps/api/core"); await invoke("remove_queue_item", { id }); }
  async retryItem(id: string): Promise<void> { if (!this.isTauri()) return; const { invoke } = await import("@tauri-apps/api/core"); await invoke("retry_queue_item", { id }); await invoke("force_sync"); }
  async forceSync(): Promise<number> { if (!this.isTauri()) return 0; const { invoke } = await import("@tauri-apps/api/core"); return invoke<number>("force_sync"); }
  async clearUploaded(): Promise<number> { if (!this.isTauri()) return 0; const { invoke } = await import("@tauri-apps/api/core"); return invoke<number>("clear_uploaded"); }
  async onSyncEvent(handler: (event: string, payload?: unknown) => void): Promise<UnlistenFn> {
    if (!this.isTauri()) return () => {};
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
