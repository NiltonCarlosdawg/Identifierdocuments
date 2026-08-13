import { create } from "zustand";
import { sync } from "../../infrastructure/di/container";
import type { QueueItem } from "../../domain/entities/QueueItem";
import { pendingCount } from "../../domain/entities/QueueItem";

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

let refreshChain: Promise<void> = Promise.resolve();

export const useQueueStore = create<QueueState>()((set, get) => ({
  items: [], online: true, syncing: false, panelOpen: false,
  loadQueue: async () => {
    const items = await sync.getQueue();
    set({ items });
    await sync.clearUploaded().catch(() => {});
    set({ items: await sync.getQueue() });
  },
  checkOnline: async () => set({ online: await sync.isOnline() }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  refresh: async () => {
    const run = async () => {
      await get().checkOnline();
      await get().loadQueue();
    };
    refreshChain = refreshChain.then(run, run);
    await refreshChain;
  },
}));

export { pendingCount };
