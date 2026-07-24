import { useState, useEffect, useCallback } from "react";
import { api } from "../../infrastructure/di/container";
import { PageHeader, Modal, EmptyState, Pagination } from "../components/docid-ui";
import { History, Search, Filter, ChevronDown, ChevronRight, User, Globe, Clock, Tag, Fingerprint, HardDrive, Info } from "lucide-react";

interface AuditLog {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: string | null;
  ip: string | null;
  createdAt: string;
}

interface Sector { id: string; name: string; }
interface User { id: string; fullName: string; }

const ACTIONS = ["GENERATE", "QUERY", "CANCEL", "SHARE", "REQUEST_ACCESS", "REVOKE_SHARE", "ATTACH", "ATTACH_FAILED"];
const RESOURCES = ["documents", "identifiers", "sectors", "users", "audit", "roles"];

function parseMeta(m: string | null): Record<string, any> {
  try { return m ? JSON.parse(m) : {}; } catch { return {}; }
}

function formatNarrative(log: AuditLog, sectorMap: Record<string, string>, userMap: Record<string, string>): string {
  const meta = parseMeta(log.metadata);
  const name = log.userName || "Utilizador desconhecido";

  switch (log.action) {
    case "GENERATE":
      return `${name} gerou o identificador ${meta.identifier || "—"}${meta.category ? ` (${meta.category})` : ""}`;
    case "QUERY":
      return `${name} consultou o identificador ${meta.identifier || log.resourceId || "—"}`;
    case "CANCEL":
      return `${name} cancelou o identificador ${meta.identifier || "—"}${meta.reason ? ` — motivo: ${meta.reason}` : ""}`;
    case "ATTACH":
      return `${name} anexou o ficheiro "${meta.filename || "—"}" ao identificador ${meta.identifier || "—"}`;
    case "ATTACH_FAILED":
      return `${name} tentou anexar "${meta.filename || "—"}", mas o identificador não foi encontrado no ficheiro`;
    case "SHARE": {
      const targetSector = meta.sharedWithSectorId ? sectorMap[meta.sharedWithSectorId] : null;
      const targetUser = meta.sharedWithUserId ? userMap[meta.sharedWithUserId] : null;
      if (targetSector) return `${name} partilhou um documento com o sector ${targetSector}`;
      if (targetUser) return `${name} partilhou um documento com ${targetUser}`;
      return `${name} partilhou um documento`;
    }
    case "REVOKE_SHARE":
      return `${name} revogou uma partilha de documento`;
    case "REQUEST_ACCESS":
      return `${name} solicitou acesso a um documento`;
    default:
      return `${name} realizou ${log.action} em ${log.resource}`;
  }
}

function toneIcon(action: string): string {
  if (action === "ATTACH_FAILED") return "🔴";
  if (action === "CANCEL" || action === "REVOKE_SHARE") return "🟡";
  if (action === "GENERATE" || action === "ATTACH" || action === "SHARE") return "🟢";
  return "🔵";
}

export default function Audit() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 50 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sectorMap, setSectorMap] = useState<Record<string, string>>({});
  const [userMap, setUserMap] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get<{ data: Sector[] }>("/sectors").then(r => {
      const m: Record<string, string> = {};
      (r.data || []).forEach(s => { m[s.id] = s.name; });
      setSectorMap(m);
    }).catch(() => {});
    api.get<{ data: User[] }>("/users").then(r => {
      const m: Record<string, string> = {};
      (r.data || []).forEach(u => { m[u.id] = u.fullName; });
      setUserMap(m);
    }).catch(() => {});
  }, []);

  const load = useCallback(async (page = 1) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (actionFilter) params.set("action", actionFilter);
      if (resourceFilter) params.set("resource", resourceFilter);
      const res = await api.get<{ data: AuditLog[]; meta: { total: number; page: number; limit: number } }>(`/audit?${params}`);
      setRows(res.data || []);
      setMeta(res.meta || { total: 0, page: 1, limit: 50 });
    } catch (err: any) { setError(err.message || "Erro ao carregar registos de auditoria."); }
    finally { setLoading(false); }
  }, [actionFilter, resourceFilter]);

  useEffect(() => { load(); }, [load]);

  const actionLabel = (a: string) => ({
    GENERATE: "Gerar", QUERY: "Consultar", CANCEL: "Cancelar",
    SHARE: "Partilhar", REQUEST_ACCESS: "Solicitar Acesso", REVOKE_SHARE: "Revogar Partilha",
    ATTACH: "Anexar", ATTACH_FAILED: "Falha Anexo",
  }[a] || a);

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
      <div className="space-y-3">
        {loading ? (
          <div className="docid-panel flex items-center justify-center py-16 text-sm text-docid-muted">A carregar...</div>
        ) : rows.length === 0 ? (
          <EmptyState>Nenhum registo de auditoria encontrado.</EmptyState>
        ) : (
          rows.map(row => {
            const metaData = parseMeta(row.metadata);
            const narrative = formatNarrative(row, sectorMap, userMap);
            const expanded = expandedId === row.id;
            return (
              <div key={row.id} className="docid-panel p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <span className="text-lg leading-none mt-0.5 shrink-0">{toneIcon(row.action)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-docid-text leading-relaxed">{narrative}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-docid-muted">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(row.createdAt).toLocaleString("pt-AO")}</span>
                      {row.ip && row.ip !== "unknown" && <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{row.ip}</span>}
                    </div>
                  </div>
                  <button onClick={() => setExpandedId(expanded ? null : row.id)} className="shrink-0 rounded p-1.5 text-docid-muted hover:text-docid-text hover:bg-docid-surface-high">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="sr-only">{expanded ? "Ocultar" : "Ver"} detalhes</span>
                  </button>
                </div>
                {expanded && (
                  <div className="ml-8 mt-2 rounded-lg border border-docid-border bg-docid-surface-low p-3 space-y-2 text-xs">
                    <p className="flex items-center gap-1.5 text-docid-muted font-semibold mb-2"><Info className="h-3 w-3" /> Detalhes técnicos</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                      <div className="flex items-center gap-1.5"><User className="h-3 w-3 shrink-0 text-docid-outline" /><span className="text-docid-muted">Utilizador:</span><span className="font-mono">{row.userId || "—"}</span></div>
                      <div className="flex items-center gap-1.5"><Tag className="h-3 w-3 shrink-0 text-docid-outline" /><span className="text-docid-muted">Acção:</span><span>{row.action}</span></div>
                      <div className="flex items-center gap-1.5"><HardDrive className="h-3 w-3 shrink-0 text-docid-outline" /><span className="text-docid-muted">Recurso:</span><span>{row.resource}</span></div>
                      <div className="flex items-center gap-1.5"><Fingerprint className="h-3 w-3 shrink-0 text-docid-outline" /><span className="text-docid-muted">ID do recurso:</span><span className="font-mono">{row.resourceId || "—"}</span></div>
                      <div className="flex items-center gap-1.5"><Globe className="h-3 w-3 shrink-0 text-docid-outline" /><span className="text-docid-muted">IP:</span><span>{row.ip || "—"}</span></div>
                      <div className="flex items-center gap-1.5"><Clock className="h-3 w-3 shrink-0 text-docid-outline" /><span className="text-docid-muted">Data/Hora:</span><span>{new Date(row.createdAt).toISOString()}</span></div>
                    </div>
                    {row.metadata && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-docid-muted hover:text-docid-text text-xs font-medium">Metadados completos</summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded bg-docid-surface p-2 text-[10px] text-docid-text font-mono whitespace-pre-wrap break-words">{JSON.stringify(metaData, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        <Pagination totalLabel={`${meta.total} registo(s) — Página ${meta.page}`} />
      </div>
    </div>
  );
}