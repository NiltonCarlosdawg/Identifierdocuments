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
import { FileText, Upload, Download, Share2, Search } from "lucide-react";

interface DocRow { id: string; filename: string; fileSize: number; mimeType: string; status: string; createdAt: string; fileUrl: string; thumbnailUrl: string; identifier: { id: string; identifier: string; categoryId: string; categoryName: string } | null; uploadedBy: string | null; }

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
    if (!sync.isAvailable()) { window.open(row.fileUrl, "_blank"); return; }
    try {
      const path = await sync.downloadOffline(row.id, row.filename);
      if (path) { await sync.openLocalFile(path); return; }
      window.open(row.fileUrl, "_blank");
    } catch (err: any) {
      setDownloadError(err?.message || "Documento não disponível offline.");
    }
  };

  return (
    <div>
      <PageHeader title="Documentos" description="Gerir os documentos associados a identificadores" actions={
        <button onClick={() => setShowUpload(true)} className="docid-button-primary"><Upload className="h-4 w-4" /> Anexar</button>
      } />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}
      {downloadError && <div className="mb-4 rounded-lg border border-docid-tertiary/30 bg-docid-tertiary/10 p-3 text-sm text-docid-tertiary">{downloadError}</div>}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input value={search} onChange={e => setSearch(e.target.value)} className="docid-input w-full pl-9" placeholder="Pesquisar documento..." /></div>
      </div>
      <div className="docid-panel overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-docid-muted">A carregar...</div>
        ) : rows.length === 0 ? (
          <EmptyState>Nenhum documento encontrado.</EmptyState>
        ) : (
          <table className="docid-table">
            <thead><tr><th>Ficheiro</th><th>Identificador</th><th>Categoria</th><th>Estado</th><th>Carregado por</th><th>Data</th><th></th></tr></thead>
            <tbody>{rows.filter(r => !search || r.filename.toLowerCase().includes(search.toLowerCase()) || r.identifier?.identifier.toLowerCase().includes(search.toLowerCase())).map(row => (
              <tr key={row.id} className="cursor-pointer" onClick={() => setSelected(row)}>
                <td className="max-w-48 truncate font-medium">{row.filename}</td>
                <td className="font-mono text-xs">{row.identifier?.identifier || "-"}</td>
                <td className="text-xs text-docid-muted">{row.identifier?.categoryName || "-"}</td>
                <td><StatusChip tone={row.status === "active" ? "success" : row.status === "cancelled" ? "error" : "neutral"}>{row.status}</StatusChip></td>
                <td className="text-xs text-docid-muted">{row.uploadedBy || "-"}</td>
                <td className="text-xs text-docid-muted">{new Date(row.createdAt).toLocaleDateString("pt-AO")}</td>
                <td><button onClick={e => { e.stopPropagation(); handleOpen(row); }} className="rounded p-1 text-docid-muted hover:text-docid-text"><Download className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <Pagination totalLabel={`${meta.total} documento(s)`} />
      </div>

      {showUpload && <UploadModal onClose={closeUpload} onDone={finishUpload} initialPath={attachPath || ""} initialIdentifier={attachIdentifier} />}
      {selected && <DetailModal row={selected} onClose={() => setSelected(null)} onDone={() => refresh()} onDownload={() => handleOpen(selected)} />}
    </div>
  );
}

function UploadModal({ onClose, onDone, initialPath = "", initialIdentifier = "" }: { onClose: () => void; onDone: () => void | Promise<void>; initialPath?: string; initialIdentifier?: string }) {
  const isTauri = sync.isAvailable();
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [file, setFile] = useState<File | null>(null);
  const [tauriFilePath, setTauriFilePath] = useState(initialPath);
  const [tauriFilename, setTauriFilename] = useState(() => initialPath.split("/").pop() || initialPath.split("\\").pop() || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [queued, setQueued] = useState(false);
  const [classifierText, setClassifierText] = useState("");
  const [classifierResult, setClassifierResult] = useState<ClassifierResult | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(!!initialIdentifier);
  const [extracting, setExtracting] = useState(false);

  const applyTauriPath = async (path: string) => {
    setTauriFilePath(path);
    setTauriFilename(path.split("/").pop() || path.split("\\").pop() || "documento");
    setClassifierText(""); setClassifierResult(null);
    if (!initialIdentifier) setFeedbackSent(false);
    setExtracting(true);
    const { invoke } = await import("@tauri-apps/api/core");
    const text = await invoke<string>("extract_text_command", { path });
    setClassifierText(text.slice(0, 4000));
    setExtracting(false);
  };

  useEffect(() => {
    if (!isTauri || !initialPath) return;
    applyTauriPath(initialPath).catch((err: unknown) => {
      setExtracting(false);
      setError(mapError(err, "Erro ao seleccionar ou extrair ficheiro."));
    });
  }, []);

  const handleTauriSelect = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Documentos", extensions: ["pdf", "txt", "md", "csv", "docx"] }],
      });
      if (!selected) return;
      await applyTauriPath(selected as string);
    } catch (err: any) {
      setExtracting(false);
      setError(mapError(err, "Erro ao seleccionar ou extrair ficheiro."));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
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

  const handleUpload = async () => {
    if (!hasFile || !identifier.trim()) return;
    setError(""); setLoading(true); setQueued(false);
    const user = useAuthStore.getState().user;
    try {
      if (isTauri && tauriFilePath) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("attach_document_native", {
            path: tauriFilePath,
            identifier: identifier.trim(),
            uploadSource: "manual",
          });
        } catch (err: any) {
          if (!isNetworkError(err)) throw err;
          if (!user?.tenantId || !user?.id) throw err;
          const item = await sync.enqueueFromPath(tauriFilePath, identifier.trim(), user.tenantId, user.id);
          if (!item) throw err;
          useQueueStore.getState().refresh().catch(() => {});
          if (initialPath && watcher.isAvailable()) {
            await watcher.setFileStatus(initialPath, "added").catch(() => {});
          }
          setQueued(true);
          setLoading(false);
          return;
        }
        await onDone();
        return;
      }
      if (file) {
        const fd = new FormData();
        fd.append("identifier", identifier.trim());
        fd.append("file", file);
        await api.post("/documents/attach", fd);
      }
      await onDone();
    } catch (err: any) { setError(mapError(err, "Erro ao anexar documento.")); } finally { setLoading(false); }
  };

  const hasFile = isTauri ? !!tauriFilePath : !!file;
  const fileName = isTauri ? tauriFilename : file?.name || "";
  const fileInfo = isTauri ? tauriFilePath.split("/").pop() || tauriFilePath : file ? `${(file.size / 1024 / 1024).toFixed(2)} MB — ${file.type || "tipo desconhecido"}` : "";

  return (
    <Modal title="Anexar Documento" onClose={onClose} footer={
      queued
        ? <button onClick={onClose} className="docid-button-primary">Concluir</button>
        : <><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleUpload} disabled={loading || !hasFile || !identifier.trim() || !feedbackSent} className="docid-button-primary">{loading ? "A enviar..." : "Anexar"}</button></>
    }>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        {queued && <div className="rounded-lg border border-docid-secondary/30 bg-docid-secondary/10 p-3 text-sm text-docid-secondary">Guardado na fila offline — será enviado automaticamente quando houver ligação.</div>}

        {!isTauri && <div className="rounded-lg border border-docid-tertiary/30 bg-docid-tertiary/10 p-3 text-xs text-docid-tertiary">Extracção de texto só disponível na app desktop.</div>}

        {isTauri ? (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Ficheiro</label>
            <button onClick={handleTauriSelect} className="docid-button-secondary w-full justify-start"><Upload className="h-4 w-4" /> {tauriFilePath ? "Alterar ficheiro..." : "Seleccionar ficheiro..."}</button>
          </div>
        ) : (
          <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Ficheiro</label><input type="file" onChange={handleFileChange} className="docid-input w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-docid-primary file:px-3 file:py-1 file:text-xs file:font-medium file:text-white" /></div>
        )}

        {fileName && <p className="text-xs text-docid-muted truncate">{fileName}{fileInfo ? ` — ${fileInfo}` : ""}</p>}

        {extracting && <p className="text-xs text-docid-muted">A extrair texto do ficheiro...</p>}

        {classifierText && !feedbackSent && (
          <ClassifierSuggestion
            text={classifierText}
            filename={fileName}
            onSelect={handleClassifierSelect}
            onClassified={setClassifierResult}
          />
        )}

        {feedbackSent && <div className="rounded-lg border border-docid-secondary/30 bg-docid-secondary/10 p-3 text-xs text-docid-secondary">Classificação registada. Pode prosseguir com o upload.</div>}

        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Identificador</label><input value={identifier} onChange={e => setIdentifier(e.target.value)} className="docid-input w-full font-mono" placeholder="Ex: VL-PROP-2026-0725-001" /></div>
      </div>
    </Modal>
  );
}

function DetailModal({ row, onClose, onDone, onDownload }: { row: DocRow; onClose: () => void; onDone: () => void; onDownload: () => Promise<void> }) {
  const [showShare, setShowShare] = useState(false);
  const [offlineAvailable, setOfflineAvailable] = useState<boolean | null>(null);
  const identCode = row.identifier?.identifier || row.id;

  useEffect(() => {
    let cancelled = false;
    if (!sync.isAvailable()) { setOfflineAvailable(false); return; }
    sync.isDocumentCached(row.id).then(v => { if (!cancelled) setOfflineAvailable(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, [row.id]);

  return (
    <>
      <Modal title="Detalhe do Documento" onClose={onClose} footer={
        <div className="flex gap-2">
          <button onClick={onDownload} className="docid-button-secondary"><Download className="h-4 w-4" /> Descarregar</button>
          <button onClick={() => setShowShare(true)} className="docid-button-primary"><Share2 className="h-4 w-4" /> Partilhar</button>
        </div>
      }>
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{row.filename}</p>
              {offlineAvailable !== null && (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${offlineAvailable ? "bg-docid-secondary/10 text-docid-secondary" : "bg-docid-surface-high text-docid-muted"}`}>
                  {offlineAvailable ? "Disponível offline" : "Não disponível offline"}
                </span>
              )}
            </div>
            <p className="text-xs text-docid-muted">{(row.fileSize / 1024 / 1024).toFixed(2)} MB · {row.mimeType}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs text-docid-muted">Identificador</p><p className="font-mono text-xs font-medium">{row.identifier?.identifier || "-"}</p></div>
            <div><p className="text-xs text-docid-muted">Categoria</p><p className="font-medium">{row.identifier?.categoryName || "-"}</p></div>
            <div><p className="text-xs text-docid-muted">Estado</p><StatusChip tone={row.status === "active" ? "success" : "neutral"}>{row.status}</StatusChip></div>
            <div><p className="text-xs text-docid-muted">Carregado por</p><p className="font-medium">{row.uploadedBy || "-"}</p></div>
            <div className="col-span-2"><p className="text-xs text-docid-muted">Criado em</p><p className="font-medium">{new Date(row.createdAt).toLocaleString("pt-AO")}</p></div>
          </div>
        </div>
      </Modal>
      {showShare && <ShareDocumentModal identifier={identCode} onClose={() => setShowShare(false)} onShared={() => { setShowShare(false); onDone(); }} />}
    </>
  );
}
