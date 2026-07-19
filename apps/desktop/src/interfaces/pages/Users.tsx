import { useState, useEffect, useCallback } from "react";
import { api } from "../../infrastructure/di/container";
import { PageHeader, Modal, StatusChip, EmptyState, Pagination } from "../components/docid-ui";
import { UsersIcon, Search, Plus, Shield, RefreshCw } from "lucide-react";

interface UserRow { id: string; email: string; fullName: string; isActive: boolean; sectorId: string | null; sectorName: string | null; roles: { id: string; name: string }[]; createdAt: string; }
interface Sector { id: string; name: string; }

export default function Users() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<UserRow | null>(null);

  const load = useCallback(async (page = 1) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (sectorFilter) params.set("sectorId", sectorFilter);
      const res = await api.get<{ data: UserRow[]; meta: { total: number; page: number; limit: number } }>(`/users?${params}`);
      setRows(res.data || []);
      setMeta(res.meta);
    } catch (err: any) { setError(err.message || "Erro ao carregar utilizadores."); }
    finally { setLoading(false); }
  }, [sectorFilter]);

  const loadSectors = useCallback(async () => {
    try { const res = await api.get<{ data: Sector[] }>("/sectors"); setSectors(res.data || []); } catch {}
  }, []);

  useEffect(() => { loadSectors(); }, [loadSectors]);
  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => !search || r.fullName.toLowerCase().includes(search.toLowerCase()) || r.email.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader title="Utilizadores" description="Gerir contas de utilizador da organização" actions={<button onClick={() => setShowCreate(true)} className="docid-button-primary"><Plus className="h-4 w-4" /> Criar utilizador</button>} />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input value={search} onChange={e => setSearch(e.target.value)} className="docid-input w-full pl-9" placeholder="Pesquisar utilizador..." /></div>
        <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} className="docid-input w-48 text-sm"><option value="">Todos os sectores</option>{sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </div>
      <div className="docid-panel overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-docid-muted">A carregar...</div>
        ) : rows.length === 0 ? (
          <EmptyState>Nenhum utilizador encontrado.</EmptyState>
        ) : (
          <table className="docid-table">
            <thead><tr><th>Nome</th><th>Email</th><th>Sector</th><th>Roles</th><th>Estado</th><th>Criado em</th><th></th></tr></thead>
            <tbody>{filtered.map(row => (
              <tr key={row.id} className="cursor-pointer" onClick={() => setSelected(row)}>
                <td className="font-medium">{row.fullName}</td>
                <td className="text-xs text-docid-muted">{row.email}</td>
                <td className="text-xs">{row.sectorName || "-"}</td>
                <td><div className="flex flex-wrap gap-1">{row.roles.map(r => <span key={r.id} className="rounded-full bg-docid-surface-high px-2 py-0.5 text-[10px] font-medium text-docid-muted">{r.name}</span>)}</div></td>
                <td><StatusChip tone={row.isActive ? "success" : "error"}>{row.isActive ? "Activo" : "Inactivo"}</StatusChip></td>
                <td className="text-xs text-docid-muted">{new Date(row.createdAt).toLocaleDateString("pt-AO")}</td>
                <td><button onClick={e => { e.stopPropagation(); setSelected(row); }} className="rounded p-1 text-docid-muted hover:text-docid-text"><Shield className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <Pagination totalLabel={`${meta.total} utilizador(es)`} />
      </div>
      {showCreate && <CreateUserModal sectors={sectors} onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} />}
      {selected && <DetailUserModal user={selected} sectors={sectors} onClose={() => setSelected(null)} onDone={() => { setSelected(null); load(); }} />}
    </div>
  );
}

function CreateUserModal({ sectors, onClose, onDone }: { sectors: Sector[]; onClose: () => void; onDone: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!fullName.trim() || !email.trim() || password.length < 6) return;
    setError(""); setLoading(true);
    try {
      await api.post("/users", { fullName: fullName.trim(), email: email.trim(), password, sectorId: sectorId || undefined });
      onDone();
    } catch (err: any) { setError(err.message || "Erro ao criar utilizador."); } finally { setLoading(false); }
  };

  return (
    <Modal title="Criar Utilizador" onClose={onClose} footer={<><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleSubmit} disabled={loading || !fullName.trim() || !email.trim() || password.length < 6} className="docid-button-primary">{loading ? "A criar..." : "Criar"}</button></>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nome completo</label><input value={fullName} onChange={e => setFullName(e.target.value)} className="docid-input w-full" placeholder="Ex: Maria Santos" autoFocus /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} className="docid-input w-full" placeholder="maria@empresa.com" /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Palavra-passe <span className="font-normal text-docid-outline">(mín. 6 caracteres)</span></label><input type="password" value={password} onChange={e => setPassword(e.target.value)} className="docid-input w-full" placeholder="••••••••" /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Sector</label><select value={sectorId} onChange={e => setSectorId(e.target.value)} className="docid-input w-full"><option value="">Seleccionar sector...</option>{sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      </div>
    </Modal>
  );
}

function DetailUserModal({ user, sectors, onClose, onDone }: { user: UserRow; sectors: Sector[]; onClose: () => void; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [sectorId, setSectorId] = useState(user.sectorId || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!fullName.trim() || !email.trim()) return;
    setError(""); setLoading(true);
    try {
      await api.patch(`/users/${user.id}`, { fullName: fullName.trim(), email: email.trim() });
      if (sectorId !== (user.sectorId || "")) {
        await api.patch(`/users/${user.id}/sector`, { sectorId: sectorId || null });
      }
      onDone();
    } catch (err: any) { setError(err.message || "Erro ao actualizar utilizador."); } finally { setLoading(false); }
  };

  const handleDeactivate = async () => {
    if (!confirm("Tem a certeza que deseja desactivar este utilizador?")) return;
    setLoading(true);
    try { await api.delete(`/users/${user.id}`); onDone(); } catch (err: any) { setError(err.message); setLoading(false); }
  };

  return (
    <Modal title={user.fullName} onClose={onClose} footer={
      <div className="flex gap-2">
        <button onClick={handleDeactivate} disabled={loading || !user.isActive} className="docid-button-secondary text-docid-error">Desactivar</button>
        {editing ? <><button onClick={() => setEditing(false)} className="docid-button-secondary">Cancelar</button><button onClick={handleSave} disabled={loading} className="docid-button-primary">{loading ? "A guardar..." : "Guardar"}</button></> : <button onClick={() => setEditing(true)} className="docid-button-primary">Editar</button>}
      </div>
    }>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        {editing ? (
          <>
            <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nome completo</label><input value={fullName} onChange={e => setFullName(e.target.value)} className="docid-input w-full" /></div>
            <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} className="docid-input w-full" /></div>
            <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Sector</label><select value={sectorId} onChange={e => setSectorId(e.target.value)} className="docid-input w-full"><option value="">Sem sector</option>{sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs text-docid-muted">Email</p><p className="font-medium">{user.email}</p></div>
            <div><p className="text-xs text-docid-muted">Sector</p><p className="font-medium">{user.sectorName || "—"}</p></div>
            <div><p className="text-xs text-docid-muted">Estado</p><StatusChip tone={user.isActive ? "success" : "error"}>{user.isActive ? "Activo" : "Inactivo"}</StatusChip></div>
            <div><p className="text-xs text-docid-muted">Criado em</p><p className="font-medium">{new Date(user.createdAt).toLocaleDateString("pt-AO")}</p></div>
            <div className="col-span-2"><p className="text-xs text-docid-muted mb-1">Roles</p><div className="flex flex-wrap gap-1">{user.roles.map(r => <span key={r.id} className="rounded-full bg-docid-primary/10 px-3 py-1 text-xs font-medium text-docid-primary-soft">{r.name}</span>)}</div></div>
          </div>
        )}
      </div>
    </Modal>
  );
}
