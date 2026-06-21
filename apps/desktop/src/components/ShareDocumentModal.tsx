import { useEffect, useState } from "react";
import { api } from "../services/api";
import { X, Share2 } from "lucide-react";

interface Props {
  identifier: string;
  onClose: () => void;
  onShared: () => void;
}

export default function ShareDocumentModal({ identifier, onClose, onShared }: Props) {
  const [sectors, setSectors] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [mode, setMode] = useState<"sector" | "user">("sector");
  const [sectorId, setSectorId] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<any>("/sectors").then((res) => setSectors(res.data || []));
    api.get<any>("/users").then((res) => setUsers(res.data || []));
  }, []);

  const handleShare = async () => {
    setError("");
    setLoading(true);
    try {
      await api.post(`/documents/${identifier}/share`, {
        sectorId: mode === "sector" ? sectorId : undefined,
        userId: mode === "user" ? userId : undefined,
      });
      onShared();
      onClose();
    } catch (err: any) {
      setError(err.message || "Erro ao partilhar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Share2 className="h-5 w-5" /> Partilhar documento
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        <p className="mb-4 font-mono text-xs text-gray-500">{identifier}</p>

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setMode("sector")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "sector" ? "bg-verano-600 text-white" : "bg-gray-100"}`}
          >
            Sector
          </button>
          <button
            onClick={() => setMode("user")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "user" ? "bg-verano-600 text-white" : "bg-gray-100"}`}
          >
            Utilizador
          </button>
        </div>

        {mode === "sector" ? (
          <select
            value={sectorId}
            onChange={(e) => setSectorId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Seleccionar sector</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        ) : (
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Seleccionar utilizador</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName} — {u.email}</option>
            ))}
          </select>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm hover:bg-gray-100">Cancelar</button>
          <button
            onClick={handleShare}
            disabled={loading || (mode === "sector" ? !sectorId : !userId)}
            className="rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700 disabled:opacity-50"
          >
            {loading ? "A partilhar..." : "Partilhar"}
          </button>
        </div>
      </div>
    </div>
  );
}
