import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Plus, Search, Copy, Check, X } from "lucide-react";

export default function Identifiers() {
  const [identifiers, setIdentifiers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [copied, setCopied] = useState("");
  const [form, setForm] = useState({ categoryId: "", issuedTo: "", description: "", origin: "digital" });
  const [filterCat, setFilterCat] = useState("");

  useEffect(() => {
    api.get<any>("/categories").then((res) => {
      const cats = Object.values(res.data.groups).flat() as any[];
      setCategories(cats);
    });
    loadIdentifiers();
  }, []);

  const loadIdentifiers = () => {
    const path = filterCat ? `/identifiers?categoryId=${filterCat}` : "/identifiers";
    api.get<any>(path).then((res) => {
      setIdentifiers(res.data || []);
    });
  };

  useEffect(() => { loadIdentifiers(); }, [filterCat]);

  const generate = async () => {
    try {
      const res: any = await api.post("/identifiers/generate", form);
      setIdentifiers((prev) => [res.data, ...prev]);
      setShowForm(false);
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(""), 2000);
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "active": return "bg-green-100 text-green-700";
      case "attached": return "bg-blue-100 text-blue-700";
      case "cancelled": return "bg-red-100 text-red-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Identificadores</h1>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700 transition-colors">
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? "Fechar" : "Novo Identificador"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold mb-4">Gerar Identificador</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Categoria</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
            </select>
            <input placeholder="Emitido para" value={form.issuedTo} onChange={(e) => setForm({ ...form, issuedTo: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input placeholder="Descrição" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <select value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="digital">Digital</option>
              <option value="physical">Físico</option>
            </select>
          </div>
          <button onClick={generate} className="mt-4 rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700 transition-colors">
            Gerar
          </button>
        </div>
      )}

      <div className="mb-4 flex items-center gap-3">
        <Search className="h-4 w-4 text-gray-400" />
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
          <option value="">Todas categorias</option>
          {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Identificador</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Emitido Para</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Acções</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {identifiers.map((id: any) => (
              <tr key={id.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{id.identifier}</td>
                <td className="px-4 py-3">{id.category?.name || id.categoryId}</td>
                <td className="px-4 py-3">{id.issuedTo || "—"}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(id.status)}`}>{id.status}</span></td>
                <td className="px-4 py-3 text-xs">{id.origin}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => copyToClipboard(id.identifier)} className="rounded p-1 hover:bg-gray-100">
                      {copied === id.identifier ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-400" />}
                    </button>
                    {id.status !== "cancelled" && (
                      <button onClick={() => cancelId(id.identifier)} className="rounded p-1 hover:bg-red-50">
                        <X className="h-4 w-4 text-red-400" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {identifiers.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum identificador encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
