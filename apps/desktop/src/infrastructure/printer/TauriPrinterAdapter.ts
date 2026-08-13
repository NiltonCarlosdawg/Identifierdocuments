import type { IPrinterService, PrinterDevice } from "../../domain/entities/Printer";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class TauriPrinterAdapter implements IPrinterService {
  isAvailable(): boolean { return isTauri(); }

  async listPrinters(): Promise<PrinterDevice[]> {
    if (!isTauri()) return [];
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PrinterDevice[]>("list_printers");
  }

  async printFile(printer: string, path: string): Promise<string> {
    if (!isTauri()) throw new Error("Impressão só disponível na app desktop.");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("print_file", { printer, path });
  }

  async printBytes(printer: string, bytes: Uint8Array, format: string): Promise<string> {
    if (!isTauri()) throw new Error("Impressão só disponível na app desktop.");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("print_bytes", { printer, bytes: Array.from(bytes), format });
  }
}
