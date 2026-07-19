import { useEffect, useState } from "react";
import { useScannerStore } from "../stores/scannerStore";
import { PageHeader, StatusChip, EmptyState } from "../components/docid-ui";
import { Scan, Camera, RefreshCw, Download, Trash2 } from "lucide-react";

export default function Scanner() {
  const { devices, selectedDevice, scanning, error, lastScan, options, loadDevices, selectDevice, setOptions, scan, clearScan } = useScannerStore();
  const [available, setAvailable] = useState(true);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  const hasLastScan = lastScan && lastScan.length > 0;
  const sizeKB = hasLastScan ? (lastScan!.length / 1024).toFixed(1) : "0";

  const handleDownload = () => {
    if (!hasLastScan) return;
    const blob = new Blob([lastScan!.buffer as ArrayBuffer], { type: options.format === "png" ? "image/png" : "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `digitalizacao_${Date.now()}.${options.format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader title="Digitalizar" description="Digitalizar documentos físicos" actions={
        <button onClick={scan} disabled={scanning || !selectedDevice} className="docid-button-primary">
          <Scan className={`h-4 w-4 ${scanning ? "animate-pulse" : ""}`} /> {scanning ? "A digitalizar..." : "Digitalizar"}
        </button>
      } />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
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
          </div>
        </div>
        <div className="docid-panel p-5 lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold text-docid-text">Resultado</h3>
          {hasLastScan ? (
            <div className="space-y-4">
              {options.format === "png" ? (
                <img src={URL.createObjectURL(new Blob([lastScan!.buffer as ArrayBuffer], { type: "image/png" }))} alt="Digitalização" className="max-h-[500px] w-full rounded-lg border border-docid-border object-contain bg-docid-surface-low" />
              ) : (
                <div className="flex items-center justify-center rounded-lg border border-docid-border bg-docid-surface-low p-12 text-sm text-docid-muted">Pré-visualização de PDF não disponível. Faça download para visualizar.</div>
              )}
              <div className="flex items-center justify-between rounded-lg bg-docid-surface-low p-3 text-sm">
                <span className="text-docid-muted"><span className="font-medium text-docid-text">{sizeKB} KB</span> — {options.format.toUpperCase()}</span>
                <div className="flex gap-2">
                  <button onClick={handleDownload} className="docid-button-secondary text-xs"><Download className="h-3 w-3" /> Download</button>
                  <button onClick={clearScan} className="docid-button-secondary text-xs text-docid-error"><Trash2 className="h-3 w-3" /> Limpar</button>
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
