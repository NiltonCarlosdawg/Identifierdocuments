import { useState, useEffect } from "react";
import { api } from "../../infrastructure/di/container";
import { PageHeader, Modal, StatusChip, EmptyState, OfflineNotice } from "../components/docid-ui";
import { useOfflineCache } from "../hooks/useOfflineCache";
import { mapError, friendlyRole } from "../../shared/errors/mapError";
import { Plus, Trash2, Shield, RefreshCw, Users } from "lucide-react";

export interface Permission { resource: string; action: string; }

export const PERMISSION_RESOURCES = ["documents", "identifiers", "sectors", "users", "audit", "roles"];
export const PERMISSION_ACTIONS = ["read", "create", "approve", "generate", "manage"];
export const PERMISSION_CATALOG: Permission[] = PERMISSION_RESOURCES.flatMap(resource => PERMISSION_ACTIONS.map(action => ({ resource, action })));

const RESOURCE_LABELS: Record<string, string> = {
  documents: "Documentos", identifiers: "Identificadores", sectors: "Sectores",
  users: "Utilizadores", audit: "Auditoria", roles: "Funções de acesso",
};
const ACTION_LABELS: Record<string, string> = {
  read: "Consultar", create: "Criar", approve: "Aprovar", generate: "Gerar", manage: "Gerir",
};

/** Aceita apenas pares do catálogo e remove repetidos — o servidor grava permissões uma vez cada. */
export function normalisePermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  const known = new Set(PERMISSION_CATALOG.map(p => `${p.resource}:${p.action}`));
  const seen = new Set<string>();
  const out: Permission[] = [];
  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;
    const { resource, action } = item as Partial<Permission>;
    if (typeof resource !== "string" || typeof action !== "string") continue;
    const key = `${resource}:${action}`;
    if (!known.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ resource, action });
  }
  return out;
}

interface RoleRow { id: string; name: string; isSystem: boolean; permissions: Permission[]; }
interface RoleUserRow { userId: string; email: string; fullName: string; sectorName: string | null; isActive: boolean; grantedAt: string | null; }

export default function Roles() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [viewingUsers, setViewingUsers] = useState<RoleRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<RoleRow[]>({
    endpoint: "/roles",
    fetcher: async () => {
      const res = await api.get<{ data: RoleRow[] }>("/roles");
      return res.data || [];
    },
    onData: setRoles,
  });

  const handleDelete = async (role: RoleRow) => {
    if (!confirm(`Tem a certeza que deseja remover a função de acesso «${friendlyRole(role.name)}»?`)) return;
    setActionError("");
    setBusyId(role.id);
    try {
      await api.delete(`/roles/${role.id}`);
      await refresh();
    } catch (e: any) {
      setActionError(mapError(e, "Não foi possível remover a função de acesso."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Funções de acesso e permissões" description="Gerir as funções de acesso da organização e o que cada uma pode fazer" actions={
        <div className="flex gap-2">
          <button onClick={refresh} disabled={loading} className="docid-button-secondary"><RefreshCw className="h-4 w-4" /> Actualizar</button>
          <button onClick={() => setShowCreate(true)} className="docid-button-primary"><Plus className="h-4 w-4" /> Criar função de acesso</button>
        </div>
      } />
      {actionError && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 px-4 py-3 text-sm text-docid-error">{actionError}</div>}
      {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 px-4 py-3 text-sm text-docid-error">{error}</div>}
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}

      <div className="docid-panel overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-docid-muted">A carregar...</div>
        ) : roles.length === 0 ? (
          <EmptyState>Nenhuma função de acesso encontrada.</EmptyState>
        ) : (
          <table className="docid-table">
            <thead><tr><th>Nome</th><th>Tipo</th><th>O que pode fazer</th><th className="text-right">Acções</th></tr></thead>
            <tbody>
              {roles.map(role => (
                <tr key={role.id}>
                  <td className="font-medium text-docid-text">{friendlyRole(role.name)}</td>
                  <td><StatusChip tone={role.isSystem ? "neutral" : "info"}>{role.isSystem ? "Predefinida" : "Personalizada"}</StatusChip></td>
                  <td className="text-xs text-docid-muted">{normalisePermissions(role.permissions).length}</td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <button title="Utilizadores com esta função de acesso" onClick={() => setViewingUsers(role)} className="rounded-lg p-1.5 text-docid-muted hover:bg-docid-surface-high hover:text-docid-text"><Users className="h-4 w-4" /></button>
                      <button title="Permissões" onClick={() => setEditing(role)} disabled={role.isSystem} className="rounded-lg p-1.5 text-docid-muted hover:bg-docid-surface-high hover:text-docid-text disabled:opacity-40"><Shield className="h-4 w-4" /></button>
                      <button title="Remover" onClick={() => handleDelete(role)} disabled={role.isSystem || busyId === role.id} className="rounded-lg p-1.5 text-docid-muted hover:bg-docid-surface-high hover:text-docid-error disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <CreateRoleModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); refresh(); }} />}
      {editing && <PermissionsModal role={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
      {viewingUsers && <RoleUsersModal role={viewingUsers} onClose={() => setViewingUsers(null)} />}
    </div>
  );
}

function CreateRoleModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true); setError("");
    try {
      await api.post("/roles", { name: name.trim() });
      onDone();
    } catch (e: any) {
      setError(mapError(e, "Não foi possível criar a função de acesso."));
    } finally { setLoading(false); }
  };

  return (
    <Modal title="Criar função de acesso" onClose={onClose} footer={<><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleSubmit} disabled={loading || !name.trim()} className="docid-button-primary">{loading ? "A criar..." : "Criar"}</button></>}>
      <div className="space-y-3">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        <label className="block text-xs text-docid-muted">Nome da função de acesso<input autoFocus value={name} onChange={e => setName(e.target.value)} className="docid-input mt-1 w-full" placeholder="Ex: Analista" /></label>
      </div>
    </Modal>
  );
}

function PermissionsModal({ role, onClose, onDone }: { role: RoleRow; onClose: () => void; onDone: () => void }) {
  const [selected, setSelected] = useState<Permission[]>(() => normalisePermissions(role.permissions));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const has = (resource: string, action: string) => selected.some(p => p.resource === resource && p.action === action);
  const toggle = (resource: string, action: string) => setSelected(prev => has(resource, action)
    ? prev.filter(p => p.resource !== resource || p.action !== action)
    : [...prev, { resource, action }]);

  const handleSave = async () => {
    setLoading(true); setError("");
    try {
      await api.patch(`/roles/${role.id}/permissions`, { permissions: selected });
      onDone();
    } catch (e: any) {
      setError(mapError(e, "Não foi possível guardar as permissões."));
    } finally { setLoading(false); }
  };

  return (
    <Modal title={`O que pode fazer — ${friendlyRole(role.name)}`} onClose={onClose} footer={<><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleSave} disabled={loading} className="docid-button-primary">{loading ? "A guardar..." : "Guardar"}</button></>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        <p className="text-xs text-docid-muted">Seleccione o que esta função de acesso pode fazer. As funções predefinidas não podem ser alteradas.</p>
        <div className="space-y-3">
          {PERMISSION_RESOURCES.map(resource => (
            <div key={resource} className="rounded-lg border border-docid-border p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-docid-muted">{RESOURCE_LABELS[resource] ?? "Outra área"}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {PERMISSION_ACTIONS.map(action => (
                  <label key={action} className="flex items-center gap-2 text-sm text-docid-text">
                    <input type="checkbox" checked={has(resource, action)} onChange={() => toggle(resource, action)} className="rounded border-docid-border bg-docid-surface-low text-docid-primary focus:ring-docid-primary" />
                    {ACTION_LABELS[action] ?? "Consultar"}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function RoleUsersModal({ role, onClose }: { role: RoleRow; onClose: () => void }) {
  const [users, setUsers] = useState<RoleUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ data: RoleUserRow[] }>(`/roles/${role.id}/users`);
        setUsers(res.data || []);
      } catch (e: any) {
        setError(mapError(e, "Não foi possível carregar os utilizadores."));
      } finally { setLoading(false); }
    })();
  }, [role.id]);

  return (
    <Modal title={`Utilizadores — ${friendlyRole(role.name)}`} onClose={onClose} footer={<button onClick={onClose} className="docid-button-primary">Fechar</button>}>
      <div className="space-y-3">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        {loading ? <p className="text-sm text-docid-muted">A carregar...</p> : users.length === 0 ? <p className="text-sm text-docid-muted">Nenhum utilizador com esta função de acesso.</p> : (
          <div className="docid-panel divide-y divide-docid-border">
            {users.map(u => (
              <div key={u.userId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-docid-text">{u.fullName} <span className="text-xs font-normal text-docid-muted">{u.email}</span></p>
                  <p className="text-xs text-docid-muted">{u.sectorName || "—"}{u.grantedAt ? ` · desde ${new Date(u.grantedAt).toLocaleDateString("pt-AO")}` : ""}</p>
                </div>
                <StatusChip tone={u.isActive ? "success" : "error"}>{u.isActive ? "Activo" : "Inactivo"}</StatusChip>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
