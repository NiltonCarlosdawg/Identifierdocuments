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
        <h1 className="text-2xl font-bold text-docid-text">Aprovações</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="docid-input"
        >
          <option value="pending">Pendentes</option>
          <option value="approved">Aprovadas</option>
          <option value="rejected">Rejeitadas</option>
          <option value="">Todas</option>
        </select>
      </div>

      <div className="space-y-4">
        {approvals.map((a) => (
          <div key={a.id} className="docid-panel p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  {statusIcon(a.status)}
                  <span className="font-mono text-sm">{a.document?.identifier?.identifier || "—"}</span>
                </div>
                <p className="mt-1 text-sm text-docid-muted">
                  Sector destino: {a.sector?.name || "—"}
                </p>
                <p className="text-xs text-docid-outline">
                  Pedido em {new Date(a.requestedAt).toLocaleString("pt-AO")}
                </p>
                {a.notes && <p className="mt-2 text-sm text-docid-muted">Nota: {a.notes}</p>}
              </div>
            </div>

            {a.status === "pending" && (
              <div className="mt-4 border-t border-docid-border pt-4">
                <textarea
                  placeholder="Nota opcional..."
                  value={notes[a.id] || ""}
                  onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                  className="docid-input w-full mb-3"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => resolve(a.id, "approved")}
                    disabled={loading === a.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-docid-secondary px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                  >
                    <CheckCircle className="h-4 w-4" /> Aprovar
                  </button>
                  <button
                    onClick={() => resolve(a.id, "rejected")}
                    disabled={loading === a.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-docid-error px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" /> Rejeitar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {approvals.length === 0 && (
          <div className="docid-panel flex min-h-24 items-center justify-center p-12 text-center text-sm text-docid-muted">
            Nenhuma aprovação encontrada.
          </div>
        )}
      </div>
    </div>
  );
}
