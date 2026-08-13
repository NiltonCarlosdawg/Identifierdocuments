import { useEffect, useMemo, useState } from "react";
import { useScannerStore } from "../stores/scannerStore";
import { usePrinterStore } from "../stores/printerStore";
import { scanner } from "../../infrastructure/di/container";
import { mapError } from "../../shared/errors/mapError";
import { PageHeader } from "../components/docid-ui";
import { Scan, Camera, RefreshCw, Download, Trash2, ChevronLeft, ChevronRight, Plus, Printer } from "lucide-react";

export default function Scanner() {
  const { devices, selectedDevice, scanning, error, pages, currentPage, options, loadDevices, selectDevice, setOptions, scan, setCurrentPage, removeCurrentPage, clearScan } = useScannerStore();
  const { printers, selectedPrinter, loadPrinters, selectPrinter, printBytes } = usePrinterStore();
  const [available, setAvailable] = useState(true);
  const [printInfo, setPrintInfo] = useState("");
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    setAvailable(scanner.isAvailable());
    loadDevices();
    loadPrinters();
  }, [loadDevices, loadPrinters]);

  const page = pages[currentPage] ?? null;
  const hasPages = pages.length > 0;
  const mime = options.format === "png" ? "image/png" : "application/pdf";
  const previewUrl = useMemo(() => {
    if (!page || page.length === 0) return null;
    return URL.createObjectURL(new Blob([page.buffer as ArrayBuffer], { type: mime }));
  }, [page, mime]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const downloadPage = (index: number) => {
    const bytes = pages[index];
    if (!bytes) return;
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `digitalizacao_${Date.now()}_p${index + 1}.${options.format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    pages.forEach((_, i) => setTimeout(() => downloadPage(i), i * 250));
  };

  const handlePrint = async () => {
    if (!page) return;
    setPrintInfo("");
    setPrinting(true);
    try {
      const msg = await printBytes(page, options.format);
      setPrintInfo(msg);
    } catch (err: unknown) {
      setPrintInfo("");
      useScannerStore.setState({ error: mapError(err, "Erro ao imprimir.") });
    } finally {
      setPrinting(false);
    }
  };

  const sizeKB = page ? (page.length / 1024).toFixed(1) : "0";

  return (
    <div>
      <PageHeader title="Digitalizar" description="Digitalizar documentos físicos" actions={
        <button onClick={scan} disabled={scanning || !selectedDevice} className="docid-button-primary">
          <Scan className={`h-4 w-4 ${scanning ? "animate-pulse" : ""}`} /> {scanning ? "A digitalizar..." : hasPages ? "Adicionar página" : "Digitalizar"}
        </button>
      } />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      {printInfo && <div className="mb-4 rounded-lg border border-docid-secondary/30 bg-docid-secondary/10 p-3 text-sm text-docid-secondary">{printInfo}</div>}
      {!available && <div className="mb-4 rounded-lg border border-docid-tertiary/30 bg-docid-tertiary/10 p-3 text-sm text-docid-tertiary">Scanner apenas disponível no ambiente desktop (Tauri).</div>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="docid-panel p-5 space-y-5 lg:col-span-1">
          <h3 className="text-sm font-semibold text-docid-text">Dispositivo</h3>
          {devices.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Camera className="h-8 w-8 text-docid-outline" />
              <p className="text-sm text-docid-muted">Nenhum scanner encontrado.</p>
              <button onClick={loadDevices} className="docid-button-secondary text-xs"><RefreshCw className="h-3 w-3" /> Procurar scanners</button>
            </div>
          ) : (
            <select value={selectedDevice || ""} onChange={e => selectDevice(e.target.value)} className="docid-input w-full text-sm">
              {devices.map(d => <option key={d.name} value={d.name}>{d.vendor} {d.model}</option>)}
            </select>
          )}
          <h3 className="text-sm font-semibold text-docid-text">Opções</h3>
          <div className="space-y-3">
            <div><label className="mb-1 block text-xs text-docid-muted">Resolução (DPI)</label>
              <select value={options.resolution} onChange={e => setOptions({ resolution: Number(e.target.value) })} className="docid-input w-full text-sm">
                <option value="150">150 DPI</option><option value="300">300 DPI</option><option value="600">600 DPI</option>
              </select></div>
            <div><label className="mb-1 block text-xs text-docid-muted">Modo</label>
              <select value={options.mode} onChange={e => setOptions({ mode: e.target.value })} className="docid-input w-full text-sm">
                <option value="color">Cor</option><option value="gray">Cinzento</option><option value="bw">Preto e Branco</option>
              </select></div>
            <div><label className="mb-1 block text-xs text-docid-muted">Formato</label>
              <select value={options.format} onChange={e => setOptions({ format: e.target.value })} className="docid-input w-full text-sm">
                <option value="pdf">PDF</option><option value="png">PNG</option>
              </select></div>
            {printers.length > 0 && (
              <div><label className="mb-1 block text-xs text-docid-muted">Impressora</label>
                <select value={selectedPrinter || ""} onChange={e => selectPrinter(e.target.value)} className="docid-input w-full text-sm">
                  {printers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select></div>
            )}
          </div>
          <p className="text-xs text-docid-muted">Cada digitalização acrescenta uma página. Pode navegar, remover ou descarregar páginas individualmente.</p>
        </div>
        <div className="docid-panel p-5 lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold text-docid-text">Resultado</h3>
          {hasPages && page && previewUrl ? (
            <div className="space-y-4">
              {options.format === "png" ? (
                <img src={previewUrl} alt={`Página ${currentPage + 1}`} className="max-h-[500px] w-full rounded-lg border border-docid-border object-contain bg-docid-surface-low" />
              ) : (
                <div className="space-y-2">
                  <object data={previewUrl} type="application/pdf" className="h-[500px] w-full rounded-lg border border-docid-border bg-docid-surface-low">
                    <div className="flex h-full items-center justify-center p-8 text-sm text-docid-muted">A WebView não conseguiu mostrar o PDF. Use o download para visualizar.</div>
                  </object>
                  <p className="text-xs text-docid-muted">Se o preview estiver em branco (comum no WebKit/Linux), descarregue o ficheiro para o abrir no leitor do sistema.</p>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-docid-surface-low p-3 text-sm">
                <div className="flex items-center gap-2">
                  <button onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 0} className="docid-button-secondary text-xs py-1.5" aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="text-docid-muted">Página <span className="font-medium text-docid-text">{currentPage + 1}</span> de {pages.length}</span>
                  <button onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage >= pages.length - 1} className="docid-button-secondary text-xs py-1.5" aria-label="Página seguinte"><ChevronRight className="h-4 w-4" /></button>
                </div>
                <span className="text-docid-muted"><span className="font-medium text-docid-text">{sizeKB} KB</span> — {options.format.toUpperCase()}</span>
                <div className="flex flex-wrap gap-2">
                  <button onClick={scan} disabled={scanning || !selectedDevice} className="docid-button-secondary text-xs"><Plus className="h-3 w-3" /> Página</button>
                  <button onClick={() => downloadPage(currentPage)} className="docid-button-secondary text-xs"><Download className="h-3 w-3" /> Download</button>
                  {pages.length > 1 && <button onClick={handleDownloadAll} className="docid-button-secondary text-xs"><Download className="h-3 w-3" /> Todas</button>}
                  <button onClick={handlePrint} disabled={printing || !selectedPrinter} className="docid-button-secondary text-xs"><Printer className="h-3 w-3" /> {printing ? "A imprimir..." : "Imprimir"}</button>
                  <button onClick={removeCurrentPage} className="docid-button-secondary text-xs text-docid-error"><Trash2 className="h-3 w-3" /> Remover</button>
                  <button onClick={clearScan} className="docid-button-secondary text-xs text-docid-error">Limpar</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Camera className="h-12 w-12 text-docid-outline" />
              <p className="text-sm text-docid-muted">Seleccione um scanner e clique em "Digitalizar".</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
