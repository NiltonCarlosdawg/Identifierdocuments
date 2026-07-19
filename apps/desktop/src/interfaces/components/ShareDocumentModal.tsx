import { useEffect, useState } from "react";
import { api } from "../../infrastructure/di/container";
import { Modal } from "./docid-ui";

interface Props { identifier: string; onClose: () => void; onShared: () => void; }

export default function ShareDocumentModal({ identifier, onClose, onShared }: Props) {
  const [sectors, setSectors] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [mode, setMode] = useState<"sector" | "user">("sector");
  const [sectorId, setSectorId] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { api.get<any>("/sectors").then(r => setSectors(r.data || [])); api.get<any>("/users").then(r => setUsers(r.data || [])); }, []);

  const handleShare = async () => {
    setError(""); setLoading(true);
    try { await api.post(`/documents/${identifier}/share`, { sectorId: mode === "sector" ? sectorId : undefined, userId: mode === "user" ? userId : undefined }); onShared(); onClose(); }
    catch (err: any) { setError(err.message || "Erro ao partilhar"); } finally { setLoading(false); }
  };

  return (
    <Modal title="Partilhar documento" onClose={onClose} footer={<><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleShare} disabled={loading || (mode === "sector" ? !sectorId : !userId)} className="docid-button-primary">{loading ? "A partilhar..." : "Partilhar"}</button></>}>
      <div className="space-y-4">
        <p className="font-mono text-xs text-docid-muted">{identifier}</p>
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        <div className="flex gap-2">
          <button onClick={() => setMode("sector")} className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${mode === "sector" ? "bg-docid-primary text-white" : "border border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>Sector</button>
          <button onClick={() => setMode("user")} className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${mode === "user" ? "bg-docid-primary text-white" : "border border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>Utilizador</button>
        </div>
        {mode === "sector" ? (
          <select value={sectorId} onChange={e => setSectorId(e.target.value)} className="docid-input w-full"><option value="">Seleccionar sector</option>{sectors.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select>
        ) : (
          <select value={userId} onChange={e => setUserId(e.target.value)} className="docid-input w-full"><option value="">Seleccionar utilizador</option>{users.map((u: any) => <option key={u.id} value={u.id}>{u.fullName} — {u.email}</option>)}</select>
        )}
      </div>
    </Modal>
  );
}
