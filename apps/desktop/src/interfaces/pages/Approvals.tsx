import { useState, useEffect, useCallback } from "react";
import { api } from "../../infrastructure/di/container";
import { PageHeader, StatusChip, EmptyState } from "../components/docid-ui";
import { ThumbsUp, ThumbsDown } from "lucide-react";

interface ApprovalRow { id: string; type: string; status: string; notes: string | null; requestedAt: string; resolvedAt: string | null; sector: { id: string; name: string } | null; supervisor: { id: string; fullName: string } | null; requesterId: string | null; document: { id: string; uploadedBy: string | null; identifier: { identifier: string; category: { name: string } } | null } | null; }

export default function Approvals() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"pending" | "resolved">("pending");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const status = tab === "pending" ? "pending" : undefined;
      const params = status ? `?status=${status}` : "";
      const res = await api.get<{ data: ApprovalRow[] }>(`/approvals${params}`);
      setRows(res.data || []);
    } catch (err: any) { setError(err.message || "Erro ao carregar aprovações."); }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="Aprovações" description="Documentos pendentes de aprovação entre sectores" />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      <div className="mb-4 flex gap-2">
        <button onClick={() => setTab("pending")} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "pending" ? "bg-docid-primary text-white" : "border border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>Pendentes</button>
        <button onClick={() => setTab("resolved")} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "resolved" ? "bg-docid-primary text-white" : "border border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>Histórico</button>
      </div>
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-docid-muted">A carregar...</div>
        ) : rows.length === 0 ? (
          <EmptyState>{tab === "pending" ? "Nenhuma aprovação pendente." : "Nenhum histórico de aprovações."}</EmptyState>
        ) : rows.map(row => <ApprovalCard key={row.id} row={row} onResolved={load} />)}
      </div>
    </div>
  );
}

function ApprovalCard({ row, onResolved }: { row: ApprovalRow; onResolved: () => void }) {
  const [showResolve, setShowResolve] = useState(false);
  const [action, setAction] = useState<"approved" | "rejected">("approved");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleResolve = async () => {
    setError(""); setLoading(true);
    try {
      await api.patch(`/approvals/${row.id}`, { status: action, notes: notes || undefined });
      setShowResolve(false);
      onResolved();
    } catch (err: any) { setError(err.message || "Erro ao resolver aprovação."); } finally { setLoading(false); }
  };

  const label = row.type === "access_request" ? "Pedido de Acesso" : row.type === "cross_sector" ? "Partilha Cross-Sector" : "Aprovação";
  const docId = row.document?.identifier?.identifier || row.document?.id?.slice(0, 8) || "-";

  return (
    <div className="docid-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm font-semibold">{docId}</span>
            <StatusChip tone={row.status === "pending" ? "warning" : row.status === "approved" ? "success" : "error"}>
              {row.status === "pending" ? "Pendente" : row.status === "approved" ? "Aprovado" : "Rejeitado"}
            </StatusChip>
          </div>
          <p className="text-xs text-docid-muted">
            {label}
            {row.sector && <span> · Sector: {row.sector.name}</span>}
            {row.supervisor && <span> · Supervisor: {row.supervisor.fullName}</span>}
          </p>
          <p className="text-xs text-docid-muted mt-1">Pedido: {new Date(row.requestedAt).toLocaleString("pt-AO")}{row.resolvedAt && ` · Resolvido: ${new Date(row.resolvedAt).toLocaleString("pt-AO")}`}</p>
          {row.notes && <p className="mt-2 text-sm text-docid-muted italic">"{row.notes}"</p>}
        </div>
        {row.status === "pending" && !showResolve && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => { setAction("approved"); setShowResolve(true); }} className="docid-button-primary bg-docid-secondary"><ThumbsUp className="h-4 w-4" /> Aprovar</button>
            <button onClick={() => { setAction("rejected"); setShowResolve(true); }} className="docid-button-secondary text-docid-error"><ThumbsDown className="h-4 w-4" /> Rejeitar</button>
          </div>
        )}
      </div>

      {showResolve && (
        <div className="mt-4 rounded-lg border border-docid-border bg-docid-surface-low p-4 space-y-3">
          <p className="text-sm font-medium">{action === "approved" ? "Confirmar aprovação" : "Confirmar rejeição"}</p>
          {error && <p className="text-xs text-docid-error">{error}</p>}
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="docid-input w-full" rows={2} placeholder="Notas (opcional)..." />
          <div className="flex gap-2">
            <button onClick={() => setShowResolve(false)} className="docid-button-secondary flex-1">Voltar</button>
            <button onClick={handleResolve} disabled={loading} className={`docid-button-primary flex-1 ${action === "approved" ? "bg-docid-secondary" : "bg-docid-error text-white"}`}>
              {loading ? "A processar..." : action === "approved" ? "Aprovar" : "Rejeitar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
