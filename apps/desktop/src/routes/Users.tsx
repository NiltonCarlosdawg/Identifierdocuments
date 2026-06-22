import { useEffect, useState } from "react";
import { api } from "../services/api";
import { UserPlus, UserCheck, UserX, Shield } from "lucide-react";

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [sectors, setSectors] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [newUser, setNewUser] = useState({ fullName: "", email: "", password: "", sectorId: "", roleId: "" });

  const load = () => {
    api.get<any>("/users").then((res) => setUsers(res.data || [])).catch(() => {});
    api.get<any>("/sectors").then((res) => setSectors(res.data || [])).catch(() => {});
    api.get<any>("/roles").then((res) => setRoles(res.data || [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);

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

  const moveSector = async (id: string, sectorId: string) => {
    await api.patch(`/users/${id}/sector`, { sectorId });
    load();
  };

  const toggleActive = async (id: string, current: boolean) => {
    if (current) {
      await api.delete(`/users/${id}`);
    } else {
      await api.patch(`/users/${id}`, { isActive: true });
    }
    load();
  };

  const assignRole = async (userId: string, roleId: string) => {
    try {
      await api.post(`/users/${userId}/roles`, { roleId });
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const removeRole = async (userId: string, roleId: string) => {
    await api.delete(`/users/${userId}/roles/${roleId}`);
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Utilizadores</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700 transition-colors"
        >
          <UserPlus className="h-4 w-4" /> {showCreate ? "Fechar" : "Novo utilizador"}
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold mb-4">Criar utilizador</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input placeholder="Nome completo" value={newUser.fullName} onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input placeholder="Email" type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input placeholder="Password (mín. 6 caracteres)" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <select value={newUser.sectorId} onChange={(e) => setNewUser({ ...newUser, sectorId: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Seleccionar sector</option>
              {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={newUser.roleId} onChange={(e) => setNewUser({ ...newUser, roleId: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Role (opcional)</option>
              {roles.filter((r) => r.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <button onClick={createUser} disabled={!newUser.fullName || !newUser.email || !newUser.password || !newUser.sectorId}
            className="mt-4 rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700 disabled:opacity-50 transition-colors">
            Criar
          </button>
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Sector</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Acções</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className={`hover:bg-gray-50 ${!u.isActive ? "opacity-50" : ""}`}>
                <td className="px-4 py-3">
                  {editing === u.id ? (
                    <input value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                  ) : (
                    <span className="font-medium">{u.fullName}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {editing === u.id ? (
                    <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                  ) : (
                    <span className="text-gray-600">{u.email}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <select value={u.sectorId || ""} onChange={(e) => moveSector(u.id, e.target.value)}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-xs bg-transparent hover:border-gray-300">
                    {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.userRoles?.map((ur: any) => (
                      <span key={ur.id} className="inline-flex items-center gap-1 rounded-full bg-verano-50 px-2 py-0.5 text-xs font-medium text-verano-700">
                        <Shield className="h-3 w-3" />
                        {ur.role?.name || ur.roleId}
                        <button onClick={() => removeRole(u.id, ur.roleId)} className="ml-0.5 text-verano-400 hover:text-red-500">✕</button>
                      </span>
                    ))}
                    <select defaultValue="" onChange={(e) => { if (e.target.value) assignRole(u.id, e.target.value); e.target.value = ""; }}
                      className="rounded-lg border border-gray-200 px-1 py-0.5 text-xs bg-transparent hover:border-gray-300">
                      <option value="">+ role</option>
                      {roles.filter((r) => !u.userRoles?.some((ur: any) => ur.roleId === r.id)).map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {u.isActive ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600"><UserCheck className="h-3 w-3" /> Activo</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400"><UserX className="h-3 w-3" /> Inactivo</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {editing === u.id ? (
                      <>
                        <button onClick={() => saveEdit(u.id)} className="rounded-lg bg-verano-600 px-3 py-1 text-xs font-medium text-white">Guardar</button>
                        <button onClick={() => setEditing(null)} className="rounded-lg bg-gray-100 px-3 py-1 text-xs">Cancelar</button>
                      </>
                    ) : (
                      <button onClick={() => startEdit(u)} className="rounded-lg bg-gray-100 px-3 py-1 text-xs font-medium hover:bg-gray-200">Editar</button>
                    )}
                    <button onClick={() => toggleActive(u.id, u.isActive)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium ${u.isActive ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-600 hover:bg-green-100"}`}>
                      {u.isActive ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum utilizador encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
