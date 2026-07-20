export interface ScannerDevice {
  name: string;
  vendor: string;
  model: string;
}

export interface ScanOptions {
  resolution: number;
  mode: string;
  format: string;
}

export interface IScannerService {
  isAvailable(): boolean;
  listScanners(): Promise<ScannerDevice[]>;
  scanDocument(scannerName: string, options?: ScanOptions): Promise<Uint8Array>;
}
