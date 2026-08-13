import type { QueueItem } from "../../domain/entities/QueueItem";
import type { WriteItem } from "../../domain/entities/WriteItem";
export type UnlistenFn = () => void;

export interface ISyncService {
  isAvailable(): boolean;
  setCredentials(token: string, apiBaseUrl?: string): Promise<void>;
  clearCredentials(): Promise<void>;
  getApiBaseUrl(): Promise<string>;
  setApiBaseUrl(url: string): Promise<void>;
  isOnline(): Promise<boolean>;
  getQueue(): Promise<QueueItem[]>;
  enqueueFromFile(file: File, identifier: string, tenantId: string, userId: string, uploadMode?: "attach" | "attachment"): Promise<QueueItem | null>;
  enqueueFromPath(path: string, identifier: string, tenantId: string, userId: string, uploadMode?: "attach" | "attachment"): Promise<QueueItem | null>;
  removeItem(id: string): Promise<void>;
  retryItem(id: string): Promise<void>;
  forceSync(): Promise<number>;
  clearUploaded(): Promise<number>;
  downloadOffline(documentParam: string, filename: string): Promise<string | null>;
  openLocalFile(path: string): Promise<void>;
  isDocumentCached(documentParam: string): Promise<boolean>;
  getWriteQueue(): Promise<WriteItem[]>;
  enqueueWrite(method: string, path: string, body: string | null, idempotencyKey: string, resourceKey?: string): Promise<WriteItem | null>;
  removeWriteItem(id: string): Promise<void>;
  retryWriteItem(id: string): Promise<void>;
  onSyncEvent(handler: (event: string, payload?: unknown) => void): Promise<UnlistenFn>;
}
