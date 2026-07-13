import { describe, expect, test } from "bun:test";
import { pendingCount, type QueueItem } from "../domain/entities/QueueItem";

const item = (status: QueueItem["status"]): QueueItem => ({
  id: "1", file_path: "/tmp/a.pdf", filename: "a.pdf", identifier: "TST-PROP-2026-0101-001",
  tenant_id: "t1", user_id: "u1", status, attempts: 0, last_error: null, created_at: new Date().toISOString(),
});

describe("pendingCount", () => {
  test("conta pending, uploading e failed", () => {
    expect(pendingCount([item("pending"), item("uploading"), item("failed"), item("uploaded")])).toBe(3);
  });
  test("ignora uploaded", () => { expect(pendingCount([item("uploaded")])).toBe(0); });
});
