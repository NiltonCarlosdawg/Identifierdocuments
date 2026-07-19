import { create } from "zustand";
import { watcher } from "../../infrastructure/di/container";

interface WatcherState {
  folders: string[];
  running: boolean;
  loading: boolean;
  error: string | null;
  detectedCount: number;
  loadFolders: () => Promise<void>;
  addFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  bumpDetected: () => void;
  clearDetected: () => void;
}

export const useWatcherStore = create<WatcherState>((set, get) => ({
  folders: [],
  running: false,
  loading: false,
  error: null,
  detectedCount: 0,

  loadFolders: async () => {
    if (!watcher.isAvailable()) return;
    set({ loading: true, error: null });
    try {
      const [folders, running] = await Promise.all([watcher.getWatchedFolders(), watcher.isRunning()]);
      set({ folders, running });
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

  bumpDetected: () => set(s => ({ detectedCount: s.detectedCount + 1 })),
  clearDetected: () => set({ detectedCount: 0 }),
}));
