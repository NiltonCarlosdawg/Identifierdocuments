import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Users, UserCheck } from "lucide-react";

export default function Sectors() {
  const [sectors, setSectors] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [supervisorId, setSupervisorId] = useState("");
  const [newSector, setNewSector] = useState({ name: "", code: "" });
  const [showCreate, setShowCreate] = useState(false);

  const load = () => {
    api.get<any>("/sectors").then((res) => setSectors(res.data || []));
    api.get<any>("/users").then((res) => setUsers(res.data || []));
  };

  useEffect(() => { load(); }, []);

  const assignSupervisor = async (sectorId: string) => {
    await api.patch(`/sectors/${sectorId}/supervisor`, { supervisorId });
    setEditing(null);
    load();
  };

  const createSector = async () => {
    if (!newSector.name || !newSector.code) return;
    await api.post("/sectors", newSector);
    setNewSector({ name: "", code: "" });
    setShowCreate(false);
    load();
  };

  const getSupervisorName = (id: string | null) => {
    if (!id) return "—";
    const u = users.find((x) => x.id === id);
    return u?.fullName || "—";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Sectores</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700"
        >
          {showCreate ? "Fechar" : "Novo sector"}
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold mb-4">Criar sector</h2>
          <div className="grid grid-cols-2 gap-4">
            <input
              placeholder="Nome"
              value={newSector.name}
              onChange={(e) => setNewSector({ ...newSector, name: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              placeholder="Código (ex: RH)"
              value={newSector.code}
              onChange={(e) => setNewSector({ ...newSector, code: e.target.value.toUpperCase() })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button onClick={createSector} className="mt-4 rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700">
            Criar
          </button>
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Sector</th>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Supervisor</th>
              <th className="px-4 py-3">Acções</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sectors.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
                <td className="px-4 py-3">
                  {editing === s.id ? (
                    <select
                      value={supervisorId}
                      onChange={(e) => setSupervisorId(e.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                    >
                      <option value="">Sem supervisor</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.fullName}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="flex items-center gap-1">
                      <UserCheck className="h-3.5 w-3.5 text-gray-400" />
                      {getSupervisorName(s.supervisorId)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {editing === s.id ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => assignSupervisor(s.id)}
                        className="rounded-lg bg-verano-600 px-3 py-1 text-xs font-medium text-white"
                      >
                        Guardar
                      </button>
                      <button onClick={() => setEditing(null)} className="rounded-lg bg-gray-100 px-3 py-1 text-xs">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditing(s.id); setSupervisorId(s.supervisorId || ""); }}
                      className="rounded-lg bg-gray-100 px-3 py-1 text-xs font-medium hover:bg-gray-200"
                    >
                      Atribuir supervisor
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
