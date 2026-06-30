import { invoke } from "@tauri-apps/api/core";
import { useAppConfigStore } from "../stores/config";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface QueueItem {
  id: string;
  file_path: string;
  filename: string;
  identifier: string;
  tenant_id: string;
  user_id: string;
  status: "pending" | "uploading" | "uploaded" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: string;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const syncService = {
  isAvailable: () => isTauri(),

  async setCredentials(token: string, apiBaseUrl = "http://localhost:3000") {
    if (!isTauri()) return;
    await invoke("set_sync_credentials", { token, apiBaseUrl });
  },

  async clearCredentials() {
    if (!isTauri()) return;
    await invoke("clear_sync_credentials");
  },

  async getApiBaseUrl(): Promise<string> {
    if (!isTauri()) return useAppConfigStore.getState().apiBaseUrl || "http://localhost:3000";
    try {
      return await invoke<string>("get_api_base_url");
    } catch {
      return useAppConfigStore.getState().apiBaseUrl || "http://localhost:3000";
    }
  },

  async setApiBaseUrl(url: string) {
    if (!isTauri()) return;
    await invoke("set_api_base_url", { url });
  },

  async isOnline(): Promise<boolean> {
    if (!isTauri()) {
      try {
        const url = useAppConfigStore.getState().apiBaseUrl || "http://localhost:3000";
        const res = await fetch(`${url}/`, { method: "GET" });
        return res.ok;
      } catch {
        return false;
      }
    }
    return invoke<boolean>("is_online");
  },

  async getQueue(): Promise<QueueItem[]> {
    if (!isTauri()) return [];
    return invoke<QueueItem[]>("get_queue");
  },

  async enqueueFromFile(
    file: File,
    identifier: string,
    tenantId: string,
    userId: string,
  ): Promise<QueueItem | null> {
    if (!isTauri()) return null;
    const MAX_IPC_SIZE = 52_428_800;
    if (file.size > MAX_IPC_SIZE) {
      throw new Error(`Ficheiro demasiado grande. Máximo: 50MB.`);
    }
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    return invoke<QueueItem>("enqueue_upload_bytes", {
      filename: file.name,
      bytes,
      identifier,
      tenantId,
      userId,
    });
  },

  async removeItem(id: string) {
    if (!isTauri()) return;
    await invoke("remove_queue_item", { id });
  },

  async retryItem(id: string) {
    if (!isTauri()) return;
    await invoke("retry_queue_item", { id });
    await invoke("force_sync");
  },

  async forceSync() {
    if (!isTauri()) return 0;
    return invoke<number>("force_sync");
  },

  async clearUploaded() {
    if (!isTauri()) return 0;
    return invoke<number>("clear_uploaded");
  },

  onSyncEvent(
    handler: (event: string, payload?: unknown) => void,
  ): Promise<UnlistenFn> {
    if (!isTauri()) return Promise.resolve(() => {});

    const unlisteners: UnlistenFn[] = [];
    return Promise.all([
      listen("sync:progress", (e) => handler("sync:progress", e.payload)),
      listen("sync:complete", (e) => handler("sync:complete", e.payload)),
      listen("sync:failed", (e) => handler("sync:failed", e.payload)),
    ]).then((fns) => {
      unlisteners.push(...fns);
      return () => unlisteners.forEach((fn) => fn());
    });
  },
};
