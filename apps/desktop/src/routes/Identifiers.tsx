import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { useAppConfigStore } from "../stores/config";
import { Check, Copy, Download, Eye, Fingerprint, Plus, Search, X } from "lucide-react";
import { EmptyState, Modal, PageHeader, Pagination, StatusChip } from "../components/docid-ui";

function statusTone(status: string) {
  if (status === "active") return "success" as const;
  if (status === "attached") return "info" as const;
  if (status === "cancelled" || status === "revoked") return "error" as const;
  if (status === "pending") return "warning" as const;
  return "neutral" as const;
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    active: "Activo",
    attached: "Anexado",
    cancelled: "Cancelado",
    revoked: "Revogado",
    pending: "Pendente",
  };
  return map[status] ?? status;
}

function originLabel(origin: string) {
  return origin === "digital" ? "Digital" : "Físico";
}

export default function Identifiers() {
  const [identifiers, setIdentifiers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [copied, setCopied] = useState("");
  const [form, setForm] = useState({ categoryId: "", issuedTo: "", description: "", origin: "digital" });
  const [filterCat, setFilterCat] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOrigin, setFilterOrigin] = useState("");
  const [query, setQuery] = useState("");
  const [successId, setSuccessId] = useState("");

  const loadIdentifiers = () => {
    const path = filterCat ? `/identifiers?categoryId=${filterCat}` : "/identifiers";
    api.get<any>(path).then((res) => setIdentifiers(res.data || [])).catch(() => {});
  };

  useEffect(() => {
    api.get<any>("/categories").then((res) => {
      const cats = Object.values(res.data.groups).flat() as any[];
      setCategories(cats);
    }).catch(() => {});
  }, []);

  useEffect(() => { loadIdentifiers(); }, [filterCat]);

  const filtered = useMemo(() => identifiers.filter((id) => {
    const q = query.toLowerCase();
    return (!filterStatus || id.status === filterStatus)
      && (!filterOrigin || id.origin === filterOrigin)
      && (!q || `${id.identifier} ${id.issuedTo} ${id.category?.name || id.categoryId}`.toLowerCase().includes(q));
  }), [identifiers, filterStatus, filterOrigin, query]);

  const generate = async () => {
    try {
      const res: any = await api.post("/identifiers/generate", form);
      setIdentifiers((prev) => [res.data, ...prev]);
      setSuccessId(res.data.identifier);
      setForm({ categoryId: "", issuedTo: "", description: "", origin: "digital" });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const cancelId = async (id: string) => {
    const reason = prompt("Motivo do cancelamento:");
    if (!reason) return;
    try {
      await api.patch(`/identifiers/${id}/cancel`, { reason });
      loadIdentifiers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const openDetail = async (identifier: string) => {
    setDetailId(identifier);
    setLoadingDetail(true);
    setDetailData(null);
    try {
      const res: any = await api.get(`/identifiers/${identifier}`);
      setDetailData(res.data);
    } catch {
      alert("Erro ao carregar detalhes.");
    } finally {
      setLoadingDetail(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(""), 1800);
  };

  const previewPrefix = categories.find((c: any) => c.id === form.categoryId)?.id || "PROP";
  const preview = `VL-${previewPrefix}-${new Date().getFullYear()}-XXXX-001`;

  return (
    <div>
      <PageHeader
        title="Identificadores"
        description="Gerencie e emita identificadores únicos para activos e utilizadores corporativos."
        actions={<button onClick={() => { setShowForm(true); setSuccessId(""); }} className="docid-button-primary"><Plus className="h-4 w-4" /> Gerar Identificador</button>}
      />

      <section className="docid-panel mb-6 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="docid-input">
            <option value="">Todas as categorias</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="docid-input">
            <option value="">Todos os status</option>
            <option value="active">Activo</option>
            <option value="attached">Anexado</option>
            <option value="cancelled">Cancelado</option>
            <option value="pending">Pendente</option>
          </select>
          <select value={filterOrigin} onChange={(e) => setFilterOrigin(e.target.value)} className="docid-input">
            <option value="">Todas as origens</option>
            <option value="digital">Digital</option>
            <option value="physical">Físico</option>
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar por ID ou nome..." className="docid-input w-full pl-10" />
          </div>
        </div>
      </section>

      <section className="docid-panel overflow-hidden">
        <table className="docid-table">
          <thead>
            <tr>
              <th>Identificador</th>
              <th>Categoria</th>
              <th>Emitido Para</th>
              <th>Origem</th>
              <th>Status</th>
              <th>Data</th>
              <th>Acções</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((id: any) => (
              <tr key={id.id}>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-docid-primary-soft">{id.identifier}</span>
                    <button onClick={() => copyToClipboard(id.identifier)} className="text-docid-muted hover:text-docid-text">
                      {copied === id.identifier ? <Check className="h-4 w-4 text-docid-secondary" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </td>
                <td>{id.category?.name || id.categoryId}</td>
                <td>
                  <p>{id.issuedTo || "—"}</p>
                  {id.description && <p className="text-xs text-docid-muted">{id.description}</p>}
                </td>
                <td><StatusChip tone={id.origin === "digital" ? "info" : "warning"}>{originLabel(id.origin)}</StatusChip></td>
                <td><StatusChip tone={statusTone(id.status)}>{statusLabel(id.status)}</StatusChip></td>
                <td className="text-docid-muted">{id.createdAt ? new Date(id.createdAt).toLocaleDateString("pt-AO") : "—"}</td>
                <td>
                  <div className="flex gap-2">
                    <button onClick={() => openDetail(id.identifier)} className="flex items-center gap-1 text-sm font-medium text-docid-primary-soft hover:underline">
                      <Eye className="h-4 w-4" /> Ver
                    </button>
                    {id.status !== "cancelled" && (
                      <button onClick={() => cancelId(id.identifier)} className="text-sm font-medium text-docid-error hover:underline">Cancelar</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <EmptyState>Nenhum identificador encontrado.</EmptyState>}
        <Pagination totalLabel={`${filtered.length} identificador${filtered.length !== 1 ? "es" : ""}`} />
      </section>

      {/* Modal: Detalhes do Identificador */}
      {detailId && (
        <Modal
          title="Detalhes do Identificador"
          onClose={() => { setDetailId(null); setDetailData(null); }}
          maxWidth="max-w-lg"
        >
          {loadingDetail ? (
            <div className="flex items-center justify-center py-12 text-docid-muted">A carregar...</div>
          ) : detailData ? (
            <div className="space-y-5">
              <div className="docid-panel-low flex items-center justify-between p-4">
                <span className="font-mono text-2xl font-semibold text-docid-primary-soft">{detailData.identifier}</span>
                <button onClick={() => copyToClipboard(detailData.identifier)} className="docid-button-secondary">
                  {copied === detailData.identifier ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copiar
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {[
                  ["Categoria", detailData.category?.name || detailData.categoryId],
                  ["Status", statusLabel(detailData.status)],
                  ["Origem", originLabel(detailData.origin)],
                  ["Sector", detailData.sector?.name || "—"],
                  ["Emitido para", detailData.issuedTo || "—"],
                  ["Criado em", detailData.createdAt ? new Date(detailData.createdAt).toLocaleString("pt-AO") : "—"],
                  ["Criado por", detailData.createdByUser?.fullName || "—"],
                  ["Visibilidade", detailData.visibility === "public" ? "Público" : "Sector"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs uppercase tracking-wider text-docid-muted">{label}</p>
                    <p className="mt-1 font-medium">{value}</p>
                  </div>
                ))}
              </div>

              {detailData.description && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-docid-muted">Descrição</p>
                  <p className="mt-1 text-sm">{detailData.description}</p>
                </div>
              )}

              {detailData.document ? (
                <div className="docid-panel-low p-4">
                  <p className="text-xs uppercase tracking-wider text-docid-muted">Documento Anexado</p>
                  <div className="mt-2 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{detailData.document.filename}</p>
                      <p className="text-xs text-docid-muted">{(detailData.document.fileSize / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                      onClick={() => {
                        const baseUrl = useAppConfigStore.getState().apiBaseUrl || "http://localhost:3000";
                        window.open(`${baseUrl}/documents/${detailData.identifier}/download`, "_blank");
                      }}
                      className="docid-button-secondary"
                    >
                      <Download className="h-4 w-4" /> Descarregar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="docid-panel-low flex items-center justify-center p-4 text-sm text-docid-muted">
                  Nenhum documento anexado
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-docid-muted">Erro ao carregar dados.</div>
          )}
        </Modal>
      )}

      {/* Modal: Gerar Identificador */}
      {showForm && (
        <Modal
          title={successId ? "Identificador Gerado" : "Gerar Novo Identificador"}
          onClose={() => setShowForm(false)}
          maxWidth={successId ? "max-w-md" : "max-w-2xl"}
          footer={successId ? (
            <>
              <button className="docid-button-secondary" onClick={() => setShowForm(false)}>Fechar</button>
              <button className="docid-button-primary" onClick={() => { setSuccessId(""); }}>Gerar Outro</button>
            </>
          ) : (
            <>
              <button className="docid-button-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="docid-button-primary" onClick={generate} disabled={!form.categoryId}>Gerar</button>
            </>
          )}
        >
          {successId ? (
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-docid-secondary/15 text-docid-secondary">
                <Check className="h-10 w-10" />
              </div>
              <p className="text-docid-muted">Identificador gerado e registado com sucesso.</p>
              <div className="docid-panel-low mt-6 flex items-center justify-between p-4">
                <span className="font-mono text-xl font-semibold text-docid-primary-soft">{successId}</span>
                <button onClick={() => copyToClipboard(successId)} className="docid-button-secondary">
                  {copied === successId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copiar
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="docid-input w-full">
                  <option value="">Categoria</option>
                  {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                </select>
                <input placeholder="Emitido para" value={form.issuedTo} onChange={(e) => setForm({ ...form, issuedTo: e.target.value })} className="docid-input w-full" />
                <div className="grid grid-cols-2 gap-3">
                  {(["digital", "physical"] as const).map((origin) => (
                    <label key={origin} className="flex cursor-pointer items-center gap-2 rounded-lg border border-docid-border bg-docid-surface-lowest p-3 text-sm">
                      <input type="radio" checked={form.origin === origin} onChange={() => setForm({ ...form, origin })} className="text-docid-primary focus:ring-docid-primary" />
                      {origin === "digital" ? "Digital" : "Físico"}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                <textarea placeholder="Breve descrição do documento..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} className="docid-input w-full resize-none" />
                <div className="docid-panel-low p-5 text-center">
                  <p className="text-xs uppercase tracking-wider text-docid-muted">Pré-visualização</p>
                  <p className="mt-5 break-all font-mono text-xl font-semibold text-docid-primary-soft">{preview}</p>
                  <button onClick={() => copyToClipboard(preview)} className="docid-button-secondary mt-3"><Copy className="h-4 w-4" /> Copiar</button>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
