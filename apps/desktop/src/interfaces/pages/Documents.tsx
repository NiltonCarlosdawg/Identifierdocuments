import { useState, useEffect, useCallback } from "react";
import { api, sync } from "../../infrastructure/di/container";
import { PageHeader, Modal, StatusChip, EmptyState, Pagination } from "../components/docid-ui";
import ShareDocumentModal from "../components/ShareDocumentModal";
import ClassifierSuggestion from "../components/ClassifierSuggestion";
import type { ClassifierResult } from "../hooks/useClassifier";
import { FileText, Upload, Download, Share2, Search } from "lucide-react";

interface DocRow { id: string; filename: string; fileSize: number; mimeType: string; status: string; createdAt: string; fileUrl: string; thumbnailUrl: string; identifier: { id: string; identifier: string; categoryId: string; categoryName: string } | null; uploadedBy: string | null; }

export default function Documents() {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [selected, setSelected] = useState<DocRow | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async (page = 1) => {
    setLoading(true); setError("");
    try {
      const res = await api.get<{ data: DocRow[]; meta: { total: number; page: number; limit: number } }>(`/documents?page=${page}&limit=20`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (err: any) { setError(err.message || "Erro ao carregar documentos."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="Documentos" description="Gerir os documentos associados a identificadores" actions={
        <button onClick={() => setShowUpload(true)} className="docid-button-primary"><Upload className="h-4 w-4" /> Anexar</button>
      } />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
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
                <td><button onClick={e => { e.stopPropagation(); window.open(row.fileUrl, "_blank"); }} className="rounded p-1 text-docid-muted hover:text-docid-text"><Download className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <Pagination totalLabel={`${meta.total} documento(s)`} />
      </div>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); load(); }} />}
      {selected && <DetailModal row={selected} onClose={() => setSelected(null)} onDone={() => load()} />}
    </div>
  );
}

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const isTauri = sync.isAvailable();
  const [identifier, setIdentifier] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tauriFilePath, setTauriFilePath] = useState("");
  const [tauriFilename, setTauriFilename] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [classifierText, setClassifierText] = useState("");
  const [classifierResult, setClassifierResult] = useState<ClassifierResult | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const handleTauriSelect = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Documentos", extensions: ["pdf", "txt", "md", "csv"] }],
      });
      if (!selected) return;
      const path = selected as string;
      setTauriFilePath(path);
      setTauriFilename(path.split("/").pop() || path.split("\\").pop() || "documento");
      setClassifierText(""); setClassifierResult(null); setFeedbackSent(false);
      setExtracting(true);
      const { invoke } = await import("@tauri-apps/api/core");
      const text = await invoke<string>("extract_text_command", { path });
      setClassifierText(text.slice(0, 4000));
      setExtracting(false);
    } catch (err: any) {
      setExtracting(false);
      setError(err.message || "Erro ao seleccionar ou extrair ficheiro.");
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
    setError(""); setLoading(true);
    try {
      if (isTauri && tauriFilePath) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("attach_document_native", {
          path: tauriFilePath,
          identifier: identifier.trim(),
          uploadSource: "manual",
        });
      } else if (file) {
        const fd = new FormData();
        fd.append("identifier", identifier.trim());
        fd.append("file", file);
        await api.post("/documents/attach", fd);
      }
      onDone();
    } catch (err: any) { setError(err.message || "Erro ao anexar documento."); } finally { setLoading(false); }
  };

  const hasFile = isTauri ? !!tauriFilePath : !!file;
  const fileName = isTauri ? tauriFilename : file?.name || "";
  const fileInfo = isTauri ? tauriFilePath.split("/").pop() || tauriFilePath : file ? `${(file.size / 1024 / 1024).toFixed(2)} MB — ${file.type || "tipo desconhecido"}` : "";

  return (
    <Modal title="Anexar Documento" onClose={onClose} footer={<><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleUpload} disabled={loading || !hasFile || !identifier.trim() || !feedbackSent} className="docid-button-primary">{loading ? "A enviar..." : "Anexar"}</button></>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}

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

function DetailModal({ row, onClose, onDone }: { row: DocRow; onClose: () => void; onDone: () => void }) {
  const [showShare, setShowShare] = useState(false);
  const identCode = row.identifier?.identifier || row.id;

  return (
    <>
      <Modal title="Detalhe do Documento" onClose={onClose} footer={
        <div className="flex gap-2">
          <button onClick={() => window.open(row.fileUrl, "_blank")} className="docid-button-secondary"><Download className="h-4 w-4" /> Descarregar</button>
          <button onClick={() => setShowShare(true)} className="docid-button-primary"><Share2 className="h-4 w-4" /> Partilhar</button>
        </div>
      }>
        <div className="space-y-4">
          <div><p className="text-sm font-medium">{row.filename}</p><p className="text-xs text-docid-muted">{(row.fileSize / 1024 / 1024).toFixed(2)} MB · {row.mimeType}</p></div>
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
