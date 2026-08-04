export type WriteMethod = "POST" | "PATCH" | "PUT" | "DELETE";
export type WriteItemStatus = "pending" | "applying" | "done" | "failed" | "conflict";

export interface WriteItem {
  id: string;
  method: WriteMethod;
  path: string;
  body: string | null;
  idempotency_key: string;
  resource_key: string | null;
  status: WriteItemStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export function activeWriteCount(items: WriteItem[]): number {
  return items.filter(i => i.status !== "done").length;
}
