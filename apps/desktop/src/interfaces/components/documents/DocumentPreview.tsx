import { useEffect, useRef, useState } from "react";
import { api } from "../../../infrastructure/di/container";
import { friendlyMime } from "../../../shared/errors/mapError";
import { previewKind, sanitizeDocHtml, type PreviewKind } from "./preview-utils";
import { ChevronLeft, ChevronRight, FileText, Loader2 } from "lucide-react";

/**
 * Pré-visualização dentro da app, sem depender do visualizador do motor web:
 * - PDF: pdf.js desenha em <canvas> (o WebKitGTK do Linux não tem visualizador de PDF e a
 *   CSP do Tauri bloqueia <iframe> com blob:, por isso o iframe antigo ficava sempre vazio);
 * - Word (.docx): mammoth converte para HTML, que passa por uma lista de elementos permitidos;
 * - texto/CSV/Markdown: mostrado como texto; imagens: <img> com blob: (permitido pela CSP).
 * As bibliotecas só são carregadas quando aparece um ficheiro desse tipo.
 */
export default function DocumentPreview({ documentId, mime, filename, thumbnailUrl }: {
  documentId: string; mime: string; filename: string; thumbnailUrl: string | null;
}) {
  const kind = previewKind(mime, filename);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBlob(null); setError(false);
    if (kind === "none") return;
    api.getBlob(`/documents/${documentId}/download`)
      .then(b => { if (!cancelled) { if (b) setBlob(b); else setError(true); } })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [documentId, kind]);

  if (kind === "none" || error) return <Fallback mime={mime} filename={filename} thumbnailUrl={thumbnailUrl} unavailable={error} />;
  if (!blob) return <Loading />;
  if (kind === "pdf") return <PdfPreview blob={blob} fallback={<Fallback mime={mime} filename={filename} thumbnailUrl={thumbnailUrl} unavailable />} />;
  if (kind === "docx") return <DocxPreview blob={blob} fallback={<Fallback mime={mime} filename={filename} thumbnailUrl={thumbnailUrl} unavailable />} />;
  if (kind === "image") return <ImagePreview blob={blob} filename={filename} />;
  return <TextPreview blob={blob} kind={kind} />;
}

// Sem cor de fundo: cada tipo escolhe a sua (PDF e Word em branco, como no papel).
const FRAME = "rounded-lg border border-docid-border";
const DARK = "bg-docid-surface-low";

function Loading() {
  return (
    <div className={`flex h-48 items-center justify-center gap-2 text-xs text-docid-muted ${FRAME} ${DARK}`} data-testid="preview-loading">
      <Loader2 className="h-4 w-4 animate-spin" /> A preparar a pré-visualização...
    </div>
  );
}

function Fallback({ mime, filename, thumbnailUrl, unavailable }: { mime: string; filename: string; thumbnailUrl: string | null; unavailable?: boolean }) {
  if (thumbnailUrl) {
    return <img src={thumbnailUrl} alt={`Miniatura de ${filename}`} className={`max-h-64 w-full object-contain ${FRAME} ${DARK}`} data-testid="preview-thumbnail" />;
  }
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-docid-border text-docid-muted" data-testid="preview-none">
      <FileText className="h-8 w-8" />
      <span className="text-xs">{friendlyMime(mime)} · {unavailable ? "não foi possível pré-visualizar" : "sem pré-visualização"}. Use "Abrir".</span>
    </div>
  );
}

function PdfPreview({ blob, fallback }: { blob: Blob; fallback: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false); setPages(0); setPage(1);
    (async () => {
      try {
        // pdf.js 4 usa Promise.withResolvers, que só existe no WebKitGTK recente (Linux).
        if (!(Promise as any).withResolvers) {
          (Promise as any).withResolvers = () => {
            let resolve: any, reject: any;
            const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
            return { promise, resolve, reject };
          };
        }
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        // isEvalSupported: false — a CSP do Tauri não permite eval/new Function.
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
        if (cancelled) { void doc.destroy(); return; }
        docRef.current = doc;
        setPages(doc.numPages);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; void docRef.current?.destroy?.(); docRef.current = null; };
  }, [blob]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !pages || !canvasRef.current || !boxRef.current) return;
    let task: any = null;
    let cancelled = false;
    (async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled) return;
        const width = boxRef.current!.clientWidth || 400;
        const base = p.getViewport({ scale: 1 });
        const ratio = window.devicePixelRatio || 1;
        const viewport = p.getViewport({ scale: (width / base.width) * ratio });
        const canvas = canvasRef.current!;
        canvas.width = viewport.width; canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / ratio}px`; canvas.style.height = `${viewport.height / ratio}px`;
        task = p.render({ canvasContext: canvas.getContext("2d")!, viewport });
        await task.promise;
      } catch (err: any) {
        if (!cancelled && err?.name !== "RenderingCancelledException") setFailed(true);
      }
    })();
    return () => { cancelled = true; task?.cancel?.(); };
  }, [pages, page]);

  if (failed) return <>{fallback}</>;
  return (
    <div className="space-y-2" data-testid="preview-pdf">
      <div ref={boxRef} className={`max-h-[28rem] overflow-auto bg-white ${FRAME}`}>
        {!pages && <div className="flex h-48 items-center justify-center text-xs text-docid-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> A abrir o PDF...</div>}
        <canvas ref={canvasRef} className={pages ? "block" : "hidden"} />
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs text-docid-muted">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Página anterior" className="rounded p-1 hover:bg-docid-surface-high disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <span data-testid="preview-pdf-page">Página {page} de {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Página seguinte" className="rounded p-1 hover:bg-docid-surface-high disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

function DocxPreview({ blob, fallback }: { blob: Blob; fallback: React.ReactNode }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHtml(null); setFailed(false);
    (async () => {
      try {
        const mammoth: any = await import("mammoth/mammoth.browser");
        const res = await (mammoth.default ?? mammoth).convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
        if (!cancelled) setHtml(sanitizeDocHtml(res.value || ""));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [blob]);
  if (failed) return <>{fallback}</>;
  if (html === null) return <Loading />;
  return (
    <div className={`docid-doc-preview max-h-[28rem] overflow-auto bg-white p-5 text-[13px] leading-relaxed text-neutral-900 ${FRAME}`}
      data-testid="preview-docx" dangerouslySetInnerHTML={{ __html: html || "<p><em>Documento sem texto.</em></p>" }} />
  );
}

function ImagePreview({ blob, filename }: { blob: Blob; filename: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url) return <Loading />;
  return <img src={url} alt={filename} className={`max-h-[28rem] w-full object-contain ${FRAME} ${DARK}`} data-testid="preview-image" />;
}

const TEXT_LIMIT = 200_000;

function TextPreview({ blob, kind }: { blob: Blob; kind: PreviewKind }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    blob.slice(0, TEXT_LIMIT).text().then(t => { if (!cancelled) setText(t); }).catch(() => { if (!cancelled) setText(""); });
    return () => { cancelled = true; };
  }, [blob]);
  if (text === null) return <Loading />;
  if (kind === "csv") {
    const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 200).map(l => l.split(/[;,]/));
    return (
      <div className={`max-h-[28rem] overflow-auto ${FRAME} ${DARK}`} data-testid="preview-csv">
        <table className="w-full text-xs">
          <tbody>{rows.map((r, i) => (
            <tr key={i} className={i === 0 ? "bg-docid-surface-high font-semibold" : "border-t border-docid-border"}>
              {r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1 text-docid-text">{c}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    );
  }
  return (
    <pre className={`max-h-[28rem] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-docid-text ${FRAME} ${DARK}`} data-testid="preview-text">
      {text || "(ficheiro vazio)"}{blob.size > TEXT_LIMIT && "\n\n… (mostra só o início; use \"Abrir\" para ver tudo)"}
    </pre>
  );
}
