import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../../infrastructure/di/container";
import { friendlyMime } from "../../../shared/errors/mapError";
import { fitPage, previewKind, sanitizeDocHtml, A4_RATIO, A4_CSS_WIDTH, type PreviewKind } from "./preview-utils";
import { FileText, Loader2 } from "lucide-react";

/**
 * Pré-visualização da PRIMEIRA PÁGINA, como no Word Online: uma folha branca com a proporção
 * da página, encaixada no espaço disponível. Clicar na folha abre o documento completo.
 *
 * Tudo é desenhado pela app (sem o visualizador do motor web): o WebKitGTK do Linux não tem
 * visualizador de PDF e a CSP do Tauri bloqueia <iframe> com blob:.
 * - PDF: pdf.js desenha só a página 1 em <canvas>, com a proporção real dessa página;
 * - Word (.docx): mammoth → HTML (com lista de elementos permitidos), paginado à largura de uma
 *   folha A4 e reduzido para caber; o que passa da primeira folha fica cortado;
 * - texto e CSV: na mesma folha A4; imagens: a própria imagem.
 * As bibliotecas só são carregadas quando aparece um ficheiro desse tipo.
 */
export default function DocumentPreview({ documentId, mime, filename, thumbnailUrl, onOpen }: {
  documentId: string; mime: string; filename: string; thumbnailUrl: string | null;
  /** Clicar na folha abre o documento completo. */
  onOpen?: () => void;
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

  const fallback = (unavailable: boolean) => <Fallback mime={mime} filename={filename} thumbnailUrl={thumbnailUrl} unavailable={unavailable} />;
  if (kind === "none" || error) return fallback(error);
  if (!blob) return <Loading />;
  if (kind === "pdf") return <PdfFirstPage blob={blob} onOpen={onOpen} fallback={fallback(true)} />;
  if (kind === "image") return <ImagePreview blob={blob} filename={filename} onOpen={onOpen} />;
  return <A4FirstPage blob={blob} kind={kind} onOpen={onOpen} fallback={fallback(true)} />;
}

/* ───────────────────────── Folha (primeira página) ───────────────────────── */

/** Mede o espaço disponível e devolve o tamanho da folha que cabe nele com a proporção dada. */
function useSheetSize(ratio: number, reserve = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const measure = () => setSize(fitPage(el.clientWidth - 24, el.clientHeight - reserve, ratio));
    measure();
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(measure, 100); });
    ro.observe(el);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [ratio, reserve]);
  return { ref, size };
}

function Sheet({ width, height, onOpen, children, testId }: { width: number; height: number; onOpen?: () => void; children: ReactNode; testId: string }) {
  return (
    <button type="button" onClick={onOpen} disabled={!onOpen} title={onOpen ? "Abrir o documento completo" : undefined} data-testid={testId}
      style={{ width, height }}
      className="relative block shrink-0 overflow-hidden rounded-sm bg-white text-left shadow-[0_2px_12px_rgba(0,0,0,0.45)] ring-1 ring-black/10 transition hover:ring-2 hover:ring-docid-primary disabled:cursor-default">
      {children}
    </button>
  );
}

function SheetArea({ areaRef, caption, children }: { areaRef: React.RefObject<HTMLDivElement>; caption?: ReactNode; children: ReactNode }) {
  return (
    <div ref={areaRef} className="flex h-full min-h-[18rem] flex-col items-center gap-2 rounded-lg bg-docid-surface-low/60 p-3">
      <div className="flex min-h-0 flex-1 items-start justify-center">{children}</div>
      {caption && <p className="text-[11px] text-docid-muted" data-testid="preview-caption">{caption}</p>}
    </div>
  );
}

const CAPTION_SPACE = 30; // px para a legenda por baixo da folha

function PdfFirstPage({ blob, onOpen, fallback }: { blob: Blob; onOpen?: () => void; fallback: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<any>(null);
  const docRef = useRef<any>(null);
  const [ratio, setRatio] = useState(A4_RATIO);
  const [pages, setPages] = useState(0);
  const [failed, setFailed] = useState(false);
  const { ref, size } = useSheetSize(ratio, CAPTION_SPACE + 24);

  useEffect(() => {
    let cancelled = false;
    setFailed(false); setPages(0);
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
        const first = await doc.getPage(1);
        if (cancelled) return;
        pageRef.current = first;
        const vp = first.getViewport({ scale: 1 });
        setRatio(vp.height / vp.width); // proporção real (A4, carta, horizontal...)
        setPages(doc.numPages);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; void docRef.current?.destroy?.(); docRef.current = null; pageRef.current = null; };
  }, [blob]);

  // Desenha a página 1 ao tamanho da folha (e volta a desenhar quando a folha muda de tamanho).
  useEffect(() => {
    const p = pageRef.current;
    const canvas = canvasRef.current;
    if (!p || !canvas || !pages || !size.width) return;
    let task: any = null;
    let cancelled = false;
    (async () => {
      try {
        const dpr = window.devicePixelRatio || 1;
        const base = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: (size.width / base.width) * dpr });
        canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${size.width}px`; canvas.style.height = `${size.height}px`;
        task = p.render({ canvasContext: canvas.getContext("2d")!, viewport });
        await task.promise;
      } catch (err: any) {
        if (!cancelled && err?.name !== "RenderingCancelledException") setFailed(true);
      }
    })();
    return () => { cancelled = true; task?.cancel?.(); };
  }, [pages, size.width, size.height]);

  if (failed) return <>{fallback}</>;
  return (
    <SheetArea areaRef={ref} caption={pages ? `Primeira página · ${pages} ${pages === 1 ? "página" : "páginas"}` : undefined}>
      {!pages || !size.width ? <Spinner text="A abrir o PDF..." /> : (
        <Sheet width={size.width} height={size.height} onOpen={onOpen} testId="preview-pdf">
          <canvas ref={canvasRef} className="block" />
        </Sheet>
      )}
    </SheetArea>
  );
}

const TEXT_LIMIT = 60_000; // chega e sobra para uma folha

/** Word, texto e CSV: conteúdo à largura real de uma folha A4, reduzido para caber; só a 1.ª folha. */
function A4FirstPage({ blob, kind, onOpen, fallback }: { blob: Blob; kind: PreviewKind; onOpen?: () => void; fallback: ReactNode }) {
  const [content, setContent] = useState<{ html?: string; text?: string; rows?: string[][] } | null>(null);
  const [failed, setFailed] = useState(false);
  const { ref, size } = useSheetSize(A4_RATIO, 24);

  useEffect(() => {
    let cancelled = false;
    setContent(null); setFailed(false);
    (async () => {
      try {
        if (kind === "docx") {
          const mammoth: any = await import("mammoth/mammoth.browser");
          const res = await (mammoth.default ?? mammoth).convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
          if (!cancelled) setContent({ html: sanitizeDocHtml(res.value || "") || "<p><em>Documento sem texto.</em></p>" });
        } else {
          const text = await blob.slice(0, TEXT_LIMIT).text();
          if (cancelled) return;
          if (kind === "csv") setContent({ rows: text.split(/\r?\n/).filter(Boolean).slice(0, 80).map(l => l.split(/[;,]/)) });
          else setContent({ text: text || "(ficheiro vazio)" });
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [blob, kind]);

  if (failed) return <>{fallback}</>;
  const scale = size.width / A4_CSS_WIDTH;
  const testId = kind === "docx" ? "preview-docx" : kind === "csv" ? "preview-csv" : "preview-text";
  return (
    <SheetArea areaRef={ref}>
      {!content || !size.width ? <Spinner text="A preparar a pré-visualização..." /> : (
        <Sheet width={size.width} height={size.height} onOpen={onOpen} testId={testId}>
          {/* Folha A4 "real" (794×1123 px a 96 ppp) reduzida por transform: só cabe a 1.ª página. */}
          <div style={{ width: A4_CSS_WIDTH, height: A4_CSS_WIDTH * A4_RATIO, transform: `scale(${scale})`, transformOrigin: "top left" }}
            className="overflow-hidden p-[72px] text-[14px] leading-relaxed text-neutral-900">
            {content.html !== undefined && <div className="docid-doc-preview" dangerouslySetInnerHTML={{ __html: content.html }} />}
            {content.text !== undefined && <pre className="whitespace-pre-wrap break-words font-mono text-[13px]">{content.text}</pre>}
            {content.rows && (
              <table className="w-full border-collapse text-[13px]">
                <tbody>{content.rows.map((r, i) => (
                  <tr key={i} className={i === 0 ? "bg-neutral-100 font-semibold" : ""}>
                    {r.map((c, j) => <td key={j} className="border border-neutral-300 px-2 py-1">{c}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </Sheet>
      )}
    </SheetArea>
  );
}

function ImagePreview({ blob, filename, onOpen }: { blob: Blob; filename: string; onOpen?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url) return <Loading />;
  return (
    <button type="button" onClick={onOpen} disabled={!onOpen} title={onOpen ? "Abrir o documento completo" : undefined}
      className="block h-full min-h-[18rem] w-full rounded-lg bg-docid-surface-low/60 p-3 disabled:cursor-default">
      <img src={url} alt={filename} className="mx-auto h-full max-w-full object-contain shadow-[0_2px_12px_rgba(0,0,0,0.45)]" data-testid="preview-image" />
    </button>
  );
}

/* ───────────────────────── Estados ───────────────────────── */

function Spinner({ text }: { text: string }) {
  return <div className="flex h-48 items-center justify-center gap-2 text-xs text-docid-muted" data-testid="preview-loading"><Loader2 className="h-4 w-4 animate-spin" /> {text}</div>;
}

function Loading() {
  return <div className="flex h-full min-h-[18rem] items-center justify-center rounded-lg bg-docid-surface-low/60"><Spinner text="A preparar a pré-visualização..." /></div>;
}

function Fallback({ mime, filename, thumbnailUrl, unavailable }: { mime: string; filename: string; thumbnailUrl: string | null; unavailable?: boolean }) {
  if (thumbnailUrl) {
    return <img src={thumbnailUrl} alt={`Miniatura de ${filename}`} className="max-h-64 w-full rounded-lg bg-docid-surface-low object-contain" data-testid="preview-thumbnail" />;
  }
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-docid-border text-docid-muted" data-testid="preview-none">
      <FileText className="h-8 w-8" />
      <span className="text-xs">{friendlyMime(mime)} · {unavailable ? "não foi possível pré-visualizar" : "sem pré-visualização"}. Use "Abrir".</span>
    </div>
  );
}
