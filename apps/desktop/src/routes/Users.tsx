import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { Building2, Edit, FilterX, Shield, TrendingUp, UserCheck, UserPlus, UserX } from "lucide-react";
import { EmptyState, MetricCard, Modal, PageHeader, Pagination, StatusChip } from "../components/docid-ui";

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [sectors, setSectors] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [newUser, setNewUser] = useState({ fullName: "", email: "", password: "", sectorId: "", roleId: "" });

  const load = () => {
    api.get<any>("/users").then((res) => setUsers(res.data || [])).catch(() => {});
    api.get<any>("/sectors").then((res) => setSectors(res.data || [])).catch(() => {});
    api.get<any>("/roles").then((res) => setRoles(res.data || [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const filteredUsers = useMemo(() => users.filter((u) => (
    (!sectorFilter || u.sectorId === sectorFilter)
    && (!statusFilter || String(!!u.isActive) === statusFilter)
    && (!roleFilter || u.userRoles?.some((ur: any) => ur.roleId === roleFilter))
  )), [users, sectorFilter, roleFilter, statusFilter]);

  const createUser = async () => {
    if (!newUser.fullName || !newUser.email || !newUser.password || !newUser.sectorId) return;
    try {
      const res = await api.post<any>("/users", newUser);
      if (newUser.roleId) {
        await api.post(`/users/${res.data.id}/roles`, { roleId: newUser.roleId, sectorId: newUser.sectorId });
      }
      setNewUser({ fullName: "", email: "", password: "", sectorId: "", roleId: "" });
      setShowCreate(false);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const saveEdit = async (id: string) => {
    await api.patch(`/users/${id}`, { fullName: editName, email: editEmail });
    setEditing(null);
    load();
  };

  const toggleActive = async (id: string, current: boolean) => {
    if (current) await api.delete(`/users/${id}`);
    else await api.patch(`/users/${id}`, { isActive: true });
    load();
  };

  const startEdit = (u: any) => {
    setEditing(u.id);
    setEditName(u.fullName);
    setEditEmail(u.email);
  };

  const sectorName = (id: string | null) => sectors.find((s) => s.id === id)?.name || "—";

  return (
    <div>
      <PageHeader
        title="Utilizadores"
        description="Gerencie os acessos e permissões da sua organização."
        actions={<button onClick={() => setShowCreate(true)} className="docid-button-primary"><UserPlus className="h-4 w-4" /> Adicionar Utilizador</button>}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Activos" value={users.filter((u) => u.isActive).length.toString()} icon={UserCheck} accent="text-docid-secondary" />
        <MetricCard label="Total Utilizadores" value={users.length.toString()} icon={UserCheck} accent="text-docid-secondary" />
        <MetricCard label="Sectores" value={sectors.length.toString()} icon={Building2} />
        <MetricCard label="Administradores" value={users.filter((u) => u.roles?.some((r: any) => r.name === "ORG_ADMIN")).length.toString()} icon={Shield} accent="text-docid-primary-soft" />
      </div>

      <section className="docid-panel mb-6 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} className="docid-input">
            <option value="">Todos os Sectores</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="docid-input">
            <option value="">Todas as Roles</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="docid-input">
            <option value="">Todos os Status</option>
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </select>
          <button onClick={() => { setSectorFilter(""); setRoleFilter(""); setStatusFilter(""); }} className="docid-button-secondary">
            <FilterX className="h-4 w-4" /> Limpar Filtros
          </button>
        </div>
      </section>

      <section className="docid-panel overflow-hidden">
        <table className="docid-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Email</th>
              <th>Sector</th>
              <th>Role</th>
              <th>Status</th>
              <th>Data Criação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr key={u.id} className={!u.isActive ? "opacity-60" : ""}>
                <td>
                  {editing === u.id ? (
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="docid-input w-full" />
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-docid-surface-high text-xs font-semibold text-docid-primary-soft">
                        {u.fullName?.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                      <span className="font-medium">{u.fullName}</span>
                    </div>
                  )}
                </td>
                <td>{editing === u.id ? <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="docid-input w-full" /> : <span className="text-docid-muted">{u.email}</span>}</td>
                <td>{sectorName(u.sectorId)}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.userRoles?.length ? u.userRoles.map((ur: any) => (
                      <StatusChip key={ur.id} tone="info">{ur.role?.name || ur.roleId}</StatusChip>
                    )) : <StatusChip>MEMBER</StatusChip>}
                  </div>
                </td>
                <td><StatusChip tone={u.isActive ? "success" : "neutral"}>{u.isActive ? "Ativo" : "Inativo"}</StatusChip></td>
                <td className="text-docid-muted">{u.createdAt ? new Date(u.createdAt).toLocaleDateString("pt-AO") : "—"}</td>
                <td>
                  <div className="flex gap-2">
                    {editing === u.id ? (
                      <>
                        <button onClick={() => saveEdit(u.id)} className="text-docid-secondary hover:underline">Guardar</button>
                        <button onClick={() => setEditing(null)} className="text-docid-muted hover:underline">Cancelar</button>
                      </>
                    ) : (
                      <button onClick={() => startEdit(u)} className="text-docid-primary-soft hover:underline"><Edit className="inline h-4 w-4" /></button>
                    )}
                    <button onClick={() => toggleActive(u.id, u.isActive)} className={u.isActive ? "text-docid-error" : "text-docid-secondary"}>
                      {u.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredUsers.length === 0 && <EmptyState>Nenhum utilizador encontrado.</EmptyState>}
        <Pagination totalLabel={`${filteredUsers.length} utilizador${filteredUsers.length !== 1 ? "es" : ""}`} />
      </section>

      {showCreate && (
        <Modal
          title="Add New User"
          onClose={() => setShowCreate(false)}
          footer={(
            <>
              <button onClick={() => setShowCreate(false)} className="docid-button-secondary">Cancelar</button>
              <button onClick={createUser} disabled={!newUser.fullName || !newUser.email || !newUser.password || !newUser.sectorId} className="docid-button-primary">Guardar</button>
            </>
          )}
        >
          <p className="mb-5 text-sm text-docid-muted">Perfil do novo utilizador</p>
          <div className="grid gap-4 md:grid-cols-2">
            <input placeholder="Nome completo" value={newUser.fullName} onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })} className="docid-input" />
            <input placeholder="Email corporativo" type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="docid-input" />
            <input placeholder="Palavra-passe" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="docid-input" />
            <input placeholder="Confirmar palavra-passe" type="password" className="docid-input" />
            <select value={newUser.sectorId} onChange={(e) => setNewUser({ ...newUser, sectorId: e.target.value })} className="docid-input">
              <option value="">Selecionar sector</option>
              {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={newUser.roleId} onChange={(e) => setNewUser({ ...newUser, roleId: e.target.value })} className="docid-input">
              <option value="">Access Role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </Modal>
      )}
    </div>
  );
}
