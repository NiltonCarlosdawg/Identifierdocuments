import type { IWatcherService } from "../../domain/entities/Watcher";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class TauriWatcherAdapter implements IWatcherService {
  isAvailable(): boolean { return isTauri(); }

  async startWatcher(): Promise<string> {
    if (!isTauri()) throw new Error("Watcher não disponível em modo browser.");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("start_watcher");
  }

  async stopWatcher(): Promise<string> {
    if (!isTauri()) return "Watcher não disponível.";
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("stop_watcher");
  }

  async isRunning(): Promise<boolean> {
    if (!isTauri()) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("is_watcher_running");
  }

  async addWatchedFolder(path: string): Promise<string> {
    if (!isTauri()) throw new Error("Watcher não disponível em modo browser.");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("add_watched_folder", { path });
  }

  async removeWatchedFolder(path: string): Promise<string> {
    if (!isTauri()) return "";
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("remove_watched_folder", { path });
  }

  async getWatchedFolders(): Promise<string[]> {
    if (!isTauri()) return [];
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string[]>("get_watched_folders");
  }
}
