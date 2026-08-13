import { create } from "zustand";
import { printer } from "../../infrastructure/di/container";
import { useAppConfigStore } from "./configStore";
import type { PrinterDevice } from "../../domain/entities/Printer";

interface PrinterState {
  printers: PrinterDevice[];
  selectedPrinter: string | null;
  loading: boolean;
  error: string | null;
  loadPrinters: () => Promise<void>;
  selectPrinter: (name: string) => void;
  printBytes: (bytes: Uint8Array, format: string) => Promise<string>;
  printFile: (path: string) => Promise<string>;
}

export const usePrinterStore = create<PrinterState>((set, get) => ({
  printers: [],
  selectedPrinter: null,
  loading: false,
  error: null,

  loadPrinters: async () => {
    if (!printer.isAvailable()) return;
    set({ loading: true, error: null });
    try {
      const printers = await printer.listPrinters();
      const preferred = useAppConfigStore.getState().defaultPrinter;
      const exists = preferred && printers.some((p) => p.name === preferred);
      set({
        printers,
        selectedPrinter: exists ? preferred : (printers[0]?.name ?? null),
        loading: false,
      });
    } catch (err: any) {
      set({ error: err.message || "Erro ao listar impressoras.", loading: false });
    }
  },

  selectPrinter: (name) => {
    set({ selectedPrinter: name });
    useAppConfigStore.getState().setDefaultPrinter(name);
  },

  printBytes: async (bytes, format) => {
    const name = get().selectedPrinter;
    if (!name) throw new Error("Nenhuma impressora seleccionada.");
    return printer.printBytes(name, bytes, format);
  },

  printFile: async (path) => {
    const name = get().selectedPrinter;
    if (!name) throw new Error("Nenhuma impressora seleccionada.");
    return printer.printFile(name, path);
  },
}));
