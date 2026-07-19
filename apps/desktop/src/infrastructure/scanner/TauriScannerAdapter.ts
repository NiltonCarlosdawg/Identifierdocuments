import type { IScannerService, ScannerDevice, ScanOptions } from "../../domain/entities/Scanner";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class TauriScannerAdapter implements IScannerService {
  isAvailable(): boolean { return isTauri(); }

  async listScanners(): Promise<ScannerDevice[]> {
    if (!isTauri()) return [];
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ScannerDevice[]>("list_scanners");
  }

  async scanDocument(scannerName: string, options?: ScanOptions): Promise<Uint8Array> {
    if (!isTauri()) throw new Error("Scanner não disponível em modo browser.");
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<number[]>("scan_document", { scannerName, options: options || null });
    return new Uint8Array(bytes);
  }
}
