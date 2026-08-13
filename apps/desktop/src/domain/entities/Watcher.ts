export interface WatcherFileRow {
  path: string;
  status: "detected" | "pending" | "added" | "ignored";
  kind: "identifier_found" | "file_detected";
  identifier: string | null;
  mtime: number;
  created_at: string;
  updated_at: string;
}

export interface WatcherReport {
  detected: number;
  pending: number;
  added: number;
  ignored: number;
  identifier_found: number;
  file_detected: number;
}

export interface IWatcherService {
  isAvailable(): boolean;
  startWatcher(): Promise<string>;
  stopWatcher(): Promise<string>;
  isRunning(): Promise<boolean>;
  addWatchedFolder(path: string): Promise<string>;
  removeWatchedFolder(path: string): Promise<string>;
  getWatchedFolders(): Promise<string[]>;
  getFiles(status?: string): Promise<WatcherFileRow[]>;
  setFileStatus(path: string, status: string): Promise<void>;
  getReminders(): Promise<WatcherFileRow[]>;
  getReport(): Promise<WatcherReport>;
}
