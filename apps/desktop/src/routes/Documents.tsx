import { useEffect, useState, useRef } from "react";
import { api } from "../services/api";
import { syncService } from "../services/sync";
import { useAuthStore } from "../stores/auth";
import { useQueueStore } from "../stores/queue";
import { Upload, Download, FileText, CloudOff, Share2, History } from "lucide-react";
import ShareDocumentModal from "../components/ShareDocumentModal";

export default function Documents() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [identifiers, setIdentifiers] = useState<any[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [filterCat, setFilterCat] = useState("");
  const [categories, setCategories] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState({ identifier: "", file: null as File | null });
  const [offlineMode, setOfflineMode] = useState(false);
  const user = useAuthStore((s) => s.user);
  const refreshQueue = useQueueStore((s) => s.refresh);
  const [shareId, setShareId] = useState<string | null>(null);
  const [sharesId, setSharesId] = useState<string | null>(null);
  const [shares, setShares] = useState<any[]>([]);

  useEffect(() => {
    api.get<any>("/categories").then((res) => {
      const cats = Object.values(res.data.groups).flat() as any[];
      setCategories(cats);
    });
    api.get<any>("/identifiers").then((res) => setIdentifiers(res.data || []));
    loadDocs();
  }, []);

  const loadDocs = () => {
    api.get<any>("/identifiers").then((res) => {
      const docs = (res.data || []).filter((i: any) => i.document);
      setDocuments(docs);
    });
  };

  useEffect(() => {
    syncService.isOnline().then((online) => setOfflineMode(!online));
  }, []);

  const attach = async () => {
    if (!upload.file || !upload.identifier || !user) return;

    const online = await syncService.isOnline();
    if (!online || offlineMode) {
      if (!syncService.isAvailable()) {
        alert("Fila offline só disponível na app desktop.");
        return;
      }
      await syncService.enqueueFromFile(upload.file, upload.identifier, user.tenantId, user.id);
      await refreshQueue();
      loadDocs();
      setShowUpload(false);
      setUpload({ identifier: "", file: null });
      alert("Ficheiro adicionado à fila offline. Será enviado quando a conexão voltar.");
      return;
    }

    const form = new FormData();
    form.append("identifier", upload.identifier);
    form.append("file", upload.file);
    try {
      await api.post("/documents/attach", form);
      loadDocs();
      setShowUpload(false);
      setUpload({ identifier: "", file: null });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const loadShares = async (identifier: string) => {
    const res = await api.get<any>(`/documents/${identifier}/shares`);
    setShares(res.data || []);
    setSharesId(identifier);
  };

  const revokeShare = async (identifier: string, shareId: string) => {
    await api.delete(`/documents/${identifier}/shares/${shareId}`);
    loadShares(identifier);
  };

  const download = async (identifier: string) => {
    try {
      const res = await fetch(`http://localhost:3000/documents/${identifier}/download`, {
        headers: { Authorization: `Bearer ${(await import("../stores/auth")).useAuthStore.getState().token}` },
      });
      if (!res.ok) { alert("Erro ao descarregar"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${identifier}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Erro ao descarregar");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Documentos</h1>
        <button onClick={() => setShowUpload(!showUpload)} className="flex items-center gap-2 rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700 transition-colors">
          <Upload className="h-4 w-4" /> {showUpload ? "Fechar" : "Upload Documento"}
        </button>
      </div>

      {showUpload && (
        <div className="mb-6 rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold mb-4">Associar Documento</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <select value={upload.identifier} onChange={(e) => setUpload({ ...upload, identifier: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Seleccionar identificador</option>
              {identifiers.filter((i) => i.status === "active").map((i: any) => (
                <option key={i.id} value={i.identifier}>{i.identifier} — {i.issuedTo || i.categoryId}</option>
              ))}
            </select>
            <input ref={fileRef} type="file" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })} className="text-sm" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={offlineMode} onChange={(e) => setOfflineMode(e.target.checked)} />
            <CloudOff className="h-4 w-4" /> Guardar na fila offline (enviar depois)
          </label>
          <button onClick={attach} disabled={!upload.file || !upload.identifier} className="mt-4 rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700 disabled:opacity-50 transition-colors">
            {offlineMode ? "Adicionar à fila" : "Associar"}
          </button>
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Identificador</th>
              <th className="px-4 py-3">Ficheiro</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Tamanho</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Acções</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {documents.map((doc: any) => (
              <tr key={doc.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{doc.identifier}</td>
                <td className="px-4 py-3 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-400" />
                  {doc.document?.filename || "—"}
                </td>
                <td className="px-4 py-3">{doc.category?.name || doc.categoryId}</td>
                <td className="px-4 py-3">{doc.document?.fileSize ? `${(doc.document.fileSize / 1024).toFixed(1)} KB` : "—"}</td>
                <td className="px-4 py-3 text-xs">{doc.origin}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => download(doc.identifier)} className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1.5 text-xs font-medium hover:bg-gray-200 transition-colors">
                      <Download className="h-3 w-3" /> Download
                    </button>
                    <button onClick={() => setShareId(doc.identifier)} className="flex items-center gap-1 rounded-lg bg-verano-50 px-2 py-1.5 text-xs font-medium text-verano-700 hover:bg-verano-100 transition-colors">
                      <Share2 className="h-3 w-3" /> Partilhar
                    </button>
                    <button onClick={() => loadShares(doc.identifier)} className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1.5 text-xs font-medium hover:bg-gray-200 transition-colors">
                      <History className="h-3 w-3" /> Partilhas
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum documento encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {shareId && (
        <ShareDocumentModal
          identifier={shareId}
          onClose={() => setShareId(null)}
          onShared={() => {}}
        />
      )}

      {sharesId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSharesId(null)} />
          <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Histórico de partilhas — {sharesId}</h2>
            {shares.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhuma partilha registada.</p>
            ) : (
              <ul className="space-y-2">
                {shares.map((s) => (
                  <li key={s.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <span>
                      {s.sector ? `Sector: ${s.sector.name}` : s.user ? `Utilizador: ${s.user.fullName}` : "—"}
                    </span>
                    <button
                      onClick={() => revokeShare(sharesId, s.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Revogar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setSharesId(null)} className="mt-4 rounded-lg bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200">
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
