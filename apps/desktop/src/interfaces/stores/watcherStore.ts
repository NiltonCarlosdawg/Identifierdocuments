import { create } from "zustand";
import { watcher, sync } from "../../infrastructure/di/container";
import type { WatcherFileRow, WatcherReport } from "../../domain/entities/Watcher";
import { useAuthStore } from "./authStore";
import { useQueueStore } from "./queueStore";
import { isNetworkError, mapError } from "../../shared/errors/mapError";

interface WatcherState {
  folders: string[];
  running: boolean;
  loading: boolean;
  error: string | null;
  detectedCount: number;
  files: WatcherFileRow[];
  reminders: WatcherFileRow[];
  report: WatcherReport | null;
  loadFolders: () => Promise<void>;
  addFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshReminders: () => Promise<void>;
  refreshReport: () => Promise<void>;
  setFileStatus: (path: string, status: string) => Promise<void>;
  attachDetectedFile: (path: string, identifier: string) => Promise<"attached" | "queued">;
  bumpDetected: () => void;
  clearDetected: () => void;
}

export const useWatcherStore = create<WatcherState>((set, get) => ({
  folders: [],
  running: false,
  loading: false,
  error: null,
  detectedCount: 0,
  files: [],
  reminders: [],
  report: null,

  loadFolders: async () => {
    if (!watcher.isAvailable()) return;
    set({ loading: true, error: null });
    try {
      const [folders, running] = await Promise.all([watcher.getWatchedFolders(), watcher.isRunning()]);
      set({ folders, running });
      await Promise.all([get().refreshFiles(), get().refreshReminders(), get().refreshReport()]);
    } catch (err: any) { set({ error: err.message }); }
    finally { set({ loading: false }); }
  },

  addFolder: async (path) => {
    if (!watcher.isAvailable()) return;
    set({ error: null });
    try {
      await watcher.addWatchedFolder(path);
      const folders = await watcher.getWatchedFolders();
      set({ folders });
    } catch (err: any) { set({ error: err.message }); }
  },

  removeFolder: async (path) => {
    if (!watcher.isAvailable()) return;
    set({ error: null });
    try {
      await watcher.removeWatchedFolder(path);
      if (get().running) {
        await watcher.stopWatcher();
        await watcher.startWatcher();
      }
      const folders = await watcher.getWatchedFolders();
      set({ folders });
    } catch (err: any) { set({ error: err.message }); }
  },

  start: async () => {
    if (!watcher.isAvailable()) return;
    set({ error: null });
    try {
      await watcher.startWatcher();
      set({ running: true });
    } catch (err: any) { set({ error: err.message }); }
  },

  stop: async () => {
    if (!watcher.isAvailable()) return;
    set({ error: null });
    try {
      await watcher.stopWatcher();
      set({ running: false });
    } catch (err: any) { set({ error: err.message }); }
  },

  refreshFiles: async () => {
    if (!watcher.isAvailable()) return;
    try { set({ files: await watcher.getFiles() }); } catch (err: any) { set({ error: err.message }); }
  },

  refreshReminders: async () => {
    if (!watcher.isAvailable()) return;
    try { set({ reminders: await watcher.getReminders() }); } catch (err: any) { set({ error: err.message }); }
  },

  refreshReport: async () => {
    if (!watcher.isAvailable()) return;
    try { set({ report: await watcher.getReport() }); } catch (err: any) { set({ error: err.message }); }
  },

  setFileStatus: async (path, status) => {
    if (!watcher.isAvailable()) return;
    set({ error: null });
    try {
      await watcher.setFileStatus(path, status);
      await Promise.all([get().refreshFiles(), get().refreshReminders(), get().refreshReport()]);
    } catch (err: any) { set({ error: err.message }); }
  },

  attachDetectedFile: async (path, identifier) => {
    if (!watcher.isAvailable()) throw new Error("Watcher não disponível em modo browser.");
    set({ error: null });
    const user = useAuthStore.getState().user;
    try {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("attach_document_native", { path, identifier, uploadSource: "manual" });
        await get().setFileStatus(path, "added");
        return "attached";
      } catch (err: unknown) {
        if (!isNetworkError(err)) throw err;
        if (!user?.tenantId || !user?.id) throw err;
        const item = await sync.enqueueFromPath(path, identifier, user.tenantId, user.id);
        if (!item) throw err;
        useQueueStore.getState().refresh().catch(() => {});
        await get().setFileStatus(path, "added");
        return "queued";
      }
    } catch (err: any) {
      const message = mapError(err, "Erro ao anexar o ficheiro detectado.");
      set({ error: message });
      throw err;
    }
  },

  bumpDetected: () => set(s => ({ detectedCount: s.detectedCount + 1 })),
  clearDetected: () => set({ detectedCount: 0 }),
}));
