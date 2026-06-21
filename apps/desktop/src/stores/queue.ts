import { create } from "zustand";
import { syncService, type QueueItem } from "../services/sync";

interface QueueState {
  items: QueueItem[];
  online: boolean;
  syncing: boolean;
  panelOpen: boolean;
  loadQueue: () => Promise<void>;
  checkOnline: () => Promise<void>;
  setPanelOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  online: true,
  syncing: false,
  panelOpen: false,

  loadQueue: async () => {
    const items = await syncService.getQueue();
    set({ items });
    await syncService.clearUploaded().catch(() => {});
    const fresh = await syncService.getQueue();
    set({ items: fresh });
  },

  checkOnline: async () => {
    const online = await syncService.isOnline();
    set({ online });
  },

  setPanelOpen: (open) => set({ panelOpen: open }),

  refresh: async () => {
    await get().checkOnline();
    await get().loadQueue();
  },
}));

export function pendingCount(items: QueueItem[]): number {
  return items.filter((i) => i.status === "pending" || i.status === "uploading" || i.status === "failed").length;
}
