export type QueueItemStatus = "pending" | "uploading" | "uploaded" | "failed";

export interface QueueItem {
  id: string;
  file_path: string;
  filename: string;
  identifier: string;
  tenant_id: string;
  user_id: string;
  status: QueueItemStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export function pendingCount(items: QueueItem[]): number {
  return items.filter(i => i.status === "pending" || i.status === "uploading" || i.status === "failed").length;
}
