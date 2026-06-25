import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Download, Edit, Eye, Gavel, Plus, Users, UserSearch } from "lucide-react";
import { EmptyState, MetricCard, Modal, PageHeader, StatusChip } from "../components/docid-ui";

interface Sector {
  id: string;
  name: string;
  code: string;
  supervisorId: string | null;
  supervisor?: { fullName: string } | null;
  createdAt: string;
}

interface User {
  id: string;
  fullName: string;
  email: string;
}

export default function Sectors() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tableEditing, setTableEditing] = useState<string | null>(null);
  const [supervisorId, setSupervisorId] = useState("");
  const [newSector, setNewSector] = useState({ name: "", code: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [loadingCreate, setLoadingCreate] = useState(false);

  const [editingSector, setEditingSector] = useState<Sector | null>(null);
  const [editForm, setEditForm] = useState({ name: "", code: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  const [membersSector, setMembersSector] = useState<Sector | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const load = () => {
    api.get<{ data: Sector[] }>("/sectors").then((res) => setSectors(res.data || [])).catch(() => {});
    api.get<{ data: User[] }>("/users").then((res) => setUsers(res.data || [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const assignSupervisor = async (sectorId: string) => {
    await api.patch(`/sectors/${sectorId}/supervisor`, { supervisorId });
    setTableEditing(null);
    load();
  };

  const createSector = async () => {
    if (!newSector.name || !newSector.code) return;
    setLoadingCreate(true);
    try {
      await api.post("/sectors", newSector);
      setNewSector({ name: "", code: "" });
      setShowCreate(false);
      load();
    } finally {
      setLoadingCreate(false);
    }
  };

  const openEditModal = (s: Sector) => {
    setEditingSector(s);
    setEditForm({ name: s.name, code: s.code });
  };

  const saveEdit = async () => {
    if (!editingSector || !editForm.name || !editForm.code) return;
    setSavingEdit(true);
    try {
      await api.patch(`/sectors/${editingSector.id}`, { name: editForm.name, code: editForm.code });
      setEditingSector(null);
      load();
    } finally {
      setSavingEdit(false);
    }
  };

  const openMembersModal = async (s: Sector) => {
    setMembersSector(s);
    setLoadingMembers(true);
    setMembers([]);
    try {
      const res = await api.get<{ data: any[] }>(`/sectors/${s.id}/members`);
      setMembers(res.data || []);
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  };

  const getSupervisorName = (id: string | null) => users.find((x) => x.id === id)?.fullName || "Sem supervisor";

  const exportCsv = () => {
    const headers = ["Nome", "Código", "Supervisor"];
    const rows = sectors.map((s) => [
      s.name,
      s.code,
      getSupervisorName(s.supervisorId),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sectores_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Sectores"
        description="Gerencie a estrutura organizacional e hierárquica da sua empresa."
        actions={<button onClick={() => setShowCreate(true)} className="docid-button-primary"><Plus className="h-4 w-4" /> Criar Sector</button>}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Sectores" value={sectors.length} icon={Users} />
        <MetricCard label="Total Membros" value={users.length} icon={Users} accent="text-docid-secondary" />
        <MetricCard label="Sem Supervisor" value={sectors.filter((s) => !s.supervisorId).length} icon={UserSearch} accent="text-docid-tertiary" />
        <MetricCard label="Sectores Activos" value={sectors.length} icon={Gavel} accent="text-docid-primary-soft" />
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sectors.map((s) => (
          <div key={s.id} className="docid-panel p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{s.name}</h2>
                <StatusChip>{s.code}</StatusChip>
              </div>
            </div>
            <p className="text-xs uppercase tracking-wider text-docid-muted">Supervisor Responsável</p>
            <p className={`mt-1 text-sm ${s.supervisorId ? "text-docid-text" : "text-docid-tertiary"}`}>
              {getSupervisorName(s.supervisorId)}
            </p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => openEditModal(s)} className="docid-button-secondary flex-1 px-3 py-2"><Edit className="h-4 w-4" /> Editar</button>
              <button onClick={() => openMembersModal(s)} className="docid-button-secondary flex-1 px-3 py-2"><Eye className="h-4 w-4" /> Ver Membros</button>
            </div>
          </div>
        ))}
        <button onClick={() => setShowCreate(true)} className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-docid-border bg-docid-surface-low text-docid-muted transition hover:border-docid-primary hover:text-docid-text">
          <Plus className="h-8 w-8" />
          <span className="mt-3 font-semibold">Novo Sector</span>
          <span className="text-sm">Adicionar Unidade</span>
        </button>
      </div>

      <section className="docid-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-docid-border px-5 py-4">
          <h2 className="font-semibold">Resumo da Hierarquia</h2>
          <button onClick={exportCsv} className="docid-button-secondary"><Download className="h-4 w-4" /> Exportar CSV</button>
        </div>
        <table className="docid-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Código</th>
              <th>Supervisor</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {sectors.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td><StatusChip>{s.code}</StatusChip></td>
                <td>
                  {tableEditing === s.id ? (
                    <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} className="docid-input">
                      <option value="">Sem supervisor</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </select>
                  ) : getSupervisorName(s.supervisorId)}
                </td>
                <td>
                  {tableEditing === s.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => assignSupervisor(s.id)} className="docid-button-primary px-3 py-1.5 text-xs">Guardar</button>
                      <button onClick={() => setTableEditing(null)} className="docid-button-secondary px-3 py-1.5 text-xs">Cancelar</button>
                    </div>
                  ) : (
                    <button onClick={() => { setTableEditing(s.id); setSupervisorId(s.supervisorId || ""); }} className="text-docid-primary-soft text-xs hover:underline">Atribuir supervisor</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sectors.length === 0 && <EmptyState>Nenhum sector encontrado.</EmptyState>}
      </section>

      {showCreate && (
        <Modal
          title="Criar Novo Sector"
          onClose={() => setShowCreate(false)}
          footer={(
            <>
              <button onClick={() => setShowCreate(false)} className="docid-button-secondary">Cancelar</button>
              <button onClick={createSector} disabled={loadingCreate || !newSector.name || !newSector.code} className="docid-button-primary">
                {loadingCreate ? "A criar..." : "Criar Sector"}
              </button>
            </>
          )}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Nome do Sector</label>
              <input
                className="docid-input w-full"
                value={newSector.name}
                onChange={(e) => setNewSector({ ...newSector, name: e.target.value })}
                placeholder="Ex: Recursos Humanos"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Código</label>
              <input
                className="docid-input w-full font-mono uppercase"
                maxLength={5}
                value={newSector.code}
                onChange={(e) => setNewSector({ ...newSector, code: e.target.value.toUpperCase() })}
                placeholder="Ex: RH"
              />
            </div>
          </div>
        </Modal>
      )}

      {editingSector && (
        <Modal
          title={`Editar Sector: ${editingSector.name}`}
          onClose={() => setEditingSector(null)}
          footer={(
            <>
              <button onClick={() => setEditingSector(null)} className="docid-button-secondary">Cancelar</button>
              <button onClick={saveEdit} disabled={savingEdit || !editForm.name || !editForm.code} className="docid-button-primary">
                {savingEdit ? "A guardar..." : "Guardar Alterações"}
              </button>
            </>
          )}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Nome do Sector</label>
              <input
                className="docid-input w-full"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Código</label>
              <input
                className="docid-input w-full font-mono uppercase"
                maxLength={5}
                value={editForm.code}
                onChange={(e) => setEditForm({ ...editForm, code: e.target.value.toUpperCase() })}
              />
            </div>
          </div>
        </Modal>
      )}

      {membersSector && (
        <Modal
          title={`${membersSector.name} — ${members.length} membro${members.length !== 1 ? "s" : ""}`}
          onClose={() => setMembersSector(null)}
          maxWidth="max-w-2xl"
        >
          {loadingMembers ? (
            <div className="flex items-center justify-center py-8 text-docid-muted">A carregar membros...</div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-docid-muted">
              <Users className="mb-2 h-8 w-8 opacity-50" />
              <p>Nenhum membro neste sector.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg border border-docid-border bg-docid-surface-lowest p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-docid-primary/15 text-xs font-semibold text-docid-primary-soft">
                      {(m.fullName || "AD").split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium">{m.fullName}</p>
                      <p className="text-xs text-docid-muted">{m.email}</p>
                    </div>
                  </div>
                  {m.id === membersSector.supervisorId && (
                    <StatusChip tone="info">Supervisor</StatusChip>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
