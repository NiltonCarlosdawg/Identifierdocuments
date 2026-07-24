import { useState, useCallback } from "react";
import { sync, api } from "../../infrastructure/di/container";

export interface GenerateInput {
  categoryId: string;
  issuedTo?: string;
  description?: string;
  origin: string;
  visibility: string;
  sectorId: string;
}

export interface GenerateResult {
  identifier: string;
  mode: "online" | "offline_fiscal" | "offline_loose";
}

function mapOfflineError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Lease revogado") || msg.includes("Lease não") || msg.includes("lease não")) {
    return "Lease revogado. Reconecte para obter um novo lease.";
  }
  if (msg.includes("esgotado") || msg.includes("sem lease") || msg.includes("sem lote") || msg.includes("sem reserva")) {
    return "Lote de números esgotado. Conecte-se à internet para reservar um novo lote antes de continuar a gerar offline.";
  }
  return msg;
}

export function useGenerateIdentifier() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);

  const generate = useCallback(async (input: GenerateInput): Promise<GenerateResult> => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (!sync.isAvailable()) {
        const res = await api.post<{ data: { identifier: string } }>("/identifiers/generate", {
          categoryId: input.categoryId,
          issuedTo: input.issuedTo || undefined,
          description: input.description || undefined,
          origin: input.origin,
          visibility: input.visibility,
          sectorId: input.sectorId,
        });
        const r: GenerateResult = { identifier: res.data.identifier, mode: "online" };
        setResult(r);
        return r;
      }

      if (await sync.isOnline()) {
        const res = await api.post<{ data: { identifier: string } }>("/identifiers/generate", {
          categoryId: input.categoryId,
          issuedTo: input.issuedTo || undefined,
          description: input.description || undefined,
          origin: input.origin,
          visibility: input.visibility,
          sectorId: input.sectorId,
        });
        const r: GenerateResult = { identifier: res.data.identifier, mode: "online" };
        setResult(r);
        return r;
      }

      const { invoke } = await import("@tauri-apps/api/core");
      const pending = await invoke<{
        identifier: string;
        sequence: number | null;
        lease_id: string | null;
      }>("generate_offline_identifier", {
        categoryId: input.categoryId,
        issuedTo: input.issuedTo || null,
        description: input.description || null,
        origin: input.origin,
        visibility: input.visibility,
        sectorId: input.sectorId,
      });

      const mode = pending.lease_id ? "offline_fiscal" : "offline_loose";
      const r: GenerateResult = { identifier: pending.identifier, mode };
      setResult(r);
      return r;
    } catch (err) {
      const message = mapOfflineError(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  return { generate, loading, error, result, clearError, reset };
}
