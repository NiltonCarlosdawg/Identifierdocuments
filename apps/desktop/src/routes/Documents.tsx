import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";
import { syncService } from "../services/sync";
import { useAuthStore } from "../stores/auth";
import { useAppConfigStore } from "../stores/config";
import { useQueueStore } from "../stores/queue";
import { Download, FileText, History, Search, Share2, Upload, UploadCloud } from "lucide-react";
import ShareDocumentModal from "../components/ShareDocumentModal";
import { EmptyState, Modal, PageHeader, Pagination, StatusChip } from "../components/docid-ui";

export default function Documents() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [identifiers, setIdentifiers] = useState<any[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState({ identifier: "", file: null as File | null });
  const [offlineMode, setOfflineMode] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const user = useAuthStore((s) => s.user);
  const refreshQueue = useQueueStore((s) => s.refresh);
  const [shareId, setShareId] = useState<string | null>(null);
  const [sharesId, setSharesId] = useState<string | null>(null);
  const [shares, setShares] = useState<any[]>([]);

  const loadDocs = () => {
    api.get<any>("/identifiers").then((res) => {
      const docs = (res.data || []).filter((i: any) => i.document);
      setDocuments(docs);
      setIdentifiers(res.data || []);
    }).catch(() => {});
  };

  useEffect(() => {
    api.get<any>("/categories").then((res) => {
      const cats = Object.values(res.data.groups).flat() as any[];
      setCategories(cats);
    }).catch(() => {});
    loadDocs();
    syncService.isOnline().then((online) => setOfflineMode(!online));
  }, []);

  const filteredDocs = useMemo(() => documents.filter((doc) => {
    const text = `${doc.identifier} ${doc.document?.filename} ${doc.category?.name || doc.categoryId}`.toLowerCase();
    return (!categoryFilter || doc.categoryId === categoryFilter)
      && (!statusFilter || doc.document?.status === statusFilter || doc.status === statusFilter)
      && (!query || text.includes(query.toLowerCase()));
  }), [documents, categoryFilter, statusFilter, query]);

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

    setUploadError("");
    const form = new FormData();
    form.append("identifier", upload.identifier);
    form.append("file", upload.file);
    try {
      await api.post("/documents/attach", form);
      loadDocs();
      setShowUpload(false);
      setUpload({ identifier: "", file: null });
    } catch (err: any) {
      setUploadError(err.message);
    }
  };

  const loadShares = async (identifier: string) => {
    try {
      const res = await api.get<any>(`/documents/${identifier}/shares`);
      setShares(res.data || []);
    } catch {
      setShares([]);
    }
    setSharesId(identifier);
  };

  const revokeShare = async (identifier: string, shareId: string) => {
    await api.patch(`/documents/${identifier}/shares/${shareId}/revoke`, {});
    loadShares(identifier);
  };

  const download = async (identifier: string, filename?: string) => {
    const apiBaseUrl = useAppConfigStore.getState().apiBaseUrl || "http://localhost:3000";
    try {
      const res = await fetch(`${apiBaseUrl}/documents/${identifier}/download`, {
        headers: { Authorization: `Bearer ${(await import("../stores/auth")).useAuthStore.getState().token}` },
      });
      if (!res.ok) { alert("Erro ao descarregar"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || identifier;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Erro ao descarregar");
    }
  };

  return (
    <div>
      <PageHeader
        title="Documentos"
        description="Gerencie e visualize o repositório centralizado de arquivos corporativos."
        actions={<button onClick={() => { setShowUpload(true); setUploadError(""); }} className="docid-button-primary"><Upload className="h-4 w-4" /> Fazer Upload</button>}
      />

      <section className="docid-panel mb-6 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="docid-input">
            <option value="">Todas as Categorias</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="docid-input">
            <option value="">Qualquer Status</option>
            <option value="active">Online</option>
            <option value="attached">Sincronizando</option>
            <option value="offline">Offline</option>
          </select>
          <select className="docid-input">
            <option>Todos os Sectores</option>
            <option>Operações</option>
            <option>Financeiro</option>
            <option>RH</option>
          </select>
          <select className="docid-input">
            <option>Últimos 30 dias</option>
            <option>Último trimestre</option>
            <option>Ano corrente</option>
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="docid-input w-full pl-10" placeholder="Nome ou ID..." />
          </div>
        </div>
      </section>

      <section className="docid-panel overflow-hidden">
        <table className="docid-table">
          <thead>
            <tr>
              <th>Identificador</th>
              <th>Nome do ficheiro</th>
              <th>Categoria</th>
              <th>Sector</th>
              <th>Origem</th>
              <th>Status Upload</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredDocs.map((doc: any) => (
              <tr key={doc.id}>
                <td className="font-mono text-docid-primary-soft">{doc.identifier}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-docid-muted" />
                    <span>{doc.document?.filename || "—"}</span>
                  </div>
                </td>
                <td>{doc.category?.name || doc.categoryId}</td>
                <td>{doc.sector?.name || "—"}</td>
                <td><StatusChip tone={doc.origin === "digital" ? "info" : "warning"}>{doc.origin || "digital"}</StatusChip></td>
                <td><StatusChip tone={doc.status === "cancelled" ? "error" : "success"}>{doc.document ? "Online" : "Offline"}</StatusChip></td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => download(doc.identifier, doc.document?.filename)} className="text-docid-muted hover:text-docid-primary-soft"><Download className="h-4 w-4" /></button>
                    <button onClick={() => setShareId(doc.identifier)} className="text-docid-muted hover:text-docid-primary-soft"><Share2 className="h-4 w-4" /></button>
                    <button onClick={() => loadShares(doc.identifier)} className="text-docid-muted hover:text-docid-primary-soft"><History className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredDocs.length === 0 && <EmptyState>Nenhum documento encontrado.</EmptyState>}
        <Pagination totalLabel={`${filteredDocs.length} documento${filteredDocs.length !== 1 ? "s" : ""}`} />
      </section>

      {showUpload && (
        <Modal
          title="Upload de Documento"
          onClose={() => setShowUpload(false)}
          footer={(
            <>
              <button className="docid-button-secondary" onClick={() => setShowUpload(false)}>Cancelar</button>
              <button onClick={attach} disabled={!upload.file || !upload.identifier} className="docid-button-primary">
                {offlineMode ? "Adicionar à fila" : "Adicionar"}
              </button>
            </>
          )}
        >
          <p className="mb-5 text-sm text-docid-muted">Siga os passos para registar o novo ficheiro no sistema.</p>
          {uploadError && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{uploadError}</div>}
          <div className="grid gap-5">
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Selecionar Identificador</span>
              <select value={upload.identifier} onChange={(e) => setUpload({ ...upload, identifier: e.target.value })} className="docid-input w-full">
                <option value="">Pesquisar por ID, Proprietário ou Setor...</option>
                {identifiers.filter((i) => i.status === "active").map((i: any) => (
                  <option key={i.id} value={i.identifier}>{i.identifier} — {i.issuedTo || i.categoryId}</option>
                ))}
              </select>
            </label>

            <button type="button" onClick={() => fileRef.current?.click()} className="rounded-xl border border-dashed border-docid-border bg-docid-surface-lowest p-8 text-center transition hover:border-docid-primary">
              <UploadCloud className="mx-auto h-9 w-9 text-docid-primary-soft" />
              <p className="mt-3 font-semibold">{upload.file?.name || "Upload do Ficheiro"}</p>
              <p className="mt-1 text-sm text-docid-muted">ou procure no computador</p>
            </button>
            <input ref={fileRef} type="file" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })} className="hidden" />

            <label className="flex items-center gap-2 text-sm text-docid-muted">
              <input type="checkbox" checked={offlineMode} onChange={(e) => setOfflineMode(e.target.checked)} className="rounded border-docid-border bg-docid-surface-low text-docid-primary focus:ring-docid-primary" />
              Guardar na fila offline
            </label>

            {upload.identifier && (
              <div className="rounded-lg border border-docid-primary/30 bg-docid-primary/10 p-3 text-sm text-docid-muted">
                O ficheiro deve conter o texto do identificador: <span className="font-mono text-docid-primary-soft">{upload.identifier}</span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {shareId && <ShareDocumentModal identifier={shareId} onClose={() => setShareId(null)} onShared={() => {}} />}

      {sharesId && (
        <Modal title={`Histórico de partilhas — ${sharesId}`} onClose={() => setSharesId(null)} maxWidth="max-w-lg">
          {shares.length === 0 ? (
            <p className="text-sm text-docid-muted">Nenhuma partilha registada.</p>
          ) : (
            <ul className="space-y-2">
              {shares.map((s) => {
                const revoked = !!s.revokedAt;
                return (
                  <li key={s.id} className={`flex items-center justify-between rounded-lg border border-docid-border px-3 py-2 text-sm ${revoked ? "opacity-60" : ""}`}>
                    <span>{s.sector ? `Sector: ${s.sector.name}` : s.user ? `Utilizador: ${s.user.fullName}` : "—"}</span>
                    {revoked ? <StatusChip>Revogada</StatusChip> : <button onClick={() => revokeShare(sharesId, s.id)} className="text-docid-error hover:underline">Revogar</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}
