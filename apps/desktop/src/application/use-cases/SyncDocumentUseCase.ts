import type { ISyncService } from "../ports/ISyncService";
import type { IQueueRepository } from "../../domain/repositories/IQueueRepository";

export class SyncDocumentUseCase {
  constructor(private readonly sync: ISyncService, private readonly queueRepo: IQueueRepository) {}
  async refreshQueue(): Promise<void> {
    const items = await this.sync.getQueue();
    this.queueRepo.setItems(items);
    await this.sync.clearUploaded().catch(() => {});
    this.queueRepo.setItems(await this.sync.getQueue());
  }
  async checkOnline(): Promise<void> { this.queueRepo.setOnline(await this.sync.isOnline()); }
  async forceSync(): Promise<void> { await this.sync.forceSync(); await this.refreshQueue(); }
  async retryItem(id: string): Promise<void> { await this.sync.retryItem(id); await this.refreshQueue(); }
  async removeItem(id: string): Promise<void> { await this.sync.removeItem(id); await this.refreshQueue(); }
}
