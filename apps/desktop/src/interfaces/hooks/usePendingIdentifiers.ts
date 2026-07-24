import { useState, useCallback, useEffect } from "react";

export interface PendingIdentifier {
  id: string;
  idempotencyKey: string;
  categoryId: string;
  deviceId: string;
  identifier: string;
  sequence: number | null;
  leaseId: string | null;
  issuedTo: string | null;
  description: string | null;
  visibility: string;
  origin: string;
  sectorId: string;
  status: "pending" | "synced" | "conflict" | "failed";
  attempts: number;
  lastError: string | null;
  conflictReason: string | null;
  createdAt: string;
}

const CONFLICT_LABELS: Record<string, string> = {
  LEASE_FORCE_RELEASED: "Lease revogado por administrador",
  LEASE_EXPIRED: "Lease expirou",
  OUT_OF_ORDER: "Sequência fora de ordem",
  CATEGORY_CHANGED: "Categoria alterada",
  SERVER_REJECTED: "Rejeitado pelo servidor",
};

export function conflictLabel(reason: string | null): string {
  return reason ? CONFLICT_LABELS[reason] || reason : "";
}

export function usePendingIdentifiers() {
  const [items, setItems] = useState<PendingIdentifier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<PendingIdentifier[]>("get_pending_identifiers");
      setItems(result);
    } catch (e: any) {
      setError(e.message || "Erro ao carregar pendentes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const retryItem = useCallback(async (id: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("reset_pending_identifier", { id });
    await refresh();
  }, [refresh]);

  const deleteItem = useCallback(async (id: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_pending_identifier", { id });
    await refresh();
  }, [refresh]);

  const pendingCount = items.filter(i => i.status === "pending").length;
  const conflictCount = items.filter(i => i.status === "conflict").length;
  const failedCount = items.filter(i => i.status === "failed").length;

  return { items, loading, error, refresh, retryItem, deleteItem, pendingCount, conflictCount, failedCount };
}
