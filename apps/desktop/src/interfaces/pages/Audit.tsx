import { useState, useEffect, useCallback } from "react";
import { api } from "../../infrastructure/di/container";
import { PageHeader, Modal, StatusChip, EmptyState, Pagination } from "../components/docid-ui";
import { History, Search, Filter, ChevronDown, ChevronRight } from "lucide-react";

interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: string | null;
  ip: string | null;
  createdAt: string;
}

const ACTIONS = ["GENERATE", "QUERY", "CANCEL", "SHARE", "REQUEST_ACCESS", "REVOKE_SHARE", "ATTACH", "ATTACH_FAILED"];
const RESOURCES = ["documents", "identifiers", "sectors", "users", "audit", "roles"];

export default function Audit() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 50 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (page = 1) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (actionFilter) params.set("action", actionFilter);
      if (resourceFilter) params.set("resource", resourceFilter);
      const res = await api.get<{ data: AuditLog[]; meta: { total: number; page: number; limit: number } }>(`/audit?${params}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (err: any) { setError(err.message || "Erro ao carregar registos de auditoria."); }
    finally { setLoading(false); }
  }, [actionFilter, resourceFilter]);

  useEffect(() => { load(); }, [load]);

  const actionLabel = (a: string) => ({
    GENERATE: "Gerar", QUERY: "Consultar", CANCEL: "Cancelar",
    SHARE: "Partilhar", REQUEST_ACCESS: "Solicitar Acesso", REVOKE_SHARE: "Revogar Partilha",
    ATTACH: "Anexar", ATTACH_FAILED: "Falha Anexo",
  }[a] || a);

  const actionTone = (a: string): "success" | "warning" | "error" | "info" | "neutral" => {
    if (a === "ATTACH_FAILED") return "error";
    if (a === "CANCEL" || a === "REVOKE_SHARE") return "warning";
    if (a === "GENERATE" || a === "ATTACH" || a === "SHARE") return "success";
    return "info";
  };

  return (
    <div>
      <PageHeader title="Auditoria" description="Registo de todas as acções realizadas na organização" />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" />
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="docid-input w-full pl-9 text-sm appearance-none">
            <option value="">Todas as acções</option>
            {ACTIONS.map(a => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
        </div>
        <select value={resourceFilter} onChange={e => setResourceFilter(e.target.value)} className="docid-input w-44 text-sm">
          <option value="">Todos os recursos</option>
          {RESOURCES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <span className="text-xs text-docid-muted">{meta.total} registo(s)</span>
      </div>
      <div className="docid-panel overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-docid-muted">A carregar...</div>
        ) : rows.length === 0 ? (
          <EmptyState>Nenhum registo de auditoria encontrado.</EmptyState>
        ) : (
          <table className="docid-table">
            <thead>
              <tr>
                <th className="w-40">Data/Hora</th>
                <th className="w-20">Utilizador</th>
                <th className="w-28">Acção</th>
                <th className="w-24">Recurso</th>
                <th>ID do Recurso</th>
                <th className="w-28">IP</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="text-xs whitespace-nowrap">{new Date(row.createdAt).toLocaleString("pt-AO")}</td>
                  <td className="text-xs font-mono">{row.userId ? row.userId.slice(0, 8) + "…" : "—"}</td>
                  <td><StatusChip tone={actionTone(row.action)}>{actionLabel(row.action)}</StatusChip></td>
                  <td className="text-xs text-docid-muted">{row.resource}</td>
                  <td className="text-xs font-mono max-w-[200px] truncate" title={row.resourceId || ""}>{row.resourceId || "—"}</td>
                  <td className="text-xs text-docid-muted">{row.ip || "—"}</td>
                  <td>
                    {row.metadata && (
                      <button onClick={() => setExpanded(expanded === row.id ? null : row.id)} className="rounded p-1 text-docid-muted hover:text-docid-text">
                        {expanded === row.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination totalLabel={`${meta.total} registo(s) — Página ${meta.page}`} />
      </div>
      {expanded && (() => {
        const log = rows.find(r => r.id === expanded);
        if (!log?.metadata) return null;
        try {
          const parsed = JSON.parse(log.metadata);
          return (
            <Modal title="Detalhes do Registo" onClose={() => setExpanded(null)} maxWidth="max-w-lg">
              <pre className="max-h-96 overflow-auto rounded-lg bg-docid-surface-low p-4 text-xs text-docid-text whitespace-pre-wrap break-words font-mono">{JSON.stringify(parsed, null, 2)}</pre>
            </Modal>
          );
        } catch {
          return (
            <Modal title="Detalhes do Registo" onClose={() => setExpanded(null)} maxWidth="max-w-lg">
              <pre className="max-h-96 overflow-auto rounded-lg bg-docid-surface-low p-4 text-xs text-docid-text whitespace-pre-wrap break-words font-mono">{log.metadata}</pre>
            </Modal>
          );
        }
      })()}
    </div>
  );
}
