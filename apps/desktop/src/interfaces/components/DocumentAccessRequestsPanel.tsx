import { useCallback, useEffect, useState } from "react";
import { api } from "../../infrastructure/di/container";
import { StatusChip } from "./docid-ui";
import { mapError } from "../../shared/errors/mapError";
import { useAuthStore } from "../stores/authStore";

interface AccessRequest {
  id: string;
  status: string;
  resolvedAt: string | null;
  createdAt: string;
  requesterId: string;
  requester: { id: string; fullName: string } | null;
  resolver: { id: string; fullName: string } | null;
}

/** Pedidos de acesso a um documento (separador "Pedidos" do painel de documentos). */
interface Props { identifier: string; onChanged?: () => void; }

const STATUS_LABELS: Record<string, string> = { pending: "Pendente", approved: "Aprovado", denied: "Negado", cancelled: "Cancelado" };
const STATUS_TONES: Record<string, "success" | "warning" | "error" | "neutral"> = { pending: "warning", approved: "success", denied: "error", cancelled: "neutral" };

export default function DocumentAccessRequestsPanel({ identifier, onChanged }: Props) {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const user = useAuthStore(s => s.user);
  const endpoint = `/documents/${encodeURIComponent(identifier)}/access-requests`;
  const canResolve = !!user?.roles.some(r => r === "ORG_ADMIN" || r === "SECTOR_SUPERVISOR");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await api.get<{ data: AccessRequest[] }>(endpoint);
      setRequests(res.data || []);
    } catch (err) {
      setError(mapError(err, "Não foi possível carregar os pedidos de acesso."));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);

  const resolve = async (request: AccessRequest, status: "approved" | "denied") => {
    setBusyId(request.id); setError("");
    try {
      const res = await api.patch<{ data: AccessRequest }>(`${endpoint}/${request.id}`, { status, notes: notes[request.id]?.trim() || undefined });
      setRequests(prev => prev.map(r => r.id === res.data.id ? { ...r, ...res.data } : r));
      onChanged?.();
    } catch (err) {
      setError(mapError(err, "Não foi possível responder ao pedido de acesso."));
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (request: AccessRequest) => {
    setBusyId(request.id); setError("");
    try {
      const res = await api.post<{ data: AccessRequest }>(`${endpoint}/${request.id}/cancel`, {});
      setRequests(prev => prev.map(r => r.id === res.data.id ? { ...r, ...res.data } : r));
      onChanged?.();
    } catch (err) {
      setError(mapError(err, "Não foi possível cancelar o pedido."));
    } finally {
      setBusyId(null);
    }
  };

  return (
      <div className="space-y-4" data-testid="document-access-requests">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        {loading ? (
          <p className="text-sm text-docid-muted">A carregar pedidos...</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-docid-muted">Não há pedidos de acesso a este documento.</p>
        ) : (
          <ul className="space-y-3">
            {requests.map(request => (
              <li key={request.id} className="rounded-lg border border-docid-outline/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-docid-text">{request.requester?.fullName || "Requerente"}</p>
                      <StatusChip tone={STATUS_TONES[request.status] || "neutral"}>{STATUS_LABELS[request.status] ?? "Por confirmar"}</StatusChip>
                    </div>
                    <p className="mt-1 text-[11px] text-docid-muted">
                      {new Date(request.createdAt).toLocaleString("pt-AO")}
                      {request.resolvedAt && ` · resolvido em ${new Date(request.resolvedAt).toLocaleString("pt-AO")}`}
                      {request.resolver && ` · por ${request.resolver.fullName}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {canResolve && request.status === "pending" && (
                      <>
                        <button type="button" onClick={() => void resolve(request, "approved")} disabled={busyId === request.id} className="docid-button-secondary text-xs">Aprovar</button>
                        <button type="button" onClick={() => void resolve(request, "denied")} disabled={busyId === request.id} className="docid-button-secondary text-xs text-docid-error">Negar</button>
                      </>
                    )}
                    {request.requesterId === user?.id && request.status === "pending" && (
                      <button type="button" onClick={() => void cancel(request)} disabled={busyId === request.id} className="docid-button-secondary text-xs">Cancelar</button>
                    )}
                  </div>
                </div>
                {canResolve && request.status === "pending" && (
                  <input
                    value={notes[request.id] || ""}
                    onChange={e => setNotes(prev => ({ ...prev, [request.id]: e.target.value }))}
                    className="docid-input mt-2 w-full text-xs"
                    placeholder="Notas (opcional)..."
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
  );
}
