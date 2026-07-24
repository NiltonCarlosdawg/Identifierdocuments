import { useState, useEffect, useCallback } from "react";
import { api, sync } from "../../infrastructure/di/container";
import { useGenerateIdentifier } from "../hooks/useGenerateIdentifier";
import { useAuthStore } from "../stores/authStore";
import { PageHeader, Modal, StatusChip, EmptyState, Pagination } from "../components/docid-ui";
import { Fingerprint, Plus, Copy, Ban, Search, WifiOff, RefreshCw } from "lucide-react";

interface Category { id: string; name: string; group: string; prefix: string; requiresSequential: boolean; }
interface IdentifierRow { id: string; identifier: string; categoryId: string; category: { id: string; name: string; group: string; prefix: string }; status: string; origin: string; visibility: string; issuedTo: string | null; description: string | null; createdAt: string; sector: { id: string; name: string } | null; document: { id: string; filename: string } | null; createdByUser: { id: string; fullName: string } | null; restricted?: boolean; }

export default function Identifiers() {
  const [rows, setRows] = useState<IdentifierRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOrigin, setFilterOrigin] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [selected, setSelected] = useState<IdentifierRow | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(async (page = 1) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (filterStatus) params.set("status", filterStatus);
      if (filterOrigin) params.set("origin", filterOrigin);
      const res = await api.get<{ data: IdentifierRow[]; meta: { total: number; page: number; limit: number } }>(`/identifiers?${params}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (err: any) { setError(err.message || "Erro ao carregar identificadores."); }
    finally { setLoading(false); }
  }, [filterStatus, filterOrigin]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ data: { groups: Record<string, Category[]> } }>("/categories").then(r => { const all: Category[] = []; for (const g of Object.values(r.data?.groups || {})) all.push(...g); setCategories(all); }).catch(() => {}); }, []);

  return (
    <div>
      <PageHeader title="Identificadores" description="Gere os identificadores únicos dos documentos" actions={
        <button onClick={() => setShowGenerate(true)} className="docid-button-primary"><Plus className="h-4 w-4" /> Gerar</button>
      } />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input value={search} onChange={e => setSearch(e.target.value)} className="docid-input w-full pl-9" placeholder="Pesquisar identificador..." /></div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="docid-input w-36"><option value="">Todos os estados</option><option value="active">Activo</option><option value="attached">Associado</option><option value="cancelled">Cancelado</option><option value="draft">Rascunho</option></select>
        <select value={filterOrigin} onChange={e => setFilterOrigin(e.target.value)} className="docid-input w-36"><option value="">Todas as origens</option><option value="digital">Digital</option><option value="physical">Físico</option></select>
      </div>
      <div className="docid-panel overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-docid-muted">A carregar...</div>
        ) : rows.length === 0 ? (
          <EmptyState>Nenhum identificador encontrado.</EmptyState>
        ) : (
          <table className="docid-table">
            <thead><tr><th>Identificador</th><th>Categoria</th><th>Estado</th><th>Origem</th><th>Sector</th><th>Criado em</th><th></th></tr></thead>
            <tbody>{rows.filter(r => !search || r.identifier.toLowerCase().includes(search.toLowerCase())).map(row => (
              <tr key={row.id} className="cursor-pointer" onClick={() => setSelected(row)}>
                <td className="font-mono text-xs font-medium">{row.identifier}{row.restricted && <span className="ml-2 text-docid-tertiary">🔒</span>}</td>
                <td><span className="text-xs text-docid-muted">{row.category?.name || row.categoryId}</span></td>
                <td><StatusChip tone={row.status === "active" ? "success" : row.status === "cancelled" ? "error" : row.status === "attached" ? "info" : "neutral"}>{row.status === "active" ? "Activo" : row.status === "cancelled" ? "Cancelado" : row.status === "attached" ? "Associado" : row.status}</StatusChip></td>
                <td className="text-xs">{row.origin === "digital" ? "🖥 Digital" : "📄 Físico"}</td>
                <td className="text-xs text-docid-muted">{row.sector?.name || "-"}</td>
                <td className="text-xs text-docid-muted">{new Date(row.createdAt).toLocaleDateString("pt-AO")}</td>
                <td><button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(row.identifier); }} className="rounded p-1 text-docid-muted hover:text-docid-text"><Copy className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <Pagination totalLabel={`${meta.total} identificador(es)`} />
      </div>

      {showGenerate && <GenerateModal categories={categories} onClose={() => setShowGenerate(false)} onDone={() => { setShowGenerate(false); load(); }} />}
      {selected && <DetailModal row={selected} onClose={() => setSelected(null)} onCancelled={() => { setSelected(null); load(); }} />}
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

  useEffect(() => {
    (async () => {
      if (!sync.isAvailable()) { setIsOffline(false); return; }
      setIsOffline(!(await sync.isOnline()));
    })();
  }, []);

  const groups = categories.reduce<Record<string, Category[]>>((acc, c) => { (acc[c.group] = acc[c.group] || []).push(c); return acc; }, {});

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
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="docid-input w-full">
            <option value="">Seleccionar categoria...</option>
            {Object.entries(groups).map(([group, cats]) => (
              <optgroup key={group} label={group}>
                {cats.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id}){c.requiresSequential ? "" : " *"}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {categoryId && !categories.find(c => c.id === categoryId)?.requiresSequential && isOffline && (
            <p className="mt-1 text-xs text-amber-500">* Sequência provisória até sincronizar.</p>
          )}
        </div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Emitido para</label><input value={issuedTo} onChange={e => setIssuedTo(e.target.value)} className="docid-input w-full" placeholder="Nome do cliente/destinatário (opcional)" /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Descrição</label><textarea value={description} onChange={e => setDescription(e.target.value)} className="docid-input w-full" rows={2} placeholder="Descrição opcional" /></div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Visibilidade</label>
          <div className="flex gap-2">
            <button onClick={() => setVisibility("sector_only")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${visibility === "sector_only" ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>🔒 Apenas sector</button>
            <button onClick={() => setVisibility("public")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${visibility === "public" ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>🌐 Público</button>
          </div>
        </div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Origem</label><div className="flex gap-2"><button onClick={() => setOrigin("digital")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${origin === "digital" ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>🖥 Digital</button><button onClick={() => setOrigin("physical")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${origin === "physical" ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>📄 Físico</button></div></div>
      </div>
    </Modal>
  );
}

function DetailModal({ row, onClose, onCancelled }: { row: IdentifierRow; onClose: () => void; onCancelled: () => void }) {
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCancel = async () => {
    if (!cancelReason.trim()) return;
    setError(""); setLoading(true);
    try {
      await api.patch(`/identifiers/${row.identifier}/cancel`, { reason: cancelReason });
      onCancelled();
    } catch (err: any) { setError(err.message || "Erro ao cancelar."); } finally { setLoading(false); }
  };

  const statusTone = row.status === "active" ? "success" as const : row.status === "cancelled" ? "error" as const : row.status === "attached" ? "info" as const : "neutral" as const;

  return (
    <Modal title="Detalhe do Identificador" onClose={onClose} footer={row.status === "active" && !showCancel ? <button onClick={() => setShowCancel(true)} className="docid-button-secondary text-docid-error"><Ban className="h-4 w-4" /> Cancelar</button> : undefined}>
      <div className="space-y-5">
        <div className="flex items-center justify-between"><span className="font-mono text-lg font-bold">{row.identifier}</span><StatusChip tone={statusTone}>{row.status === "active" ? "Activo" : row.status === "cancelled" ? "Cancelado" : row.status === "attached" ? "Associado" : row.status}</StatusChip></div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-docid-muted">Categoria</p><p className="font-medium">{row.category?.name || row.categoryId}</p></div>
          <div><p className="text-xs text-docid-muted">Origem</p><p className="font-medium">{row.origin === "digital" ? "Digital" : "Físico"}</p></div>
          <div><p className="text-xs text-docid-muted">Visibilidade</p><p className="font-medium">{row.visibility === "sector_only" ? "Apenas sector" : "Público"}</p></div>
          <div><p className="text-xs text-docid-muted">Sector</p><p className="font-medium">{row.sector?.name || "-"}</p></div>
          {row.issuedTo && <div><p className="text-xs text-docid-muted">Emitido para</p><p className="font-medium">{row.issuedTo}</p></div>}
          {row.description && <div className="col-span-2"><p className="text-xs text-docid-muted">Descrição</p><p className="font-medium">{row.description}</p></div>}
          <div><p className="text-xs text-docid-muted">Criado por</p><p className="font-medium">{row.createdByUser?.fullName || "-"}</p></div>
          <div><p className="text-xs text-docid-muted">Criado em</p><p className="font-medium">{new Date(row.createdAt).toLocaleString("pt-AO")}</p></div>
        </div>
        {row.document && <div className="rounded-lg border border-docid-border bg-docid-surface-low p-3"><p className="text-xs text-docid-muted mb-1">Documento associado</p><p className="text-sm font-medium">{row.document.filename}</p></div>}

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
