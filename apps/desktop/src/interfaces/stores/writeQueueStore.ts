import { create } from "zustand";
import { sync } from "../../infrastructure/di/container";
import type { WriteItem } from "../../domain/entities/WriteItem";
import { activeWriteCount } from "../../domain/entities/WriteItem";

interface WriteQueueState {
  items: WriteItem[];
  online: boolean;
  panelOpen: boolean;
  loadQueue: () => Promise<void>;
  checkOnline: () => Promise<void>;
  setPanelOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
}

export const useWriteQueueStore = create<WriteQueueState>((set, get) => ({
  items: [], online: true, panelOpen: false,
  loadQueue: async () => {
    const items = await sync.getWriteQueue();
    set({ items });
  },
  checkOnline: async () => set({ online: await sync.isOnline() }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  refresh: async () => { await get().checkOnline(); await get().loadQueue(); },
}));

export { activeWriteCount };
