import { useState, useEffect, useCallback } from "react";
import { api } from "../../infrastructure/di/container";
import { PageHeader, Modal, StatusChip, EmptyState, Pagination } from "../components/docid-ui";
import { Search, Plus, Users, Pencil, Trash2 } from "lucide-react";

interface SectorRow { id: string; name: string; code: string; supervisorName: string | null; supervisorId: string | null; memberCount: number; createdAt: string; }
interface User { id: string; fullName: string; }

export default function Sectors() {
  const [rows, setRows] = useState<SectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<SectorRow | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [showMembers, setShowMembers] = useState<SectorRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await api.get<{ data: SectorRow[] }>("/sectors");
      setRows(res.data || []);
    } catch (err: any) { setError(err.message || "Erro ao carregar sectores."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.code.toLowerCase().includes(search.toLowerCase()));

  const handleViewMembers = async (sector: SectorRow) => {
    try {
      const res = await api.get<{ data: User[] }>(`/sectors/${sector.id}/members`);
      setMembers(res.data || []);
      setShowMembers(sector);
    } catch {}
  };

  return (
    <div>
      <PageHeader title="Sectores" description="Gerir os sectores da organização" actions={<button onClick={() => setShowCreate(true)} className="docid-button-primary"><Plus className="h-4 w-4" /> Criar sector</button>} />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input value={search} onChange={e => setSearch(e.target.value)} className="docid-input w-full pl-9" placeholder="Pesquisar sector..." /></div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-docid-muted">A carregar...</div>
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhum sector encontrado.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(s => (
            <div key={s.id} className="docid-panel p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-docid-text">{s.name}</p>
                  <p className="text-xs text-docid-muted font-mono">{s.code}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setSelected(s); }} className="rounded p-1.5 text-docid-muted hover:text-docid-text"><Pencil className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-docid-muted">
                <span>Supervisor: {s.supervisorName || "—"}</span>
                <button onClick={() => handleViewMembers(s)} className="flex items-center gap-1 text-docid-primary-soft hover:underline"><Users className="h-3 w-3" /> {s.memberCount} membro(s)</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showCreate && <CreateSectorModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />}
      {selected && <EditSectorModal sector={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); load(); }} />}
      {showMembers && <MembersModal sector={showMembers} members={members} onClose={() => { setShowMembers(null); setMembers([]); }} />}
    </div>
  );
}

function CreateSectorModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!name.trim() || !code.trim()) return;
    setError(""); setLoading(true);
    try {
      await api.post("/sectors", { name: name.trim(), code: code.trim().toUpperCase() });
      onDone();
    } catch (err: any) { setError(err.message || "Erro ao criar sector."); } finally { setLoading(false); }
  };

  return (
    <Modal title="Criar Sector" onClose={onClose} footer={<><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleSubmit} disabled={loading || !name.trim() || !code.trim()} className="docid-button-primary">{loading ? "A criar..." : "Criar"}</button></>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nome do sector</label><input value={name} onChange={e => setName(e.target.value)} className="docid-input w-full" placeholder="Ex: Jurídico" autoFocus /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Código <span className="font-normal text-docid-outline">(único na organização)</span></label><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} className="docid-input w-full font-mono uppercase" placeholder="Ex: JUR" maxLength={10} /></div>
      </div>
    </Modal>
  );
}

function EditSectorModal({ sector, onClose, onDone }: { sector: SectorRow; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(sector.name);
  const [code, setCode] = useState(sector.code);
  const [supervisorId, setSupervisorId] = useState(sector.supervisorId || "");
  const [supervisorName, setSupervisorName] = useState(sector.supervisorName || "");
  const [members, setMembers] = useState<User[]>([]);
  const [memberLoading, setMemberLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ data: User[] }>(`/sectors/${sector.id}/members`);
        setMembers(res.data || []);
      } catch {} finally { setMemberLoading(false); }
    })();
  }, [sector.id]);

  const handleSave = async () => {
    if (!name.trim() || !code.trim()) return;
    setError(""); setLoading(true);
    try {
      await api.patch(`/sectors/${sector.id}`, { name: name.trim(), code: code.trim().toUpperCase() });
      if (supervisorId !== (sector.supervisorId || "")) {
        await api.patch(`/sectors/${sector.id}/supervisor`, { supervisorId: supervisorId || undefined });
      }
      onDone();
    } catch (err: any) { setError(err.message || "Erro ao actualizar sector."); } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Tem a certeza que deseja eliminar o sector "${sector.name}"?`)) return;
    setLoading(true);
    try { await api.delete(`/sectors/${sector.id}`); onDone(); } catch (err: any) { setError(err.message); setLoading(false); }
  };

  return (
    <Modal title={`Editar: ${sector.name}`} onClose={onClose} footer={<><button onClick={handleDelete} disabled={loading} className="docid-button-secondary text-docid-error"><Trash2 className="h-4 w-4" /> Eliminar</button><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleSave} disabled={loading} className="docid-button-primary">{loading ? "A guardar..." : "Guardar"}</button></>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nome do sector</label><input value={name} onChange={e => setName(e.target.value)} className="docid-input w-full" /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Código</label><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} className="docid-input w-full font-mono uppercase" maxLength={10} /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Supervisor</label>
          {memberLoading ? (
            <div className="text-sm text-docid-muted">A carregar membros...</div>
          ) : (
            <select value={supervisorId} onChange={e => {
              const val = e.target.value;
              setSupervisorId(val);
              setSupervisorName(val ? members.find(m => m.id === val)?.fullName || "" : "");
            }} className="docid-input w-full">
              <option value="">Nenhum</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.fullName}</option>)}
            </select>
          )}
          {supervisorName && <p className="mt-1 text-xs text-docid-muted">Supervisor actual: {supervisorName}</p>}
        </div>
      </div>
    </Modal>
  );
}

function MembersModal({ sector, members, onClose }: { sector: SectorRow; members: User[]; onClose: () => void }) {
  return (
    <Modal title={`Membros: ${sector.name}`} onClose={onClose}>
      {members.length === 0 ? (
        <EmptyState>Nenhum membro neste sector.</EmptyState>
      ) : (
        <ul className="divide-y divide-docid-border">{members.map(m => <li key={m.id} className="py-2 text-sm">{m.fullName}</li>)}</ul>
      )}
    </Modal>
  );
}
