import { useState } from "react";
import { api } from "../../infrastructure/di/container";
import { PageHeader, StatusChip, EmptyState, OfflineNotice } from "../components/docid-ui";
import { useOfflineCache } from "../hooks/useOfflineCache";
import { mapError } from "../../shared/errors/mapError";
import { ThumbsUp, ThumbsDown } from "lucide-react";

interface ApprovalRow { id: string; type: string; status: string; notes: string | null; requestedAt: string; resolvedAt: string | null; sector: { id: string; name: string } | null; supervisor: { id: string; fullName: string } | null; requesterId: string | null; document: { id: string; uploadedBy: string | null; identifier: { identifier: string; category: { name: string } } | null } | null; }

const TYPE_LABELS: Record<string, string> = {
  access_request: "Pedido de Acesso",
  cross_sector: "Partilha entre sectores",
};

function SkeletonApproval() {
  return (
    <div className="docid-panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="animate-pulse rounded bg-docid-surface-high h-4 w-1/3 font-mono" />
          <div className="animate-pulse rounded bg-docid-surface-high h-3 w-1/2 mt-1" />
        </div>
      </div>
      <div className="space-y-2 text-xs">
        {[1, 2, 3].map(index => (
          <div key={index} className="animate-pulse rounded bg-docid-surface-high h-3 w-2/3" />
        ))}
      </div>
    </div>
  );
}

export default function Approvals() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [tab, setTab] = useState<"pending" | "resolved">("pending");

  const listParams = tab === "pending" ? "status=pending" : "";

  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<ApprovalRow[]>({
    endpoint: "/approvals",
    params: listParams,
    fetcher: async () => {
      const status = tab === "pending" ? "pending" : undefined;
      const params = status ? `?status=${status}` : "";
      const res = await api.get<{ data: ApprovalRow[] }>(`/approvals${params}`);
      return res.data || [];
    },
    onData: setRows,
  });

  const pendingCount = rows.filter(r => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aprovações"
        description="Documentos pendentes de aprovação entre sectores"
        actions={
          <div className="flex gap-2">
            <button onClick={() => setTab("pending")} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "pending" ? "bg-docid-primary text-white" : "border border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>
              Pendentes {pendingCount > 0 && <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-docid-error px-1 text-[10px] font-bold text-white">{pendingCount}</span>}
            </button>
            <button onClick={() => setTab("resolved")} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "resolved" ? "bg-docid-primary text-white" : "border border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>
              Histórico
            </button>
          </div>
        }
      />
      {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 px-4 py-3 text-sm text-docid-error">{error}</div>}
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}
      <div className="space-y-3">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 p-6">
            {[...Array(3)].map((_, index) => <SkeletonApproval key={index} />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState>{tab === "pending" ? "Nenhuma aprovação pendente." : "Nenhum histórico de aprovações."}</EmptyState>
        ) : (
          <>
            {rows.map(row => <ApprovalCard key={row.id} row={row} onResolved={refresh} />)}
          </>
        )}
      </div>
    </div>
  );
}

function ApprovalCard({ row, onResolved }: { row: ApprovalRow; onResolved: () => void }) {
  const [showResolve, setShowResolve] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ApprovalRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [action, setAction] = useState<"approved" | "rejected">("approved");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleDetail = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true); setDetailError(""); setDetailLoading(true);
    try {
      const res = await api.get<{ data: ApprovalRow }>(`/approvals/${row.id}`);
      setDetail(res.data);
    } catch (err: unknown) {
      setDetailError(mapError(err, "Não foi possível carregar os detalhes."));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleResolve = async () => {
    setError(""); setLoading(true);
    try {
      await api.patch(`/approvals/${row.id}`, { status: action, notes: notes || undefined });
      setShowResolve(false);
      onResolved();
    } catch (err: any) { setError(mapError(err, "Não foi possível concluir a aprovação.")); } finally { setLoading(false); }
  };

  const label = row.type === "access_request" ? "Pedido de Acesso" : row.type === "cross_sector" ? "Partilha entre sectores" : "Aprovação";
  const docId = row.document?.identifier?.identifier || "Documento";

  const statusTone = row.status === "pending" ? "warning" as const : row.status === "approved" ? "success" as const : "error" as const;

  return (
    <div className="docid-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm font-semibold">{docId}</span>
            <StatusChip tone={statusTone}>
              {row.status === "pending" ? "Pendente" : row.status === "approved" ? "Aprovado" : "Rejeitado"}
            </StatusChip>
          </div>
          <p className="text-xs text-docid-muted">
            {label}
            {row.sector && <span> · Sector: {row.sector.name}</span>}
            {row.supervisor && <span> · Supervisor: {row.supervisor.fullName}</span>}
          </p>
          <p className="text-xs text-docid-muted mt-1">
            Pedido: {new Date(row.requestedAt).toLocaleString("pt-AO")}{row.resolvedAt && ` · Resolvido: ${new Date(row.resolvedAt).toLocaleString("pt-AO")}`}
          </p>
          {row.notes && <p className="mt-2 text-sm text-docid-muted italic">"{row.notes}"</p>}
          <button type="button" onClick={() => void toggleDetail()} className="mt-2 text-xs text-docid-primary underline">{expanded ? "Ocultar detalhe" : "Ver detalhe"}</button>
        </div>
        {row.status === "pending" && !showResolve && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => { setAction("approved"); setShowResolve(true); }} className="flex items-center gap-2 rounded-lg bg-docid-secondary px-3 py-2 text-sm font-medium text-white transition hover:brightness-110"><ThumbsUp className="h-4 w-4" /> Aprovar</button>
            <button onClick={() => { setAction("rejected"); setShowResolve(true); }} className="flex items-center gap-2 rounded-lg border border-docid-border px-3 py-2 text-sm font-medium text-docid-text transition hover:bg-docid-surface-high"><ThumbsDown className="h-4 w-4" /> Rejeitar</button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-4 rounded-lg border border-docid-border bg-docid-surface-low p-4 text-xs text-docid-muted">
          {detailLoading && <p>A carregar detalhe...</p>}
          {detailError && <p className="text-docid-error">{detailError}</p>}
          {detail && (
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-docid-outline">Tipo</p><p className="font-medium text-docid-text">{TYPE_LABELS[detail.type] ?? "Pedido"}</p></div>
              <div><p className="text-docid-outline">Requerente</p><p className="font-medium text-docid-text">{detail.requesterId ? "Utilizador da organização" : "Não identificado"}</p></div>
              <div><p className="text-docid-outline">Documento</p><p className="font-medium text-docid-text">{detail.document?.identifier?.identifier || "Documento"}</p></div>
              <div><p className="text-docid-outline">Categoria</p><p className="font-medium text-docid-text">{detail.document?.identifier?.category?.name || "Não indicada"}</p></div>
              <div><p className="text-docid-outline">Resolvido em</p><p className="font-medium text-docid-text">{detail.resolvedAt ? new Date(detail.resolvedAt).toLocaleString("pt-AO") : "-"}</p></div>
              <div><p className="text-docid-outline">Notas</p><p className="font-medium text-docid-text">{detail.notes || "-"}</p></div>
            </div>
          )}
        </div>
      )}

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
