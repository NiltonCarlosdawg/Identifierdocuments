export interface PrinterDevice {
  name: string;
}

export interface IPrinterService {
  isAvailable(): boolean;
  listPrinters(): Promise<PrinterDevice[]>;
  printFile(printer: string, path: string): Promise<string>;
  printBytes(printer: string, bytes: Uint8Array, format: string): Promise<string>;
}
