import type { QueueItem } from "../../domain/entities/QueueItem";
export type UnlistenFn = () => void;

export interface ISyncService {
  isAvailable(): boolean;
  setCredentials(token: string, apiBaseUrl?: string): Promise<void>;
  clearCredentials(): Promise<void>;
  getApiBaseUrl(): Promise<string>;
  setApiBaseUrl(url: string): Promise<void>;
  isOnline(): Promise<boolean>;
  getQueue(): Promise<QueueItem[]>;
  enqueueFromFile(file: File, identifier: string, tenantId: string, userId: string): Promise<QueueItem | null>;
  removeItem(id: string): Promise<void>;
  retryItem(id: string): Promise<void>;
  forceSync(): Promise<number>;
  clearUploaded(): Promise<number>;
  onSyncEvent(handler: (event: string, payload?: unknown) => void): Promise<UnlistenFn>;
}
