export interface IWatcherService {
  isAvailable(): boolean;
  startWatcher(): Promise<string>;
  stopWatcher(): Promise<string>;
  isRunning(): Promise<boolean>;
  addWatchedFolder(path: string): Promise<string>;
  removeWatchedFolder(path: string): Promise<string>;
  getWatchedFolders(): Promise<string[]>;
}
