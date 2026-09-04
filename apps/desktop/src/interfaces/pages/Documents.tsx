import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api, sync, watcher } from "../../infrastructure/di/container";
import { PageHeader, Modal, StatusChip, EmptyState, Pagination, OfflineNotice } from "../components/docid-ui";
import { useOfflineCache } from "../hooks/useOfflineCache";
import { mapError, isNetworkError } from "../../shared/errors/mapError";
import { useAuthStore } from "../stores/authStore";
import { useQueueStore } from "../stores/queueStore";
import ShareDocumentModal from "../components/ShareDocumentModal";
import ClassifierSuggestion from "../components/ClassifierSuggestion";
import type { ClassifierResult } from "../hooks/useClassifier";
import { Upload, Download, Share2, Search, Printer, Plus, History, LayoutGrid, List, Tag, Lock } from "lucide-react";
import { usePrinterStore } from "../stores/printerStore";

const PROFILE_CATEGORY_IDS = new Set(["CPS", "CPF", "CTR", "CLA"]);
const DOCUMENT_PRESET_TAGS = ["urgente", "renovação pendente", "assinado", "rascunho", "arquivado"] as const;

interface DocRow {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  status: string;
  createdAt: string;
  fileUrl: string;
  thumbnailUrl: string;
  kind?: "primary" | "attachment";
  label?: string | null;
  tags?: string[];
  identifier: { id: string; identifier: string; categoryId: string; categoryName: string; visibility?: string; sectorId?: string } | null;
  uploadedBy: string | null;
}

type UploadMode = "batch" | "attachments";

interface UploadRow {
  key: string;
  path?: string;
  file?: File;
  filename: string;
  identifier: string;
  status: "pending" | "ok" | "error" | "queued";
  message?: string;
}

interface DocVersionMeta {
  id: string;
  version: number;
  filename: string;
  fileSize: number;
  mimeType: string;
  isCurrent: boolean;
  createdAt: string;
  uploadedBy: string | null;
}

interface DocAttachmentMeta {
  id: string;
  kind: string;
  label: string | null;
  filename: string | null;
  fileSize: number | null;
  mimeType: string | null;
  createdAt: string;
}

interface DocDetail extends DocRow {
  versions?: DocVersionMeta[];
  attachments?: DocAttachmentMeta[];
  primaryDocumentId?: string | null;
  tags?: string[];
  restricted?: boolean;
}

export default function Documents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const attachPath = searchParams.get("attachPath");
  const attachIdentifier = searchParams.get("identifier") || "";
  const [rows, setRows] = useState<DocRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20 });
  const [showUpload, setShowUpload] = useState(!!attachPath);
  const [selected, setSelected] = useState<DocRow | null>(null);
  const [search, setSearch] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [viewMode, setViewMode] = useState<"lista" | "perfis">("lista");
  const [profileDetail, setProfileDetail] = useState(false);

  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<{ data: DocRow[]; meta: { total: number; page: number; limit: number } }>({
    endpoint: "/documents",
    fetcher: async () => {
      const res = await api.get<{ data: DocRow[]; meta: { total: number; page: number; limit: number } }>("/documents?page=1&limit=20");
      return { data: res.data || [], meta: res.meta || { total: 0, page: 1, limit: 20 } };
    },
    onData: result => { setRows(result.data); setMeta(result.meta); },
  });

  useEffect(() => {
    if (attachPath) setShowUpload(true);
  }, [attachPath]);

  const clearAttachParams = () => {
    if (!attachPath && !attachIdentifier) return;
    const next = new URLSearchParams(searchParams);
    next.delete("attachPath");
    next.delete("identifier");
    setSearchParams(next, { replace: true });
  };

  const closeUpload = () => {
    setShowUpload(false);
    clearAttachParams();
  };

  const finishUpload = async () => {
    if (attachPath && watcher.isAvailable()) {
      await watcher.setFileStatus(attachPath, "added").catch(() => {});
    }
    setShowUpload(false);
    clearAttachParams();
    refresh();
  };

  const handleOpen = async (row: DocRow) => {
    setDownloadError("");
    if (!sync.isAvailable()) {
      try {
        const blob = await api.getBlob(`/documents/${row.id}/download`);
        if (!blob) throw new Error("Ficheiro vazio.");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = row.filename || "documento"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err: any) {
        setDownloadError(mapError(err, "Erro ao descarregar."));
      }
      return;
    }
    try {
      const path = await sync.downloadOffline(row.id, row.filename);
      if (path) { await sync.openLocalFile(path); return; }
      const blob = await api.getBlob(`/documents/${row.id}/download`);
      if (!blob) throw new Error("Ficheiro vazio.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = row.filename || "documento"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err: any) {
      setDownloadError(err?.message || "Documento não disponível offline.");
    }
  };

  const filtered = rows.filter(r =>
    !search
    || r.filename?.toLowerCase().includes(search.toLowerCase())
    || r.identifier?.identifier.toLowerCase().includes(search.toLowerCase())
    || r.identifier?.categoryName?.toLowerCase().includes(search.toLowerCase())
    || (r.tags || []).some(t => t.toLowerCase().includes(search.toLowerCase())),
  );
  const profileRows = filtered.filter(r => r.identifier?.categoryId && PROFILE_CATEGORY_IDS.has(r.identifier.categoryId));
  const listRows = viewMode === "perfis" ? profileRows : filtered;

  return (
    <div>
      <PageHeader title="Documentos" description="Gerir os documentos associados a identificadores" actions={
        <button onClick={() => setShowUpload(true)} className="docid-button-primary"><Upload className="h-4 w-4" /> Anexar</button>
      } />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}
      {downloadError && <div className="mb-4 rounded-lg border border-docid-tertiary/30 bg-docid-tertiary/10 p-3 text-sm text-docid-tertiary">{downloadError}</div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input value={search} onChange={e => setSearch(e.target.value)} className="docid-input w-full pl-9" placeholder="Pesquisar documento..." /></div>
        <div className="flex rounded-lg border border-docid-outline/20 p-0.5">
          <button type="button" onClick={() => setViewMode("lista")} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${viewMode === "lista" ? "bg-docid-primary/15 text-docid-primary-soft" : "text-docid-muted"}`}><List className="h-3.5 w-3.5" /> Lista</button>
          <button type="button" onClick={() => setViewMode("perfis")} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${viewMode === "perfis" ? "bg-docid-primary/15 text-docid-primary-soft" : "text-docid-muted"}`}><LayoutGrid className="h-3.5 w-3.5" /> Perfis</button>
        </div>
      </div>
      <div className="docid-panel overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-docid-muted">A carregar...</div>
        ) : listRows.length === 0 ? (
          <EmptyState>{viewMode === "perfis" ? "Nenhum contrato/perfil encontrado (CPS, CPF, CTR, CLA)." : "Nenhum documento encontrado."}</EmptyState>
        ) : viewMode === "perfis" ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {listRows.map(row => (
              <button
                key={row.id}
                type="button"
                onClick={() => { setProfileDetail(false); setSelected(row); }}
                className="rounded-xl border border-docid-outline/20 bg-docid-surface-low p-4 text-left transition hover:border-docid-primary/40 hover:bg-docid-surface"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-docid-primary-soft">{row.identifier?.categoryId}</p>
                  <StatusChip tone={row.status === "active" || row.status === "attached" ? "success" : "neutral"}>{row.status}</StatusChip>
                </div>
                <p className="mb-1 truncate text-sm font-medium">{row.filename || "Sem ficheiro"}</p>
                <p className="mb-3 font-mono text-[11px] text-docid-muted">{row.identifier?.identifier}</p>
                <div className="flex flex-wrap gap-1">
                  {(row.tags || []).length === 0 ? (
                    <span className="text-[10px] text-docid-outline">Sem tags</span>
                  ) : (row.tags || []).slice(0, 4).map(tag => (
                    <span key={tag} className="rounded-full bg-docid-surface-high px-2 py-0.5 text-[10px] text-docid-muted">{tag}</span>
                  ))}
                  {(row.tags || []).length > 4 && <span className="text-[10px] text-docid-muted">+{(row.tags || []).length - 4}</span>}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <table className="docid-table">
            <thead><tr><th>Ficheiro</th><th>Identificador</th><th>Categoria</th><th>Estado</th><th>Carregado por</th><th>Data</th><th></th></tr></thead>
            <tbody>{listRows.map(row => (
              <tr key={row.id} className="cursor-pointer" onClick={() => { setProfileDetail(PROFILE_CATEGORY_IDS.has(row.identifier?.categoryId || "")); setSelected(row); }}>
                <td className="max-w-48 truncate font-medium">{row.filename}</td>
                <td className="font-mono text-xs">{row.identifier?.identifier || "-"}</td>
                <td className="text-xs text-docid-muted">{row.identifier?.categoryName || "-"}</td>
                <td><StatusChip tone={row.status === "active" || row.status === "attached" ? "success" : row.status === "cancelled" ? "error" : "neutral"}>{row.status}</StatusChip></td>
                <td className="text-xs text-docid-muted">{row.uploadedBy || "-"}</td>
                <td className="text-xs text-docid-muted">{new Date(row.createdAt).toLocaleDateString("pt-AO")}</td>
                <td><button onClick={e => { e.stopPropagation(); handleOpen(row); }} className="rounded p-1 text-docid-muted hover:text-docid-text"><Download className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <Pagination totalLabel={`${viewMode === "perfis" ? profileRows.length : meta.total} documento(s)`} />
      </div>

      {showUpload && <UploadModal onClose={closeUpload} onDone={finishUpload} initialPath={attachPath || ""} initialIdentifier={attachIdentifier} />}
      {selected && <DetailModal row={selected} onClose={() => setSelected(null)} onDone={() => refresh()} onDownload={() => handleOpen(selected)} profileMode={profileDetail || (viewMode === "perfis")} />}
    </div>
  );
}

function UploadModal({ onClose, onDone, initialPath = "", initialIdentifier = "" }: { onClose: () => void; onDone: () => void | Promise<void>; initialPath?: string; initialIdentifier?: string }) {
  const isTauri = sync.isAvailable();
  const [mode, setMode] = useState<UploadMode>("batch");
  const [rows, setRows] = useState<UploadRow[]>(() => {
    if (!initialPath) return [];
    return [{
      key: "init",
      path: initialPath,
      filename: initialPath.split("/").pop() || initialPath.split("\\").pop() || "documento",
      identifier: initialIdentifier,
      status: "pending",
    }];
  });
  const [sharedIdentifier, setSharedIdentifier] = useState(initialIdentifier);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [doneSummary, setDoneSummary] = useState(false);
  const [classifierText, setClassifierText] = useState("");
  const [classifierResult, setClassifierResult] = useState<ClassifierResult | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(!!initialIdentifier);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    if (!isTauri || !initialPath) return;
    setExtracting(true);
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const text = await invoke<string>("extract_text_command", { path: initialPath });
        setClassifierText(text.slice(0, 4000));
      } catch (err: unknown) {
        setError(mapError(err, "Erro ao extrair ficheiro."));
      } finally {
        setExtracting(false);
      }
    })();
  }, []);

  const updateRow = (key: string, patch: Partial<UploadRow>) => {
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  };

  const handleTauriSelect = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: [{ name: "Documentos", extensions: ["pdf", "txt", "md", "csv", "docx"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const next: UploadRow[] = paths.map((p, i) => ({
        key: `${Date.now()}-${i}`,
        path: p,
        filename: p.split("/").pop() || p.split("\\").pop() || "documento",
        identifier: mode === "attachments" ? sharedIdentifier : (rows.length === 0 && i === 0 ? initialIdentifier : ""),
        status: "pending",
      }));
      setRows(prev => [...prev, ...next]);
      if (paths[0]) {
        setExtracting(true);
        const { invoke } = await import("@tauri-apps/api/core");
        const text = await invoke<string>("extract_text_command", { path: paths[0] });
        setClassifierText(text.slice(0, 4000));
        setExtracting(false);
        if (!initialIdentifier && mode === "batch") setFeedbackSent(false);
      }
    } catch (err: any) {
      setExtracting(false);
      setError(mapError(err, "Erro ao seleccionar ou extrair ficheiro."));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const next: UploadRow[] = files.map((f, i) => ({
      key: `${Date.now()}-${i}`,
      file: f,
      filename: f.name,
      identifier: mode === "attachments" ? sharedIdentifier : "",
      status: "pending",
    }));
    setRows(prev => [...prev, ...next]);
    setClassifierText(""); setClassifierResult(null); setFeedbackSent(false);
  };

  const handleClassifierSelect = async (categoryId: string) => {
    if (!classifierResult) return;
    const accepted = categoryId === classifierResult.categoryId;
    try {
      await api.post("/classifier/feedback", {
        suggestedCategoryId: classifierResult.categoryId,
        chosenCategoryId: categoryId,
        accepted,
      });
    } catch {}
    setFeedbackSent(true);
  };

  const uploadOne = async (row: UploadRow, uploadMode: "attach" | "attachment") => {
    const identifier = (mode === "attachments" ? sharedIdentifier : row.identifier).trim();
    if (!identifier) throw new Error("Identificador em falta.");

    if (isTauri && row.path) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("attach_document_native", {
          path: row.path,
          identifier,
          uploadSource: "manual",
          mode: uploadMode,
          label: uploadMode === "attachment" ? row.filename : undefined,
        });
        return { status: "ok" as const };
      } catch (err: any) {
        if (isNetworkError(err) && (uploadMode === "attach" || uploadMode === "attachment")) {
          const user = useAuthStore.getState().user;
          if (!user?.tenantId || !user?.id) throw err;
          const item = await sync.enqueueFromPath(row.path, identifier, user.tenantId, user.id, uploadMode);
          if (!item) throw err;
          useQueueStore.getState().refresh().catch(() => {});
          return { status: "queued" as const };
        }
        throw err;
      }
    }

    if (row.file) {
      try {
        const fd = new FormData();
        fd.append("identifier", identifier);
        fd.append("file", row.file);
        if (uploadMode === "attachment") fd.append("label", row.filename);
        await api.post(uploadMode === "attachment" ? "/documents/attachments" : "/documents/attach", fd);
        return { status: "ok" as const };
      } catch (err: any) {
        if (isNetworkError(err) && sync.isAvailable()) {
          const user = useAuthStore.getState().user;
          if (!user?.tenantId || !user?.id) throw err;
          const item = await sync.enqueueFromFile(row.file, identifier, user.tenantId, user.id, uploadMode);
          if (!item) throw err;
          useQueueStore.getState().refresh().catch(() => {});
          return { status: "queued" as const };
        }
        throw err;
      }
    }
    throw new Error("Ficheiro em falta.");
  };

  const handleUpload = async () => {
    if (!rows.length) return;
    if (mode === "attachments" && !sharedIdentifier.trim()) return;
    if (mode === "batch" && rows.some(r => !r.identifier.trim())) {
      setError("Preencha o identificador em todas as linhas.");
      return;
    }
    setError(""); setLoading(true); setDoneSummary(false);
    const uploadMode = mode === "attachments" ? "attachment" : "attach";
    let anyOk = false;

    for (const row of rows) {
      if (row.status === "ok" || row.status === "queued") continue;
      try {
        const result = await uploadOne(row, uploadMode);
        updateRow(row.key, { status: result.status, message: result.status === "queued" ? "Na fila offline" : "OK" });
        anyOk = true;
      } catch (err: any) {
        updateRow(row.key, { status: "error", message: mapError(err, "Falha no upload.") });
      }
    }

    setLoading(false);
    setDoneSummary(true);
    if (anyOk) {
      // keep modal open to show per-file results; user closes
    }
  };

  const canSubmit = rows.length > 0
    && (mode === "attachments" || feedbackSent)
    && (mode === "attachments" ? !!sharedIdentifier.trim() : rows.every(r => r.identifier.trim()))
    && !loading;

  return (
    <Modal title="Anexar Documentos" onClose={onClose} footer={
      doneSummary
        ? <button onClick={async () => { await onDone(); }} className="docid-button-primary">Concluir</button>
        : <><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleUpload} disabled={!canSubmit} className="docid-button-primary">{loading ? "A enviar..." : "Enviar"}</button></>
    }>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}

        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("batch")} className={`docid-button-secondary text-xs ${mode === "batch" ? "ring-1 ring-docid-primary" : ""}`}>Lote (IDs distintos)</button>
          <button type="button" onClick={() => setMode("attachments")} className={`docid-button-secondary text-xs ${mode === "attachments" ? "ring-1 ring-docid-primary" : ""}`}>Anexos ao mesmo ID</button>
        </div>

        {mode === "attachments" && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Identificador (partilhado)</label>
            <input value={sharedIdentifier} onChange={e => setSharedIdentifier(e.target.value)} className="docid-input w-full font-mono" placeholder="Ex: VL-PROP-2026-0725-001" />
            <p className="mt-1 text-[11px] text-docid-muted">Requer documento principal já associado. Estes ficheiros serão anexos.</p>
          </div>
        )}

        {isTauri ? (
          <button onClick={handleTauriSelect} className="docid-button-secondary w-full justify-start"><Upload className="h-4 w-4" /> Seleccionar ficheiros...</button>
        ) : (
          <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Ficheiros</label><input type="file" multiple onChange={handleFileChange} className="docid-input w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-docid-primary file:px-3 file:py-1 file:text-xs file:font-medium file:text-white" /></div>
        )}

        {extracting && <p className="text-xs text-docid-muted">A extrair texto do ficheiro...</p>}

        {classifierText && !feedbackSent && mode === "batch" && (
          <ClassifierSuggestion
            text={classifierText}
            filename={rows[0]?.filename}
            onSelect={handleClassifierSelect}
            onClassified={setClassifierResult}
          />
        )}

        {feedbackSent && mode === "batch" && (
          <div className="rounded-lg border border-docid-secondary/30 bg-docid-secondary/10 p-3 text-xs text-docid-secondary">Classificação registada. Pode prosseguir com o upload.</div>
        )}

        {rows.length > 0 && (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {rows.map(row => (
              <div key={row.key} className="rounded-lg border border-docid-outline/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium">{row.filename}</p>
                  {row.status !== "pending" && (
                    <span className={`shrink-0 text-[10px] font-medium ${row.status === "error" ? "text-docid-error" : "text-docid-secondary"}`}>
                      {row.status === "ok" ? "OK" : row.status === "queued" ? "Fila" : "Erro"}
                    </span>
                  )}
                </div>
                {mode === "batch" && (
                  <input
                    value={row.identifier}
                    onChange={e => updateRow(row.key, { identifier: e.target.value })}
                    className="docid-input mt-1 w-full font-mono text-xs"
                    placeholder="Identificador"
                    disabled={loading || doneSummary}
                  />
                )}
                {row.message && <p className="mt-1 text-[10px] text-docid-muted">{row.message}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function DetailModal({ row, onClose, onDone, onDownload, profileMode = false }: { row: DocRow; onClose: () => void; onDone: () => void; onDownload: () => Promise<void>; profileMode?: boolean }) {
  const [showShare, setShowShare] = useState(false);
  const [showRequestAccess, setShowRequestAccess] = useState(false);
  const [offlineAvailable, setOfflineAvailable] = useState<boolean | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [tags, setTags] = useState<string[]>(row.tags || []);
  const [customTag, setCustomTag] = useState("");
  const [savingTags, setSavingTags] = useState(false);
  const isProfile = profileMode || PROFILE_CATEGORY_IDS.has(row.identifier?.categoryId || "");
  const identCode = row.identifier?.identifier || row.id;
  const selectedPrinter = usePrinterStore(s => s.selectedPrinter);
  const loadPrinters = usePrinterStore(s => s.loadPrinters);
  const printFile = usePrinterStore(s => s.printFile);
  const isTauri = sync.isAvailable();
  const user = useAuthStore(s => s.user);

  const isSectorOnly = row.identifier?.visibility === "sector_only";
  const isOtherSector = isSectorOnly && row.identifier?.sectorId != null && row.identifier.sectorId !== user?.sectorId;
  const isOwner = row.uploadedBy === user?.fullName || false;
  const showRequestAccessBtn = !isOwner && (isOtherSector || !!detail?.restricted);

  const loadDetail = async () => {
    try {
      const res = await api.get<{ data: DocDetail }>(`/documents/${row.id}`);
      setDetail(res.data);
      if (Array.isArray(res.data.tags)) setTags(res.data.tags);
    } catch (err: any) {
      setDetailError(mapError(err, "Erro ao carregar detalhe."));
    }
  };

  const saveTags = async (next: string[]) => {
    setSavingTags(true); setDetailError("");
    try {
      const res = await api.patch<{ data: { tags: string[] } }>(`/documents/${row.id}/tags`, { tags: next });
      setTags(res.data.tags);
      onDone();
    } catch (err: any) {
      setDetailError(mapError(err, "Erro ao guardar tags."));
    } finally {
      setSavingTags(false);
    }
  };

  const togglePresetTag = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
    setTags(next);
    void saveTags(next);
  };

  const addCustomTag = () => {
    const t = customTag.trim();
    if (!t || tags.includes(t)) return;
    const next = [...tags, t];
    setCustomTag("");
    setTags(next);
    void saveTags(next);
  };

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (!sync.isAvailable()) { setOfflineAvailable(false); }
    else {
      loadPrinters();
      sync.isDocumentCached(row.id).then(v => { if (!cancelled) setOfflineAvailable(v); }).catch(() => {});
    }
    loadDetail();

    const mime = row.mimeType || "";
    if (mime.includes("pdf") || row.filename?.toLowerCase().endsWith(".pdf")) {
      setPreviewError("");
      api.getBlob(`/documents/${row.id}/download`)
        .then((blob) => {
          if (cancelled || !blob) return;
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        })
        .catch((err: unknown) => {
          if (!cancelled) setPreviewError(mapError(err, "Pré-visualização indisponível."));
        });
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [row.id, row.mimeType, row.filename, loadPrinters]);

  const handlePrint = async () => {
    setPrintError("");
    setPrinting(true);
    try {
      const path = await sync.downloadOffline(row.id, row.filename);
      if (!path) throw new Error("Documento não disponível para impressão. Descarregue primeiro.");
      await printFile(path);
    } catch (err: unknown) {
      setPrintError(mapError(err, "Erro ao imprimir."));
    } finally {
      setPrinting(false);
    }
  };

  const pickFilePath = async (): Promise<string | File | null> => {
    if (isTauri) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Documentos", extensions: ["pdf", "txt", "md", "csv", "docx"] }],
      });
      return (selected as string) || null;
    }
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
  };

  const handleNewVersion = async (documentId: string) => {
    setBusy(true); setDetailError("");
    try {
      const picked = await pickFilePath();
      if (!picked) return;
      if (typeof picked === "string") {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("attach_document_native", {
          path: picked,
          mode: "version",
          documentId,
          uploadSource: "manual",
        });
      } else {
        const fd = new FormData();
        fd.append("file", picked);
        await api.post(`/documents/${documentId}/versions`, fd);
      }
      await loadDetail();
      onDone();
    } catch (err: any) {
      setDetailError(mapError(err, "Erro ao criar versão."));
    } finally {
      setBusy(false);
    }
  };

  const handleAddAttachment = async () => {
    if (!row.identifier?.identifier) {
      setDetailError("Identificador em falta.");
      return;
    }
    setBusy(true); setDetailError("");
    try {
      const picked = await pickFilePath();
      if (!picked) return;
      if (typeof picked === "string") {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("attach_document_native", {
          path: picked,
          identifier: row.identifier.identifier,
          mode: "attachment",
          uploadSource: "manual",
        });
      } else {
        const fd = new FormData();
        fd.append("identifier", row.identifier.identifier);
        fd.append("file", picked);
        await api.post("/documents/attachments", fd);
      }
      await loadDetail();
      onDone();
    } catch (err: any) {
      setDetailError(mapError(err, "Erro ao adicionar anexo."));
    } finally {
      setBusy(false);
    }
  };

  const downloadVersion = (documentId: string, version: number, current: boolean) => {
    const base = (import.meta as any).env?.VITE_API_URL || "";
    const url = current
      ? `${base}/documents/${documentId}/download`
      : `${base}/documents/${documentId}/versions/${version}/download`;
    if (!isTauri) {
      window.open(detail?.fileUrl && current ? detail.fileUrl : url, "_blank");
      return;
    }
    window.open(current ? (detail?.fileUrl || row.fileUrl) : url, "_blank");
  };

  const versions = detail?.versions || [];
  const attachments = detail?.attachments || [];
  const filename = detail?.filename || row.filename;
  const fileSize = detail?.fileSize ?? row.fileSize;
  const mimeType = detail?.mimeType || row.mimeType;

  return (
    <>
      <Modal title={isProfile ? `Perfil · ${row.identifier?.categoryId || "Contrato"}` : "Detalhe do Documento"} onClose={onClose} footer={
        <div className="flex flex-wrap gap-2">
          {showRequestAccessBtn && <button onClick={() => setShowRequestAccess(true)} className="docid-button-primary"><Lock className="h-4 w-4" /> Pedir Acesso</button>}
          <button onClick={onDownload} className="docid-button-secondary"><Download className="h-4 w-4" /> Descarregar</button>
          {sync.isAvailable() && (
            <button onClick={handlePrint} disabled={printing || !selectedPrinter} className="docid-button-secondary"><Printer className="h-4 w-4" /> {printing ? "A imprimir..." : "Imprimir"}</button>
          )}
          <button onClick={() => handleNewVersion(row.id)} disabled={busy} className="docid-button-secondary"><History className="h-4 w-4" /> Nova versão</button>
          <button onClick={handleAddAttachment} disabled={busy} className="docid-button-secondary"><Plus className="h-4 w-4" /> Adicionar anexo</button>
          <button onClick={() => setShowShare(true)} className="docid-button-primary"><Share2 className="h-4 w-4" /> Partilhar</button>
        </div>
      }>
        <div className="space-y-4">
          {(printError || detailError) && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{printError || detailError}</div>}
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{filename}</p>
              {offlineAvailable !== null && (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${offlineAvailable ? "bg-docid-secondary/10 text-docid-secondary" : "bg-docid-surface-high text-docid-muted"}`}>
                  {offlineAvailable ? "Disponível offline" : "Não disponível offline"}
                </span>
              )}
            </div>
            <p className="text-xs text-docid-muted">{fileSize ? `${(fileSize / 1024 / 1024).toFixed(2)} MB · ${mimeType}` : mimeType}</p>
          </div>

          {isProfile && (
            <div className="rounded-lg border border-docid-outline/20 bg-docid-surface-low p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-docid-muted"><Tag className="h-3.5 w-3.5" /> Tags do perfil</p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {DOCUMENT_PRESET_TAGS.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    disabled={savingTags}
                    onClick={() => togglePresetTag(tag)}
                    className={`rounded-full px-2.5 py-1 text-[11px] ${tags.includes(tag) ? "bg-docid-primary/20 text-docid-primary-soft" : "bg-docid-surface-high text-docid-muted"}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={customTag}
                  onChange={e => setCustomTag(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } }}
                  className="docid-input flex-1 text-xs"
                  placeholder="Tag personalizada…"
                  disabled={savingTags}
                />
                <button type="button" onClick={addCustomTag} disabled={savingTags || !customTag.trim()} className="docid-button-secondary text-xs">Adicionar</button>
              </div>
              {tags.filter(t => !(DOCUMENT_PRESET_TAGS as readonly string[]).includes(t)).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {tags.filter(t => !(DOCUMENT_PRESET_TAGS as readonly string[]).includes(t)).map(tag => (
                    <button
                      key={tag}
                      type="button"
                      disabled={savingTags}
                      onClick={() => { const next = tags.filter(t => t !== tag); setTags(next); void saveTags(next); }}
                      className="rounded-full bg-docid-surface-high px-2 py-0.5 text-[10px] text-docid-muted"
                      title="Remover"
                    >
                      {tag} ×
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {(previewUrl || previewError) && (
            <div>
              <p className="mb-2 text-xs font-semibold text-docid-muted">Pré-visualização</p>
              {previewError && <p className="text-xs text-docid-error">{previewError}</p>}
              {previewUrl && (
                <iframe
                  title="Pré-visualização PDF"
                  src={previewUrl}
                  className="h-80 w-full rounded border border-docid-outline/20 bg-docid-surface-low"
                />
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs text-docid-muted">Identificador</p><p className="font-mono text-xs font-medium">{row.identifier?.identifier || "-"}</p></div>
            <div><p className="text-xs text-docid-muted">Categoria</p><p className="font-medium">{row.identifier?.categoryName || "-"}</p></div>
            <div><p className="text-xs text-docid-muted">Estado</p><StatusChip tone={row.status === "active" || row.status === "attached" ? "success" : "neutral"}>{row.status}</StatusChip></div>
            <div><p className="text-xs text-docid-muted">Carregado por</p><p className="font-medium">{row.uploadedBy || "-"}</p></div>
            <div className="col-span-2"><p className="text-xs text-docid-muted">Criado em</p><p className="font-medium">{new Date(row.createdAt).toLocaleString("pt-AO")}</p></div>
          </div>

          {versions.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-docid-muted">Versões</p>
              <ul className="space-y-1">
                {versions.map(v => (
                  <li key={v.id} className="flex items-center justify-between gap-2 rounded border border-docid-outline/15 px-2 py-1.5 text-xs">
                    <div>
                      <span className="font-medium">v{v.version}</span>
                      {v.isCurrent && <span className="ml-2 text-docid-secondary">actual</span>}
                      <span className="ml-2 text-docid-muted">{v.filename}</span>
                      <span className="ml-2 text-docid-muted">{new Date(v.createdAt).toLocaleString("pt-AO")}</span>
                    </div>
                    <button type="button" className="text-docid-primary" onClick={() => downloadVersion(row.id, v.version, v.isCurrent)}>
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold text-docid-muted">Anexos</p>
            {attachments.length === 0 ? (
              <p className="text-xs text-docid-muted">Nenhum anexo.</p>
            ) : (
              <ul className="space-y-1">
                {attachments.map(a => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded border border-docid-outline/15 px-2 py-1.5 text-xs">
                    <div>
                      <span className="font-medium">{a.label || a.filename || a.id}</span>
                      {a.fileSize != null && <span className="ml-2 text-docid-muted">{(a.fileSize / 1024).toFixed(0)} KB</span>}
                    </div>
                    <div className="flex gap-1">
                      <button type="button" className="text-docid-primary" title="Nova versão do anexo" onClick={() => handleNewVersion(a.id)} disabled={busy}>
                        <History className="h-3.5 w-3.5" />
                      </button>
                      <a href={`${row.fileUrl.replace(row.id, a.id)}`} target="_blank" rel="noreferrer" className="text-docid-primary">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
      {showShare && <ShareDocumentModal identifier={identCode} onClose={() => setShowShare(false)} onShared={() => { setShowShare(false); onDone(); }} />}
      {showRequestAccess && <RequestAccessModal identifier={identCode} onClose={() => setShowRequestAccess(false)} onDone={() => { setShowRequestAccess(false); onDone(); }} />}
    </>
  );
}

function RequestAccessModal({ identifier, onClose, onDone }: { identifier: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      await api.post(`/documents/${identifier}/request-access`, { reason: reason.trim() || undefined });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.error?.message || err.message || "Erro ao solicitar acesso.");
    } finally { setLoading(false); }
  };

  return (
    <Modal title="Pedir Acesso ao Documento" onClose={onClose} footer={
      success
        ? <button onClick={onDone} className="docid-button-primary">Fechar</button>
        : <><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleSubmit} disabled={loading} className="docid-button-primary">{loading ? "A enviar..." : "Enviar Pedido"}</button></>
    }>
      <div className="space-y-4">
        <p className="font-mono text-xs text-docid-muted">{identifier}</p>
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        {success ? (
          <div className="rounded-lg border border-docid-secondary/30 bg-docid-secondary/10 p-3 text-sm text-docid-secondary">
            Pedido de acesso enviado. O supervisor do sector emitente será notificado.
          </div>
        ) : (
          <>
            <p className="text-sm text-docid-muted">Solicite acesso ao supervisor do sector que emitiu este documento. Pode indicar o motivo do pedido.</p>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="docid-input w-full" placeholder="Motivo do pedido (opcional)..." />
          </>
        )}
      </div>
    </Modal>
  );
}
