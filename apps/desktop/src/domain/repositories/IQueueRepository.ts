import type { QueueItem } from "../entities/QueueItem";

export interface IQueueRepository {
  getItems(): QueueItem[];
  setItems(items: QueueItem[]): void;
  setOnline(online: boolean): void;
  getOnline(): boolean;
  setPanelOpen(open: boolean): void;
  getPanelOpen(): boolean;
}
