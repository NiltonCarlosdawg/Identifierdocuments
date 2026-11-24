import { useState, useEffect } from "react";
import { api } from "../../infrastructure/di/container";
import { PageHeader, Modal, EmptyState, OfflineNotice } from "../components/docid-ui";
import { useOfflineCache } from "../hooks/useOfflineCache";
import { useCachedAux } from "../hooks/useCachedAux";
import { mapError } from "../../shared/errors/mapError";
import { Search, Plus, Users, Pencil, Trash2 } from "lucide-react";

interface SectorRow { id: string; name: string; code: string; supervisorName: string | null; supervisorId: string | null; memberCount: number; createdAt: string; }
interface User { id: string; fullName: string; }
// O detalhe inclui o supervisor completo; apenas estes campos podem ser usados na UI.
interface SectorDetail { name: string; code: string; supervisorId: string | null; supervisor: { id: string; fullName: string } | null; }

function SkeletonSector() {
  return (
    <div className="docid-panel p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div><div className="animate-pulse rounded bg-docid-surface-high h-4 w-1/3" /><div className="animate-pulse rounded bg-docid-surface-high h-3 w-1/4 mt-1" /></div>
        <div className="animate-pulse rounded bg-docid-surface-high h-4 w-20" />
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        {[1, 2, 3].map(index => (
          <div key={index}><div className="animate-pulse rounded bg-docid-surface-high h-3 w-1/3" /></div>
        ))}
      </div>
    </div>
  );
}

export default function Sectors() {
  const [rows, setRows] = useState<SectorRow[]>([]);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<SectorRow | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [showMembers, setShowMembers] = useState<SectorRow | null>(null);

  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<SectorRow[]>({
    endpoint: "/sectors",
    fetcher: async () => {
      const res = await api.get<{ data: SectorRow[] }>("/sectors");
      return res.data || [];
    },
    onData: setRows,
  });

  const filtered = rows.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.code.toLowerCase().includes(search.toLowerCase()));

  const fetchAux = useCachedAux();

  const handleViewMembers = async (sector: SectorRow) => {
    const members = await fetchAux<User[]>(`/sectors/${sector.id}/members`, sector.id);
    if (members) {
      setMembers(members);
      setShowMembers(sector);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Sectores" description="Gerir os sectores da organização" actions={<button onClick={() => setShowCreate(true)} className="docid-button-primary"><Plus className="h-4 w-4" /> Criar sector</button>} />
      {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 px-4 py-3 text-sm text-docid-error">{error}</div>}
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input value={search} onChange={e => setSearch(e.target.value)} className="docid-input w-full pl-9" placeholder="Pesquisar sector..." /></div>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 gap-3 p-6">
          {[...Array(3)].map((_, index) => <SkeletonSector key={index} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState>Nenhum sector encontrado.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(s => (
            <div key={s.id} className="docid-panel p-5 space-y-4 hover:border-docid-primary/40 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-docid-text">{s.name}</p>
                    <span className="inline-flex items-center rounded-full border border-docid-border px-2 py-0.5 text-[10px] font-medium text-docid-muted">{s.code}</span>
                  </div>
                  <p className="text-xs text-docid-muted mt-1">{new Date(s.createdAt).toLocaleDateString("pt-AO")}</p>
                </div>
                <button onClick={() => { setSelected(s); }} className="rounded-lg p-2 text-docid-muted hover:bg-docid-surface-high hover:text-docid-text transition-colors"><Pencil className="h-4 w-4" /></button>
              </div>
              <div className="pt-2">
                <div className="flex items-center gap-3 text-xs text-docid-muted mb-3">
                  <div className="flex items-center gap-1.5"><Users className="h-3 w-3" /><span>{s.memberCount} membro(s)</span></div>
                  <span className="ml-auto text-xs font-medium">{s.supervisorName || "Sem supervisor"}</span>
                </div>
                <button onClick={() => handleViewMembers(s)} className="flex items-center gap-1.5 rounded-lg border border-docid-border bg-docid-surface-low px-3 py-2 text-sm font-medium text-docid-primary-soft transition hover:bg-docid-surface-high">
                  <Users className="h-4 w-4" /> Ver membros
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showCreate && <CreateSectorModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); refresh(); }} />}
      {selected && <EditSectorModal sector={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); refresh(); }} />}
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
    } catch (err: any) { setError(mapError(err, "Erro ao criar sector.")); } finally { setLoading(false); }
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
  const fetchAux = useCachedAux();

  useEffect(() => {
    let cancelled = false;
    api.get<{ data: SectorDetail }>(`/sectors/${sector.id}`)
      .then(res => {
        if (cancelled || !res.data) return;
        setName(res.data.name);
        setCode(res.data.code);
        const id = res.data.supervisor?.id || res.data.supervisorId || "";
        setSupervisorId(id);
        setSupervisorName(res.data.supervisor?.fullName || "");
      })
      .catch((err: unknown) => { if (!cancelled) setError(mapError(err, "Erro ao carregar sector.")); });
    return () => { cancelled = true; };
  }, [sector.id]);

  useEffect(() => {
    (async () => {
      const members = await fetchAux<User[]>(`/sectors/${sector.id}/members`, sector.id);
      if (members) setMembers(members);
      setMemberLoading(false);
    })();
  }, [fetchAux, sector.id]);

  const handleSave = async () => {
    if (!name.trim() || !code.trim()) return;
    setError(""); setLoading(true);
    try {
      await api.patch(`/sectors/${sector.id}`, { name: name.trim(), code: code.trim().toUpperCase() });
      if (supervisorId !== (sector.supervisorId || "")) {
        await api.patch(`/sectors/${sector.id}/supervisor`, { supervisorId: supervisorId || undefined });
      }
      onDone();
    } catch (err: any) { setError(mapError(err, "Erro ao actualizar sector.")); } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Tem a certeza que deseja eliminar o sector "${sector.name}"?`)) return;
    setLoading(true);
    try { await api.delete(`/sectors/${sector.id}`); onDone(); } catch (err: any) { setError(mapError(err, "Erro ao eliminar sector.")); setLoading(false); }
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
    <Modal title={`Membros: ${sector.name}`} onClose={onClose} maxWidth="max-w-md">
      {members.length === 0 ? (
        <EmptyState>Nenhum membro neste sector.</EmptyState>
      ) : (
        <ul className="divide-y divide-docid-border">
          {members.map(m => (
            <li key={m.id} className="flex items-center justify-between py-3">
              <p className="text-sm text-docid-text">{m.fullName}</p>
              <span className="text-xs text-docid-muted">Membro</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
