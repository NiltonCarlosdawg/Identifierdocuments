import { useEffect, useState } from "react";
import { api, sync } from "../../../infrastructure/di/container";
import { Modal } from "../docid-ui";
import { mapError, isNetworkError } from "../../../shared/errors/mapError";
import { useAuthStore } from "../../stores/authStore";
import { useQueueStore } from "../../stores/queueStore";
import ClassifierSuggestion from "../ClassifierSuggestion";
import type { ClassifierResult } from "../../hooks/useClassifier";
import { Upload } from "lucide-react";

/** Anexar documentos a identificadores (vários de uma vez, ou anexos ao mesmo documento). */
interface UploadRow {
  key: string;
  path?: string;
  file?: File;
  filename: string;
  identifier: string;
  status: "pending" | "ok" | "error" | "queued";
  message?: string;
}

type UploadMode = "batch" | "attachments";

export default function UploadModal({ onClose, onDone, initialPath = "", initialIdentifier = "" }: { onClose: () => void; onDone: () => void | Promise<void>; initialPath?: string; initialIdentifier?: string }) {
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
        setError(mapError(err, "Não foi possível ler o ficheiro."));
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
      setError(mapError(err, "Não foi possível seleccionar ou ler o ficheiro."));
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
    let firstError = "";

    for (const row of rows) {
      if (row.status === "ok" || row.status === "queued") continue;
      try {
        const result = await uploadOne(row, uploadMode);
        updateRow(row.key, { status: result.status, message: result.status === "queued" ? "Guardado na fila" : "Enviado" });
        anyOk = true;
      } catch (err: any) {
        const message = mapError(err, "Não foi possível enviar o ficheiro.");
        if (!firstError) firstError = message;
        updateRow(row.key, { status: "error", message });
      }
    }

    if (firstError) setError(firstError);
    setLoading(false);
    setDoneSummary(true);
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
          <button type="button" onClick={() => setMode("batch")} className={`docid-button-secondary text-xs ${mode === "batch" ? "ring-1 ring-docid-primary" : ""}`}>Vários documentos</button>
          <button type="button" onClick={() => setMode("attachments")} className={`docid-button-secondary text-xs ${mode === "attachments" ? "ring-1 ring-docid-primary" : ""}`}>Anexos ao mesmo documento</button>
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
          <div className="rounded-lg border border-docid-secondary/30 bg-docid-secondary/10 p-3 text-xs text-docid-secondary">Classificação registada. Pode continuar com o envio.</div>
        )}

        {rows.length > 0 && (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {rows.map(row => (
              <div key={row.key} className="rounded-lg border border-docid-outline/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium">{row.filename}</p>
                  {row.status !== "pending" && (
                    <span className={`shrink-0 text-[10px] font-medium ${row.status === "error" ? "text-docid-error" : "text-docid-secondary"}`}>
                      {row.status === "ok" ? "Enviado" : row.status === "queued" ? "Na fila" : "Falhou"}
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
                {row.message && <p className={`mt-1 text-xs ${row.status === "error" ? "text-docid-error" : "text-docid-muted"}`}>{row.message}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
