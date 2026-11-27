import { useCallback, useEffect, useState } from "react";
import { api } from "../../infrastructure/di/container";
import { StatusChip } from "./docid-ui";
import { mapError } from "../../shared/errors/mapError";

interface Share {
  id: string;
  status: string | null;
  revokedAt: string | null;
  sourceRequestId: string | null;
  createdAt: string;
  sharer: { id: string; fullName: string } | null;
  user: { id: string; fullName: string } | null;
  sector: { id: string; name: string } | null;
}

/** Partilhas de um documento (separador "Partilhas" do painel de documentos). */
interface Props { identifier: string; onChanged?: () => void; }

export default function DocumentSharesPanel({ identifier, onChanged }: Props) {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const endpoint = `/documents/${encodeURIComponent(identifier)}/shares`;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await api.get<{ data: Share[] }>(endpoint);
      setShares(res.data || []);
    } catch (err) {
      setError(mapError(err, "Erro ao carregar partilhas."));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);

  const handleRevoke = async (share: Share) => {
    setBusyId(share.id); setError("");
    try {
      const res = await api.patch<{ data: { id: string; revokedAt: string } }>(`${endpoint}/${share.id}/revoke`, {});
      setShares(prev => prev.map(s => s.id === res.data.id ? { ...s, revokedAt: res.data.revokedAt, status: "revoked" } : s));
      onChanged?.();
    } catch (err) {
      setError(mapError(err, "Erro ao revogar partilha."));
    } finally {
      setBusyId(null);
    }
  };

  return (
      <div className="space-y-4" data-testid="document-shares">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        {loading ? (
          <p className="text-sm text-docid-muted">A carregar partilhas...</p>
        ) : shares.length === 0 ? (
          <p className="text-sm text-docid-muted">Este documento ainda não foi partilhado.</p>
        ) : (
          <ul className="space-y-2">
            {shares.map(share => {
              const revoked = !!share.revokedAt || share.status === "revoked";
              return (
                <li key={share.id} className="flex items-center justify-between gap-3 rounded-lg border border-docid-outline/20 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-docid-text">{share.user?.fullName || share.sector?.name || "—"}</p>
                      <StatusChip tone={revoked ? "error" : "success"}>{revoked ? "Revogada" : "Activa"}</StatusChip>
                    </div>
                    <p className="mt-1 text-[11px] text-docid-muted">
                      Por {share.sharer?.fullName || "—"} · {new Date(share.createdAt).toLocaleString("pt-AO")}
                      {share.sourceRequestId && " · pedido de acesso"}
                      {share.revokedAt && ` · revogada em ${new Date(share.revokedAt).toLocaleString("pt-AO")}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRevoke(share)}
                    disabled={revoked || busyId === share.id}
                    className="docid-button-secondary shrink-0 text-xs text-docid-error"
                  >
                    {busyId === share.id ? "A revogar..." : "Revogar"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
  );
}
