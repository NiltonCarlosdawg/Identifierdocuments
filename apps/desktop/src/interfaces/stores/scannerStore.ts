import { create } from "zustand";
import { scanner } from "../../infrastructure/di/container";
import type { ScannerDevice, ScanOptions } from "../../domain/entities/Scanner";

interface ScannerState {
  devices: ScannerDevice[];
  selectedDevice: string | null;
  scanning: boolean;
  error: string | null;
  lastScan: Uint8Array | null;
  options: ScanOptions;
  loadDevices: () => Promise<void>;
  selectDevice: (name: string) => void;
  setOptions: (opts: Partial<ScanOptions>) => void;
  scan: () => Promise<void>;
  clearScan: () => void;
}

export const useScannerStore = create<ScannerState>((set, get) => ({
  devices: [],
  selectedDevice: null,
  scanning: false,
  error: null,
  lastScan: null,
  options: { resolution: 300, mode: "color", format: "pdf" },

  loadDevices: async () => {
    set({ error: null });
    try {
      const devices = await scanner.listScanners();
      set({ devices, selectedDevice: devices[0]?.name ?? null });
    } catch (err: any) {
      set({ error: err.message || "Erro ao listar scanners." });
    }
  },

  selectDevice: (name) => set({ selectedDevice: name }),

  setOptions: (opts) => set((s) => ({ options: { ...s.options, ...opts } })),

  scan: async () => {
    const { selectedDevice, options } = get();
    if (!selectedDevice) { set({ error: "Nenhum scanner seleccionado." }); return; }
    set({ scanning: true, error: null });
    try {
      const data = await scanner.scanDocument(selectedDevice, options);
      set({ lastScan: data, scanning: false });
    } catch (err: any) {
      set({ error: err.message || "Erro ao digitalizar.", scanning: false });
    }
  },

  clearScan: () => set({ lastScan: null }),
}));
