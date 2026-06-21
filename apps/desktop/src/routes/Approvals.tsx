import { useEffect, useState } from "react";
import { api } from "../services/api";
import { CheckCircle, XCircle, Clock } from "lucide-react";

export default function Approvals() {
  const [approvals, setApprovals] = useState<any[]>([]);
  const [filter, setFilter] = useState("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const load = () => {
    const qs = filter ? `?status=${filter}` : "";
    api.get<any>(`/approvals${qs}`).then((res) => setApprovals(res.data || []));
  };

  useEffect(() => { load(); }, [filter]);

  const resolve = async (id: string, status: "approved" | "rejected") => {
    setLoading(id);
    try {
      await api.patch(`/approvals/${id}`, { status, notes: notes[id] || undefined });
      load();
    } catch (err: any) {
      alert(err.message || "Erro ao processar aprovação");
    } finally {
      setLoading(null);
    }
  };

  const statusIcon = (status: string) => {
    if (status === "approved") return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (status === "rejected") return <XCircle className="h-4 w-4 text-red-500" />;
    return <Clock className="h-4 w-4 text-yellow-500" />;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Aprovações</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="pending">Pendentes</option>
          <option value="approved">Aprovadas</option>
          <option value="rejected">Rejeitadas</option>
          <option value="">Todas</option>
        </select>
      </div>

      <div className="space-y-4">
        {approvals.map((a) => (
          <div key={a.id} className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  {statusIcon(a.status)}
                  <span className="font-mono text-sm">{a.document?.identifier?.identifier || "—"}</span>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Sector destino: {a.sector?.name || "—"}
                </p>
                <p className="text-xs text-gray-400">
                  Pedido em {new Date(a.requestedAt).toLocaleString("pt-AO")}
                </p>
                {a.notes && <p className="mt-2 text-sm text-gray-600">Nota: {a.notes}</p>}
              </div>
            </div>

            {a.status === "pending" && (
              <div className="mt-4 border-t pt-4">
                <textarea
                  placeholder="Nota opcional..."
                  value={notes[a.id] || ""}
                  onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-3"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => resolve(a.id, "approved")}
                    disabled={loading === a.id}
                    className="flex items-center gap-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    <CheckCircle className="h-4 w-4" /> Aprovar
                  </button>
                  <button
                    onClick={() => resolve(a.id, "rejected")}
                    disabled={loading === a.id}
                    className="flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" /> Rejeitar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {approvals.length === 0 && (
          <div className="rounded-xl bg-white p-12 text-center text-gray-400 shadow-sm border border-gray-100">
            Nenhuma aprovação encontrada.
          </div>
        )}
      </div>
    </div>
  );
}
