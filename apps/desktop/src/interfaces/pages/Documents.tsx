import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, sync, watcher } from "../../infrastructure/di/container";
import { OfflineNotice } from "../components/docid-ui";
import { useOfflineCache } from "../hooks/useOfflineCache";
import UploadDocumentsModal from "../components/documents/UploadDocumentsModal";
import DocumentPanel from "../components/documents/DocumentPanel";
import HrProfiles from "../components/documents/HrProfiles";
import {
  EMPTY_FILTERS, NO_PERSON, activeFilterCount, filtersToQuery, friendlyDate,
  type DocFilters, type DocListMeta, type DocRow, type DocScope,
} from "../components/documents/types";
import { Upload, Search, X, ChevronLeft, ChevronRight, SlidersHorizontal, FileText, Users, Inbox, Lock, IdCard, ArrowLeft } from "lucide-react";

const PAGE_SIZE = 25;
const SCOPES: Array<[DocScope, string]> = [["all", "Todos"], ["mine", "Carregados por mim"], ["shared", "Partilhados comigo"]];
const CHIP_ON = "bg-docid-primary/20 text-docid-text ring-1 ring-docid-primary/50";
const CHIP_OFF = "text-docid-muted hover:bg-docid-surface-high hover:text-docid-text";
const STATUSES: Array<[string, string]> = [["", "Todos os estados"], ["active", "Activo"], ["attached", "Anexado"], ["cancelled", "Anulado"]];

/** Filtros ↔ URL (?view=&person=&q=&scope=&cat=&status=&from=&to=&page=&doc=): voltar atrás e recarregar mantêm a vista. */
function readFilters(sp: URLSearchParams): DocFilters {
  const scope = sp.get("scope");
  return {
    view: sp.get("view") === "perfis" ? "perfis" : "lista",
    person: sp.get("person") || "",
    q: sp.get("q") || "",
    scope: scope === "mine" || scope === "shared" ? scope : "all",
    categoryId: sp.get("cat") || "",
    status: sp.get("status") || "",
    from: sp.get("from") || "",
    to: sp.get("to") || "",
    page: Math.max(1, Number(sp.get("page")) || 1),
  };
}

/**
 * Altura disponível até ao fundo da janela. A página fica dentro de um <main> com scroll e
 * por cima pode haver avisos (ex.: licença), por isso mede-se em vez de usar uma altura fixa.
 */
function useFillHeight(bottomGap = 28) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      if (!ref.current) return;
      setHeight(Math.max(512, Math.floor(window.innerHeight - ref.current.getBoundingClientRect().top - bottomGap)));
    };
    measure();
    window.addEventListener("resize", measure);
    // O <main> encolhe quando aparece um aviso por cima (ex.: licença), sem a janela mudar.
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current?.closest("main") ?? document.body);
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); };
  }, [bottomGap]);
  return { ref, height };
}

export default function Documents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const fill = useFillHeight();
  const attachPath = searchParams.get("attachPath");
  const attachIdentifier = searchParams.get("identifier") || "";
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const selectedId = searchParams.get("doc");

  const [rows, setRows] = useState<DocRow[]>([]);
  const [meta, setMeta] = useState<DocListMeta>({ total: 0, page: 1, limit: PAGE_SIZE });
  const [searchText, setSearchText] = useState(filters.q);
  const [showFilters, setShowFilters] = useState(activeFilterCount(filters) > 0);
  const [showUpload, setShowUpload] = useState(!!attachPath);
  const [selectedRow, setSelectedRow] = useState<DocRow | null>(null);

  const setParams = (patch: Record<string, string | null>, opts: { resetPage?: boolean } = {}) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (opts.resetPage) next.delete("page");
    setSearchParams(next, { replace: true });
  };
  const setFilter = (key: "scope" | "cat" | "status" | "from" | "to", value: string) =>
    setParams({ [key]: value && value !== "all" ? value : null }, { resetPage: true });

  // Pesquisa com atraso (300 ms) para não pedir à API a cada tecla.
  useEffect(() => {
    if (searchText === filters.q) return;
    const t = setTimeout(() => setParams({ q: searchText.trim() || null }, { resetPage: true }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  // Vista de perfis de RH sem colaborador escolhido: mostra a grelha de perfis em vez da lista.
  const profileGrid = filters.view === "perfis" && !filters.person;
  const query = filtersToQuery(filters, PAGE_SIZE);
  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<{ data: DocRow[]; meta: DocListMeta }>({
    endpoint: "/documents",
    params: query,
    enabled: !profileGrid,
    fetcher: async () => {
      const res = await api.get<{ data: DocRow[]; meta: DocListMeta }>(`/documents?${query}`);
      return { data: res.data || [], meta: res.meta || { total: 0, page: 1, limit: PAGE_SIZE } };
    },
    onData: result => { setRows(result.data); setMeta(result.meta); },
  });

  // Ao mudar de vista ou de colaborador, não mostrar (nem por instantes) os documentos de outra pessoa.
  useEffect(() => {
    setRows([]);
    setMeta({ total: 0, page: 1, limit: PAGE_SIZE });
  }, [filters.view, filters.person]);

  // O documento seleccionado pode não estar na página actual (ex.: link directo): guardar a última linha conhecida.
  useEffect(() => {
    if (!selectedId) { setSelectedRow(null); return; }
    const found = rows.find(r => r.id === selectedId);
    if (found) setSelectedRow(found);
  }, [selectedId, rows]);

  useEffect(() => { if (attachPath) setShowUpload(true); }, [attachPath]);

  const select = (row: DocRow | null) => setParams({ doc: row?.id ?? null });

  const showProfiles = () => {
    setSearchText("");
    setSearchParams(new URLSearchParams({ view: "perfis" }), { replace: true });
  };
  const openPerson = (person: string) => {
    setSearchText("");
    setSearchParams(new URLSearchParams({ view: "perfis", person }), { replace: true });
  };
  /** Limpa pesquisa e filtros, mas mantém a vista (perfis/colaborador) e o documento aberto. */
  const clearFilters = () => {
    setSearchText("");
    const keep = new URLSearchParams();
    for (const k of ["view", "person", "doc"]) { const v = searchParams.get(k); if (v) keep.set(k, v); }
    setSearchParams(keep, { replace: true });
  };
  const personLabel = filters.person === NO_PERSON ? "Documentos de RH sem colaborador" : filters.person;

  const closeUpload = (done: boolean) => async () => {
    if (done && attachPath && watcher.isAvailable()) await watcher.setFileStatus(attachPath, "added").catch(() => {});
    setShowUpload(false);
    setParams({ attachPath: null, identifier: null });
    if (done) void refresh();
  };

  // Os erros aparecem no painel (que chama esta função dentro de run()).
  const openDocument = async (row: DocRow) => {
    const saveBlob = async () => {
      const blob = await api.getBlob(`/documents/${row.id}/download`);
      if (!blob) throw new Error("O ficheiro está vazio.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = row.filename || "documento"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    if (sync.isAvailable()) {
      const path = await sync.downloadOffline(row.id, row.filename);
      if (path) { await sync.openLocalFile(path); return; }
    }
    await saveBlob();
  };

  // Navegação pelo teclado: ↑/↓ mudam o documento seleccionado, Esc fecha o painel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || showUpload) return;
      // Com um menu ou janela aberta, o Esc é deles.
      if (document.querySelector('[role="menu"], [role="dialog"]')) return;
      if (e.key === "Escape" && selectedId) { select(null); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (rows.length === 0) return;
      e.preventDefault();
      const i = rows.findIndex(r => r.id === selectedId);
      const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i === -1 ? 0 : i - 1);
      select(rows[next]);
      document.querySelector(`[data-doc-id="${rows[next].id}"]`)?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedId, showUpload]);

  const pages = Math.max(1, Math.ceil(meta.total / (meta.limit || PAGE_SIZE)));
  const filterCount = activeFilterCount(filters);
  const anyFilter = !!filters.q || filters.scope !== "all" || filterCount > 0;
  const categories = meta.categories ?? [];

  return (
    <div ref={fill.ref} style={fill.height ? { height: fill.height } : undefined} className="flex min-h-[32rem] flex-col gap-4" data-testid="documents-page">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-docid-text">Documentos</h1>
          <p className="mt-1 text-sm text-docid-muted">
            {profileGrid ? "Perfis de RH: os documentos de cada colaborador num só sítio"
              : loading && rows.length === 0 ? "A carregar..." : `${meta.total} ${meta.total === 1 ? "documento" : "documentos"}${anyFilter ? " encontrados" : ""}`}
          </p>
        </div>
        <button onClick={() => setShowUpload(true)} className="docid-button-primary" data-testid="documents-upload"><Upload className="h-4 w-4" /> Anexar documento</button>
      </div>

      {/* Pesquisa e filtros */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" />
            <input value={searchText} onChange={e => setSearchText(e.target.value)} className="docid-input w-full pl-9 pr-8"
              placeholder={profileGrid ? "Procurar colaborador..." : "Pesquisar por nome, identificador, categoria, etiqueta ou pessoa..."} data-testid="documents-search" aria-label="Pesquisar documentos" />
            {searchText && <button onClick={() => setSearchText("")} aria-label="Limpar pesquisa" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-docid-muted hover:text-docid-text"><X className="h-3.5 w-3.5" /></button>}
          </div>
          {!profileGrid && <button onClick={() => setShowFilters(s => !s)} aria-expanded={showFilters}
            className={`docid-button-secondary ${filterCount ? "ring-1 ring-docid-primary" : ""}`} data-testid="documents-filters-toggle">
            <SlidersHorizontal className="h-4 w-4" /> Filtros{filterCount ? ` (${filterCount})` : ""}
          </button>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Âmbito">
          {SCOPES.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filters.view === "lista" && filters.scope === key} data-testid={`documents-scope-${key}`}
              onClick={() => filters.view === "perfis" ? setParams({ view: null, person: null, scope: key === "all" ? null : key }, { resetPage: true }) : setFilter("scope", key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${filters.view === "lista" && filters.scope === key ? CHIP_ON : CHIP_OFF}`}>
              {key === "shared" ? <Inbox className="h-3.5 w-3.5" /> : key === "mine" ? <Users className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />} {label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-docid-border" aria-hidden />
          <button role="tab" aria-selected={filters.view === "perfis"} onClick={showProfiles} data-testid="documents-view-perfis"
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${filters.view === "perfis" ? CHIP_ON : CHIP_OFF}`}>
            <IdCard className="h-3.5 w-3.5" /> Perfis RH
          </button>
          {anyFilter && (
            <button onClick={clearFilters}
              className="ml-auto text-xs text-docid-muted underline-offset-2 hover:text-docid-text hover:underline" data-testid="documents-clear">Limpar filtros</button>
          )}
        </div>

        {showFilters && !profileGrid && (
          <div className="docid-panel grid grid-cols-1 gap-3 p-3 sm:grid-cols-4" data-testid="documents-filters">
            <label className="text-[11px] text-docid-muted">Categoria
              <select value={filters.categoryId} onChange={e => setFilter("cat", e.target.value)} className="docid-input mt-1 w-full text-sm" data-testid="documents-filter-category">
                <option value="">Todas as categorias</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
              </select>
            </label>
            <label className="text-[11px] text-docid-muted">Estado
              <select value={filters.status} onChange={e => setFilter("status", e.target.value)} className="docid-input mt-1 w-full text-sm">
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-docid-muted">Desde
              <input type="date" value={filters.from} max={filters.to || undefined} onChange={e => setFilter("from", e.target.value)} className="docid-input mt-1 w-full text-sm" />
            </label>
            <label className="text-[11px] text-docid-muted">Até
              <input type="date" value={filters.to} min={filters.from || undefined} onChange={e => setFilter("to", e.target.value)} className="docid-input mt-1 w-full text-sm" />
            </label>
          </div>
        )}
      </div>

      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}
      {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 px-4 py-3 text-sm text-docid-error">{error}</div>}

      {/* Lista + painel */}
      <div className={`grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4 ${selectedRow ? "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] xl:grid-cols-[minmax(0,1fr)_32rem]" : "grid-cols-1"}`}>
        <section className={`docid-panel flex min-h-0 flex-col overflow-hidden ${selectedRow ? "hidden lg:flex" : "flex"}`} aria-label="Lista de documentos">
          {filters.view === "perfis" && filters.person && (
            <div className="flex items-center gap-2 border-b border-docid-border px-4 py-2.5" data-testid="hr-person-header">
              <button onClick={showProfiles} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-docid-muted hover:bg-docid-surface-high hover:text-docid-text"><ArrowLeft className="h-3.5 w-3.5" /> Perfis</button>
              <span className="text-docid-outline">/</span>
              <span className="truncate text-sm font-semibold text-docid-text">{personLabel}</span>
              <span className="ml-auto shrink-0 text-xs text-docid-muted">{meta.total} {meta.total === 1 ? "documento" : "documentos"}</span>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="documents-list">
            {profileGrid ? (
              <HrProfiles q={filters.q} onOpen={openPerson} />
            ) : loading && rows.length === 0 ? (
              <ul className="divide-y divide-docid-border">{[...Array(6)].map((_, i) => <SkeletonItem key={i} />)}</ul>
            ) : rows.length === 0 ? (
              <EmptyList filtered={anyFilter} onClear={clearFilters} onUpload={() => setShowUpload(true)} />
            ) : (
              <ul className="divide-y divide-docid-border" role="listbox" aria-label="Documentos">
                {rows.map(row => (
                  <DocItem key={row.id} row={row} selected={row.id === selectedId} onSelect={() => select(row)} />
                ))}
              </ul>
            )}
          </div>
          {!profileGrid && meta.total > 0 && (
            <div className="flex items-center justify-between border-t border-docid-border px-4 py-2.5 text-xs text-docid-muted">
              <span>{(filters.page - 1) * PAGE_SIZE + 1}–{Math.min(filters.page * PAGE_SIZE, meta.total)} de {meta.total}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setParams({ page: String(filters.page - 1) })} disabled={filters.page <= 1} aria-label="Página anterior" className="rounded p-1.5 hover:bg-docid-surface-high disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <span className="px-1" data-testid="documents-page-indicator">Página {filters.page} de {pages}</span>
                <button onClick={() => setParams({ page: String(filters.page + 1) })} disabled={filters.page >= pages} aria-label="Página seguinte" className="rounded p-1.5 hover:bg-docid-surface-high disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </section>

        {selectedRow && (
          <div className="min-h-0">
            <DocumentPanel row={selectedRow} onClose={() => select(null)} onChanged={() => void refresh()} onOpen={openDocument} />
          </div>
        )}
      </div>

      {showUpload && (
        <UploadDocumentsModal onClose={closeUpload(false)} onDone={closeUpload(true)} initialPath={attachPath || ""} initialIdentifier={attachIdentifier} />
      )}
    </div>
  );
}

function DocItem({ row, selected, onSelect }: { row: DocRow; selected: boolean; onSelect: () => void }) {
  const title = row.label?.trim() || row.filename || "Sem ficheiro";
  const cancelled = row.status === "cancelled";
  const restricted = row.identifier?.visibility === "sector_only";
  return (
    <li role="option" aria-selected={selected} data-doc-id={row.id}>
      <button type="button" onClick={onSelect} data-testid="document-row"
        className={`relative flex w-full items-start gap-3 px-4 py-3 text-left transition ${selected ? "bg-docid-primary/15" : "hover:bg-docid-surface-high"}`}>
        {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-docid-primary" />}
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-docid-primary/20 text-docid-primary-soft" : "bg-docid-surface-high text-docid-muted"}`}>
          <FileText className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`truncate text-sm font-medium ${cancelled ? "text-docid-muted line-through" : "text-docid-text"}`}>{title}</span>
            {restricted && <Lock className="h-3 w-3 shrink-0 text-docid-muted" aria-label="Só o sector" />}
            {row.sharedWithMe && <span className="shrink-0 rounded-full bg-docid-primary/15 px-1.5 text-[10px] text-docid-primary-soft">partilhado</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-docid-muted">
            <span className="truncate font-mono">{row.identifier?.identifier || "—"}</span>
            {row.identifier?.categoryName && <><span aria-hidden>·</span><span className="truncate">{row.identifier.categoryName}</span></>}
          </span>
          {(row.tags || []).length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {(row.tags || []).slice(0, 3).map(t => <span key={t} className="rounded-full bg-docid-surface-high px-1.5 py-px text-[10px] text-docid-muted">{t}</span>)}
              {(row.tags || []).length > 3 && <span className="text-[10px] text-docid-muted">+{(row.tags || []).length - 3}</span>}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right text-[11px] text-docid-muted">
          <span className="block">{friendlyDate(row.createdAt)}</span>
          {row.uploadedBy && <span className="block max-w-[8rem] truncate">{row.uploadedBy}</span>}
        </span>
      </button>
    </li>
  );
}

function SkeletonItem() {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="h-9 w-9 animate-pulse rounded-lg bg-docid-surface-high" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-1/2 animate-pulse rounded bg-docid-surface-high" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-docid-surface-high" />
      </div>
    </li>
  );
}

function EmptyList({ filtered, onClear, onUpload }: { filtered: boolean; onClear: () => void; onUpload: () => void }) {
  return (
    <div className="flex h-full min-h-60 flex-col items-center justify-center gap-3 p-8 text-center" data-testid="documents-empty">
      <FileText className="h-10 w-10 text-docid-outline" />
      {filtered ? (
        <>
          <p className="text-sm text-docid-text">Nenhum documento corresponde à pesquisa.</p>
          <button onClick={onClear} className="docid-button-secondary text-xs">Limpar filtros</button>
        </>
      ) : (
        <>
          <p className="text-sm text-docid-text">Ainda não há documentos.</p>
          <p className="max-w-sm text-xs text-docid-muted">Gere um identificador e anexe-lhe o ficheiro, ou anexe aqui documentos a identificadores que já existem.</p>
          <button onClick={onUpload} className="docid-button-primary text-xs"><Upload className="h-3.5 w-3.5" /> Anexar documento</button>
        </>
      )}
    </div>
  );
}
