import { create } from "zustand";
import { scanner } from "../../infrastructure/di/container";
import { useAppConfigStore } from "./configStore";
import type { ScannerDevice, ScanOptions } from "../../domain/entities/Scanner";

interface ScannerState {
  devices: ScannerDevice[];
  selectedDevice: string | null;
  scanning: boolean;
  error: string | null;
  pages: Uint8Array[];
  currentPage: number;
  options: ScanOptions;
  loadDevices: () => Promise<void>;
  selectDevice: (name: string) => void;
  setOptions: (opts: Partial<ScanOptions>) => void;
  scan: () => Promise<void>;
  setCurrentPage: (index: number) => void;
  removeCurrentPage: () => void;
  clearScan: () => void;
}

export const useScannerStore = create<ScannerState>((set, get) => ({
  devices: [],
  selectedDevice: null,
  scanning: false,
  error: null,
  pages: [],
  currentPage: 0,
  options: { resolution: 300, mode: "color", format: "pdf" },

  loadDevices: async () => {
    set({ error: null });
    try {
      const devices = await scanner.listScanners();
      const preferred = useAppConfigStore.getState().defaultScanner;
      const exists = preferred && devices.some((d) => d.name === preferred);
      set({ devices, selectedDevice: exists ? preferred : (devices[0]?.name ?? null) });
    } catch (err: any) {
      set({ error: err.message || "Erro ao listar scanners." });
    }
  },

  selectDevice: (name) => {
    set({ selectedDevice: name });
    useAppConfigStore.getState().setDefaultScanner(name);
  },

  setOptions: (opts) => set((s) => {
    const formatChanged = !!opts.format && opts.format !== s.options.format;
    return {
      options: { ...s.options, ...opts },
      ...(formatChanged ? { pages: [], currentPage: 0 } : {}),
    };
  }),

  scan: async () => {
    const { selectedDevice, options } = get();
    if (!selectedDevice) { set({ error: "Nenhum scanner seleccionado." }); return; }
    set({ scanning: true, error: null });
    try {
      const data = await scanner.scanDocument(selectedDevice, options);
      set((s) => {
        const pages = [...s.pages, data];
        return { pages, currentPage: pages.length - 1, scanning: false };
      });
    } catch (err: any) {
      set({ error: err.message || "Erro ao digitalizar.", scanning: false });
    }
  },

  setCurrentPage: (index) => set((s) => ({
    currentPage: Math.max(0, Math.min(index, s.pages.length - 1)),
  })),

  removeCurrentPage: () => set((s) => {
    if (s.pages.length === 0) return s;
    const pages = s.pages.filter((_, i) => i !== s.currentPage);
    return { pages, currentPage: Math.max(0, Math.min(s.currentPage, pages.length - 1)) };
  }),

  clearScan: () => set({ pages: [], currentPage: 0 }),
}));
