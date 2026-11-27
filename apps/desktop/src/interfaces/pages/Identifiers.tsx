import { useState, useEffect, useRef } from "react";
import { api, sync } from "../../infrastructure/di/container";
import { useGenerateIdentifier } from "../hooks/useGenerateIdentifier";
import { usePendingIdentifiers, conflictLabel } from "../hooks/usePendingIdentifiers";
import { useOfflineCache } from "../hooks/useOfflineCache";
import { mapError, friendlyStatus, friendlyMessage } from "../../shared/errors/mapError";
import { useAuthStore } from "../stores/authStore";
import { PageHeader, Modal, StatusChip, EmptyState, OfflineNotice } from "../components/docid-ui";
import { Fingerprint, Plus, Copy, Ban, Search, WifiOff, RefreshCw, AlertTriangle, Trash2, RotateCcw, Clock, Smartphone, Lock, Globe, Monitor, FileText, ChevronDown } from "lucide-react";

interface Category { id: string; name: string; group: string; prefix: string; requiresSequential: boolean; }
interface IdentifierRow { id: string; identifier: string; categoryId: string; category: { id: string; name: string; group: string; prefix: string }; status: string; origin: string; visibility: string; issuedTo: string | null; description: string | null; createdAt: string; sector: { id: string; name: string } | null; document: { id: string; filename: string } | null; createdByUser: { id: string; fullName: string } | null; restricted?: boolean; }

const STATUS_TONES: Record<string, "success" | "warning" | "error" | "info" | "neutral"> = {
  draft: "neutral",
  active: "success",
  attached: "info",
  cancelled: "error",
};

function SkeletonLine({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-docid-surface-high ${className}`} />;
}

function SkeletonRow() {
  return (
    <div className="docid-panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <SkeletonLine className="h-3 w-1/2 font-mono" />
          <SkeletonLine className="h-3 w-1/3 mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        {[1, 2, 3].map(index => (
          <div key={index}><SkeletonLine className="h-3 w-1/3" /></div>
        ))}
      </div>
    </div>
  );
}

export default function Identifiers() {
  const [view, setView] = useState<"server" | "pending">("server");
  const [rows, setRows] = useState<IdentifierRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20 });
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOrigin, setFilterOrigin] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [selected, setSelected] = useState<IdentifierRow | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");

  const { items: pendingItems, loading: pendingLoading, error: pendingError, refresh: refreshPending, retryItem, deleteItem, pendingCount, conflictCount, failedCount } = usePendingIdentifiers();
  const pendingTotal = pendingCount + conflictCount + failedCount;

  const listParams = (() => {
    const p = new URLSearchParams({ page: "1", limit: "20" });
    if (filterStatus) p.set("status", filterStatus);
    if (filterOrigin) p.set("origin", filterOrigin);
    return p.toString();
  })();

  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<{ data: IdentifierRow[]; meta: { total: number; page: number; limit: number } }>({
    endpoint: "/identifiers",
    params: listParams,
    enabled: view === "server",
    fetcher: async () => {
      const res = await api.get<{ data: IdentifierRow[]; meta: { total: number; page: number; limit: number } }>(`/identifiers?${listParams}`);
      return { data: res.data || [], meta: res.meta || { total: 0, page: 1, limit: 20 } };
    },
    onData: result => { setRows(result.data); setMeta(result.meta); },
  });

  useOfflineCache<Category[]>({
    endpoint: "/categories",
    fetcher: async () => {
      const res = await api.get<{ data: { groups: Record<string, Category[]> } }>("/categories");
      const all: Category[] = [];
      for (const g of Object.values(res.data?.groups || {})) all.push(...g);
      if (sync.isAvailable()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("cache_categories", { categories: all.map(c => ({ category_id: c.id, prefix: c.prefix, requires_sequential: c.requiresSequential })) });
        } catch { /* best effort — o sync também sementeia */ }
      }
      return all;
    },
    onData: setCategories,
  });

  const filteredRows = rows.filter(r => !search || r.identifier.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Identificadores"
        description="Gere e consulte os identificadores únicos dos documentos"
        actions={
          <button onClick={() => setShowGenerate(true)} className="docid-button-primary"><Plus className="h-4 w-4" /> Gerar identificador</button>
        }
      />
      {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 px-4 py-3 text-sm text-docid-error">{error}</div>}
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}

      {/* View tabs */}
      <div className="mb-4 flex gap-1 border-b border-docid-border">
        <button onClick={() => setView("server")} className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${view === "server" ? "border-docid-primary text-docid-primary-soft" : "border-transparent text-docid-muted hover:text-docid-text"}`}>
          Servidor
          <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-docid-surface-high px-1.5 text-[10px] font-bold text-docid-text">{meta.total}</span>
        </button>
        <button onClick={() => setView("pending")} className={`relative px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${view === "pending" ? "border-docid-primary text-docid-primary-soft" : "border-transparent text-docid-muted hover:text-docid-text"}`}>
          Pendentes
          {pendingTotal > 0 && <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{pendingTotal}</span>}
        </button>
      </div>

      {view === "server" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input value={search} onChange={e => setSearch(e.target.value)} className="docid-input w-full pl-9" placeholder="Pesquisar identificador..." /></div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="docid-input w-40"><option value="">Todos os estados</option><option value="active">Activo</option><option value="attached">Associado</option><option value="cancelled">Cancelado</option><option value="draft">Rascunho</option></select>
            <select value={filterOrigin} onChange={e => setFilterOrigin(e.target.value)} className="docid-input w-40"><option value="">Todas as origens</option><option value="digital">Digital</option><option value="physical">Físico</option></select>
          </div>

          <div className="docid-panel overflow-hidden">
            {loading ? (
              <div className="grid grid-cols-1 gap-3 p-6">
                {[...Array(4)].map((_, index) => <SkeletonRow key={index} />)}
              </div>
            ) : filteredRows.length === 0 ? (
              <EmptyState>Nenhum identificador encontrado.</EmptyState>
            ) : (
              <>
                <table className="docid-table">
                  <thead>
                    <tr>
                      <th className="w-48">Identificador</th>
                      <th>Categoria</th>
                      <th className="w-32">Estado</th>
                      <th className="w-24">Origem</th>
                      <th className="w-32">Sector</th>
                      <th className="w-32">Criado em</th>
                      <th className="w-24 text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(row => (
                      <tr key={row.id} className="cursor-pointer hover:bg-docid-surface-high transition-colors" onClick={() => setSelected(row)}>
                        <td className="font-mono text-xs font-medium text-docid-text">{row.identifier}{row.restricted && <span className="ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-docid-tertiary/10 px-1 text-[10px] font-bold text-docid-tertiary" title="Restrito"><Lock className="h-2.5 w-2.5" /></span>}</td>
                        <td className="text-xs text-docid-text">{row.category?.name || "Categoria"}</td>
                        <td><StatusChip tone={STATUS_TONES[row.status] ?? "neutral"}>{friendlyStatus(row.status)}</StatusChip></td>
                        <td className="text-xs">{row.origin === "digital" ? <span className="inline-flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5 text-docid-muted" /> Digital</span> : <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-docid-muted" /> Físico</span>}</td>
                        <td className="text-xs text-docid-muted">{row.sector?.name || "-"}</td>
                        <td className="text-xs text-docid-muted">{new Date(row.createdAt).toLocaleDateString("pt-AO")}</td>
                        <td className="text-right"><button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(row.identifier); }} className="rounded p-1 text-docid-muted hover:text-docid-text hover:bg-docid-surface-high transition-colors" title="Copiar identificador"><Copy className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-4 flex items-center justify-between border-t border-docid-border px-4 py-3 text-sm text-docid-muted">
                  <span>{meta.total} identificadores</span>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <PendingPanel
          items={pendingItems}
          loading={pendingLoading}
          error={pendingError}
          onRefresh={refreshPending}
          onRetry={retryItem}
          onDelete={deleteItem}
          pendingCount={pendingCount}
          conflictCount={conflictCount}
          failedCount={failedCount}
        />
      )}

      {showGenerate && <GenerateModal categories={categories} onClose={() => setShowGenerate(false)} onDone={() => { setShowGenerate(false); refresh(); refreshPending(); }} />}
      {selected && <DetailModal row={selected} onClose={() => setSelected(null)} onCancelled={() => { setSelected(null); refresh(); }} />}
    </div>
  );
}

function PendingPanel({ items, loading, error, onRefresh, onRetry, onDelete, pendingCount, conflictCount, failedCount }: {
  items: import("../hooks/usePendingIdentifiers").PendingIdentifier[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  pendingCount: number;
  conflictCount: number;
  failedCount: number;
}) {
  const [filter, setFilter] = useState<"all" | "pending" | "conflict" | "failed">("all");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = filter === "all" ? items : items.filter(i => i.status === filter);

  const handleRetry = async (id: string) => {
    setRetrying(id);
    try { await onRetry(id); } finally { setRetrying(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem a certeza? Este identificador será removido deste dispositivo. Se ainda não foi sincronizado, não poderá ser recuperado.")) return;
    setDeleting(id);
    try { await onDelete(id); } finally { setDeleting(null); }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}

      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-docid-surface-low p-0.5">
          {(["all", "pending", "conflict", "failed"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${filter === f ? "bg-docid-surface text-docid-text shadow-sm" : "text-docid-muted hover:text-docid-text"}`}>
              {f === "all" ? "Todos" : f === "pending" ? "Pendentes" : f === "conflict" ? "Conflitos" : "Falhados"}
              {f === "all" && items.length > 0 && <span className="ml-1.5 text-docid-muted">({items.length})</span>}
              {f === "pending" && pendingCount > 0 && <span className="ml-1.5 text-docid-muted">({pendingCount})</span>}
              {f === "conflict" && conflictCount > 0 && <span className="ml-1.5 text-docid-muted">({conflictCount})</span>}
              {f === "failed" && failedCount > 0 && <span className="ml-1.5 text-docid-muted">({failedCount})</span>}
            </button>
          ))}
        </div>
        <button onClick={onRefresh} className="docid-button-secondary text-xs" disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 p-6">
          {[...Array(3)].map((_, index) => <SkeletonRow key={index} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="docid-panel flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Smartphone className="h-10 w-10 text-docid-outline opacity-60" />
          <p className="text-sm text-docid-muted">Nenhum identificador pendente.</p>
          <p className="text-xs text-docid-muted">Os identificadores gerados offline aparecerão aqui até serem sincronizados.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => (
            <div key={item.id} className="docid-panel p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-docid-text">{item.identifier}</span>
                    <StatusChip tone={item.status === "pending" ? "neutral" : item.status === "conflict" ? "warning" : "error"}>
                      {item.status === "pending" ? "Pendente" : item.status === "conflict" ? "Conflito" : "Falhado"}
                    </StatusChip>
                  </div>
                  <p className="mt-1 text-xs text-docid-muted">
                    Identificador gerado neste dispositivo
                    {item.issuedTo && <> · {item.issuedTo}</>}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-docid-muted">{new Date(item.createdAt).toLocaleDateString("pt-AO")}</span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div><span className="text-docid-muted block">Tentativas</span><p className="font-medium text-docid-text">{item.attempts}/3</p></div>
                <div><span className="text-docid-muted block">Origem</span><p className="font-medium text-docid-text">{item.origin === "digital" ? "Digital" : "Físico"}</p></div>
                <div><span className="text-docid-muted block">Criado em</span><p className="font-medium text-docid-text">{new Date(item.createdAt).toLocaleDateString("pt-AO")}</p></div>
              </div>

              {item.status === "conflict" && item.conflictReason && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-amber-500">{conflictLabel(item.conflictReason)}</p>
                    {item.lastError && <p className="mt-0.5 text-xs text-docid-muted">{friendlyMessage(item.lastError, "A sincronização falhou. Tentaremos novamente.")}</p>}
                  </div>
                </div>
              )}

              {item.status === "failed" && item.lastError && (
                <div className="flex items-start gap-2 rounded-lg border border-docid-error/20 bg-docid-error/5 p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-docid-error mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-docid-error">Não foi possível sincronizar</p>
                    <p className="mt-0.5 text-xs text-docid-muted">{friendlyMessage(item.lastError, "Tentaremos novamente mais tarde.")}</p>
                  </div>
                </div>
              )}

              {item.status === "pending" && item.lastError && (
                <div className="flex items-start gap-2 rounded-lg border border-docid-border/20 bg-docid-surface-low p-3">
                  <Clock className="h-4 w-4 shrink-0 text-docid-muted mt-0.5" />
                  <p className="text-xs text-docid-muted">{friendlyMessage(item.lastError, "Aguardando nova tentativa de sincronização.")}</p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {(item.status === "conflict" || item.status === "failed") && (
                  <button onClick={() => handleRetry(item.id)} disabled={retrying === item.id}
                    className="docid-button-secondary text-xs">
                    <RotateCcw className={`h-3 w-3 ${retrying === item.id ? "animate-spin" : ""}`} />
                    {retrying === item.id ? "A sincronizar..." : "Sincronizar"}
                  </button>
                )}
                <button onClick={() => handleDelete(item.id)} disabled={deleting === item.id}
                  className="docid-button-secondary text-xs text-docid-error border-docid-error/30 hover:bg-docid-error/10">
                  <Trash2 className="h-3 w-3" />
                  {deleting === item.id ? "A remover..." : "Remover"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryCombobox({ categories, value, onChange }: { categories: Category[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const selected = categories.find(c => c.id === value) || null;
  const q = query.trim().toLowerCase();
  const matches = q
    ? categories.filter(c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
    : categories;
  const groups = matches.reduce<Record<string, Category[]>>((acc, c) => { (acc[c.group] = acc[c.group] || []).push(c); return acc; }, {});

  const select = (id: string) => { onChange(id); setOpen(false); setQuery(""); };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="docid-input flex w-full items-center justify-between gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? "text-docid-text" : "text-docid-muted"}>
          {selected ? selected.name : "Seleccionar categoria..."}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-docid-outline transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-docid-border bg-docid-surface shadow-lg">
          <div className="border-b border-docid-border p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-docid-outline" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Escape") { setOpen(false); setQuery(""); }
                  if (e.key === "Enter") { e.preventDefault(); const first = matches[0]; if (first) select(first.id); }
                }}
                placeholder="Pesquisar por nome ou grupo..."
                className="docid-input w-full py-1.5 pl-8 text-xs"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1" role="listbox">
            {matches.length === 0 && (
              <p className="px-3 py-2 text-xs text-docid-muted">Nenhuma categoria encontrada.</p>
            )}
            {Object.entries(groups).map(([group, cats]) => (
              <div key={group}>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-docid-outline">{group}</p>
                {cats.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => select(c.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-sm transition ${c.id === value ? "bg-docid-primary/10 text-docid-primary-soft" : "text-docid-text hover:bg-docid-surface-high"}`}
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-docid-muted">{c.prefix}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GenerateModal({ categories, onClose, onDone }: { categories: Category[]; onClose: () => void; onDone: () => void }) {
  const [categoryId, setCategoryId] = useState("");
  const [issuedTo, setIssuedTo] = useState("");
  const [description, setDescription] = useState("");
  const [origin, setOrigin] = useState<"digital" | "physical">("digital");
  const [visibility, setVisibility] = useState<"public" | "sector_only">("sector_only");
  const { generate, loading, error, result, clearError, reset } = useGenerateIdentifier();
  const user = useAuthStore(s => s.user);
  const [isOffline, setIsOffline] = useState(false);
  const [leaseRevoked, setLeaseRevoked] = useState(false);
  const isHr = categories.find(c => c.id === categoryId)?.group === "RH";
  const [hrNames, setHrNames] = useState<string[]>([]);
  useEffect(() => {
    if (!isHr || hrNames.length) return;
    api.get<{ data: Array<{ name: string; key: string }> }>("/documents/profiles")
      .then(r => setHrNames((r.data || []).filter(p => p.name).map(p => p.name)))
      .catch(() => {});
  }, [isHr, hrNames.length]);

  useEffect(() => {
    (async () => {
      if (!sync.isAvailable()) { setIsOffline(false); return; }
      setIsOffline(!(await sync.isOnline()));
    })();
  }, []);

  const handleGenerate = async () => {
    if (!categoryId) return;
    clearError();
    setLeaseRevoked(false);
    try {
      await generate({
        categoryId,
        issuedTo: issuedTo || undefined,
        description: description || undefined,
        origin,
        visibility,
        sectorId: user?.sectorId || "",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Lease revogado")) {
        setLeaseRevoked(true);
      }
    }
  };

  const handleReconnect = async () => {
    setIsOffline(!(await sync.isOnline()));
    if (sync.isAvailable() && await sync.isOnline()) {
      clearError();
      setLeaseRevoked(false);
    }
  };

  if (result) return (
    <Modal title="Identificador Gerado" onClose={onClose} footer={<button onClick={() => { reset(); onDone(); }} className="docid-button-primary">Fechar</button>}>
      <div className="flex flex-col items-center gap-4 py-6">
        <Fingerprint className="h-12 w-12 text-docid-primary-soft" />
        <p className="font-mono text-xl font-bold text-docid-text">{result.identifier}</p>
        {result.mode === "offline_loose" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-500">
            <WifiOff className="h-3.5 w-3.5" /> Provisório — confirmado após sincronização
          </span>
        )}
        {result.mode === "offline_fiscal" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-500">
            Nº reservado offline
          </span>
        )}
        <p className="text-sm text-docid-muted">Copie o identificador e inclua-o no documento antes de anexar.</p>
        <button onClick={() => navigator.clipboard.writeText(result.identifier)} className="docid-button-secondary">
          <Copy className="h-4 w-4" /> Copiar
        </button>
      </div>
    </Modal>
  );

  return (
    <Modal title="Gerar Identificador" onClose={onClose} footer={
      leaseRevoked ? (
        <button onClick={handleReconnect} className="docid-button-primary">
          <RefreshCw className="h-4 w-4" /> Reconectar e tentar de novo
        </button>
      ) : (
        <><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleGenerate} disabled={loading || !categoryId} className="docid-button-primary">{loading ? "A gerar..." : "Gerar"}</button></>
      )
    }>
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">
            {error}
            {leaseRevoked && (
              <button onClick={handleReconnect} className="ml-2 underline text-xs">Reconectar</button>
            )}
          </div>
        )}
        {isOffline && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500 flex items-center gap-2">
            <WifiOff className="h-4 w-4 shrink-0" /> Modo offline — identificadores serão gerados localmente e sincronizados depois.
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Categoria</label>
          <CategoryCombobox
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
          />
          {categoryId && !categories.find(c => c.id === categoryId)?.requiresSequential && isOffline && (
            <p className="mt-1 text-xs text-amber-500">* Sequência provisória até sincronizar.</p>
          )}
        </div>
        {/* Em RH o nome do colaborador agrupa os documentos em Documentos › Perfis RH. */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">{isHr ? "Colaborador" : "Emitido para"}</label>
          <input value={issuedTo} onChange={e => setIssuedTo(e.target.value)} className="docid-input w-full" data-testid="generate-issued-to"
            list={isHr ? "hr-collaborators" : undefined} autoComplete="off"
            placeholder={isHr ? "Nome completo do colaborador" : "Nome do cliente/destinatário (opcional)"} />
          {isHr && <datalist id="hr-collaborators">{hrNames.map(n => <option key={n} value={n} />)}</datalist>}
          {isHr && <p className="mt-1 text-[11px] text-docid-muted">Escreva sempre o mesmo nome: é ele que junta os documentos no perfil do colaborador (Documentos › Perfis RH).</p>}
        </div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Descrição</label><textarea value={description} onChange={e => setDescription(e.target.value)} className="docid-input w-full" rows={2} placeholder="Descrição opcional" /></div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Visibilidade</label>
          <div className="flex gap-2">
            <button onClick={() => setVisibility("sector_only")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${visibility === "sector_only" ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}><Lock className="h-4 w-4" /> Apenas sector</button>
            <button onClick={() => setVisibility("public")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${visibility === "public" ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}><Globe className="h-4 w-4" /> Público</button>
          </div>
        </div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Origem</label><div className="flex gap-2"><button onClick={() => setOrigin("digital")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${origin === "digital" ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}><Monitor className="h-4 w-4" /> Digital</button><button onClick={() => setOrigin("physical")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${origin === "physical" ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}><FileText className="h-4 w-4" /> Físico</button></div></div>
      </div>
    </Modal>
  );
}

function DetailModal({ row, onClose, onCancelled }: { row: IdentifierRow; onClose: () => void; onCancelled: () => void }) {
  const [detail, setDetail] = useState<IdentifierRow>(row);
  const [detailError, setDetailError] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.get<{ data: IdentifierRow }>(`/identifiers/${encodeURIComponent(row.identifier)}`)
      .then(res => { if (!cancelled && res.data) setDetail(prev => ({ ...prev, ...res.data })); })
      .catch((err: unknown) => { if (!cancelled) setDetailError(mapError(err, "Não foi possível carregar os detalhes.")); });
    return () => { cancelled = true; };
  }, [row.identifier]);

  const handleCancel = async () => {
    if (!cancelReason.trim()) return;
    setError(""); setLoading(true);
    try {
      await api.patch(`/identifiers/${detail.identifier}/cancel`, { reason: cancelReason });
      onCancelled();
    } catch (err: any) { setError(mapError(err, "Não foi possível cancelar o identificador.")); } finally { setLoading(false); }
  };

  const statusTone = detail.status === "active" ? "success" as const : detail.status === "cancelled" ? "error" as const : detail.status === "attached" ? "info" as const : "neutral" as const;

  return (
    <Modal title="Detalhe do Identificador" onClose={onClose} footer={detail.status === "active" && !showCancel ? <button onClick={() => setShowCancel(true)} className="docid-button-secondary text-docid-error"><Ban className="h-4 w-4" /> Cancelar</button> : undefined}>
      <div className="space-y-5">
        {detailError && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{detailError}</div>}
        <div className="flex items-center justify-between"><span className="font-mono text-lg font-bold">{detail.identifier}</span><StatusChip tone={statusTone}>{friendlyStatus(detail.status)}</StatusChip></div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-docid-muted">Categoria</p><p className="font-medium">{detail.category?.name || "Categoria"}</p></div>
          <div><p className="text-xs text-docid-muted">Origem</p><p className="font-medium">{detail.origin === "digital" ? "Digital" : "Físico"}</p></div>
          <div><p className="text-xs text-docid-muted">Visibilidade</p><p className="font-medium">{detail.visibility === "sector_only" ? "Apenas sector" : "Público"}</p></div>
          <div><p className="text-xs text-docid-muted">Sector</p><p className="font-medium">{detail.sector?.name || "-"}</p></div>
          {detail.issuedTo && <div><p className="text-xs text-docid-muted">Emitido para</p><p className="font-medium">{detail.issuedTo}</p></div>}
          {detail.description && <div className="col-span-2"><p className="text-xs text-docid-muted">Descrição</p><p className="font-medium">{detail.description}</p></div>}
          <div><p className="text-xs text-docid-muted">Criado por</p><p className="font-medium">{detail.createdByUser?.fullName || "-"}</p></div>
          <div><p className="text-xs text-docid-muted">Criado em</p><p className="font-medium">{new Date(detail.createdAt).toLocaleString("pt-AO")}</p></div>
        </div>
        {detail.document && <div className="rounded-lg border border-docid-border bg-docid-surface-low p-3"><p className="text-xs text-docid-muted mb-1">Documento associado</p><p className="text-sm font-medium">{detail.document.filename}</p></div>}
        <HistorySection identifierId={detail.id} />
        {showCancel && (
          <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-4 space-y-3">
            <p className="text-sm font-medium text-docid-error">Cancelar identificador</p>
            {error && <p className="text-xs text-docid-error">{error}</p>}
            <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} className="docid-input w-full" rows={2} placeholder="Motivo do cancelamento..." />
            <div className="flex gap-2"><button onClick={onClose} className="docid-button-secondary flex-1">Voltar</button><button onClick={handleCancel} disabled={loading || !cancelReason.trim()} className="docid-button-primary flex-1 bg-docid-error text-white">{loading ? "A cancelar..." : "Confirmar cancelamento"}</button></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

interface HistoryEvent { id: string; action: string; resource: string; resourceId: string; metadata: string | null; ip: string | null; createdAt: string; userName: string | null; }

const ACTION_LABELS: Record<string, string> = {
  GENERATE: "Identificador gerado",
  QUERY: "Consultado",
  CANCEL: "Cancelado",
  ATTACH: "Documento associado",
  SHARE: "Partilhado",
  APPROVE: "Aprovação",
};

function HistorySection({ identifierId }: { identifierId: string }) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await api.get<{ data: HistoryEvent[] }>(`/audit?resource=identifiers&resourceId=${encodeURIComponent(identifierId)}&limit=20`);
        if (!cancelled) setEvents(res.data || []);
      } catch (err: any) {
        if (!cancelled) setError(mapError(err, "Não foi possível carregar o histórico."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [identifierId]);

  const formatMetadata = (action: string, metadata: string | null): string | null => {
    if (!metadata) return null;
    try {
      const m = JSON.parse(metadata);
      if (action === "CANCEL" && m.reason) return `Motivo: ${m.reason}`;
      if (action === "GENERATE" && m.identifier) return m.identifier;
      return null;
    } catch { return null; }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-docid-text">Histórico de eventos</h4>
      {loading ? (
        <p className="text-xs text-docid-muted">A carregar histórico...</p>
      ) : error ? (
        <p className="text-xs text-docid-error">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-docid-muted">Sem eventos registados.</p>
      ) : (
        <ol className="space-y-3 border-l border-docid-border pl-4">
          {events.map(ev => (
            <li key={ev.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-docid-primary bg-docid-surface" />
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs font-medium text-docid-text">{ACTION_LABELS[ev.action] ?? "Acção registada"}</p>
                <p className="shrink-0 text-[11px] text-docid-muted">{new Date(ev.createdAt).toLocaleString("pt-AO")}</p>
              </div>
              <p className="mt-0.5 text-[11px] text-docid-muted">
                por {ev.userName || "—"}{formatMetadata(ev.action, ev.metadata) ? ` · ${formatMetadata(ev.action, ev.metadata)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
