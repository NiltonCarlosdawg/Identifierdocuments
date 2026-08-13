import { useState, useEffect } from "react";
import { api } from "../../infrastructure/di/container";
import { PageHeader, Modal, StatusChip, EmptyState, Pagination, OfflineNotice } from "../components/docid-ui";
import { useOfflineCache } from "../hooks/useOfflineCache";
import { useCachedAux } from "../hooks/useCachedAux";
import { mapError } from "../../shared/errors/mapError";
import { useAuthStore } from "../stores/authStore";
import { UsersIcon, Search, Plus, Shield, RefreshCw, Upload, Download, CheckCircle2, AlertTriangle, Ban, Mail } from "lucide-react";

interface UserRow { id: string; email: string; fullName: string; isActive: boolean; sectorId: string | null; sectorName: string | null; roles: { id: string; name: string }[]; createdAt: string; }
interface Sector { id: string; name: string; }

export default function Users() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20 });
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<UserRow | null>(null);

  const listParams = sectorFilter ? `page=1&limit=20&sectorId=${encodeURIComponent(sectorFilter)}` : "page=1&limit=20";

  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<{ data: UserRow[]; meta: { total: number; page: number; limit: number } }>({
    endpoint: "/users",
    params: listParams,
    fetcher: async () => {
      const res = await api.get<{ data: UserRow[]; meta: { total: number; page: number; limit: number } }>(`/users?${listParams}`);
      return { data: res.data || [], meta: res.meta || { total: 0, page: 1, limit: 20 } };
    },
    onData: result => { setRows(result.data); setMeta(result.meta); },
  });

  const fetchAux = useCachedAux();

  useEffect(() => {
    (async () => {
      const sectors = await fetchAux<Sector[]>("/sectors");
      if (sectors) setSectors(sectors);
    })();
  }, [fetchAux]);

  const canManage = (useAuthStore(s => s.user)?.roles || []).some(r => r === "ORG_ADMIN" || r === "SECTOR_SUPERVISOR");
  const isAdmin = (useAuthStore(s => s.user)?.roles || []).includes("ORG_ADMIN");
  const filtered = rows.filter(r => !search || r.fullName.toLowerCase().includes(search.toLowerCase()) || r.email.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader title="Utilizadores" description="Gerir contas de utilizador da organização" actions={<div className="flex gap-2">{canManage && <button onClick={() => setShowInvite(true)} className="docid-button-secondary"><Mail className="h-4 w-4" /> Convidar</button>}{isAdmin && <button onClick={() => setShowImport(true)} className="docid-button-secondary"><Upload className="h-4 w-4" /> Importar CSV</button>}{canManage && <button onClick={() => setShowCreate(true)} className="docid-button-primary"><Plus className="h-4 w-4" /> Criar utilizador</button>}</div>} />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}
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
                <td><div className="flex flex-wrap gap-1">{(row.roles || []).map(r => <span key={r.id} className="rounded-full bg-docid-surface-high px-2 py-0.5 text-[10px] font-medium text-docid-muted">{r.name}</span>)}</div></td>
                <td><StatusChip tone={row.isActive ? "success" : "error"}>{row.isActive ? "Activo" : "Inactivo"}</StatusChip></td>
                <td className="text-xs text-docid-muted">{new Date(row.createdAt).toLocaleDateString("pt-AO")}</td>
                <td><button onClick={e => { e.stopPropagation(); setSelected(row); }} className="rounded p-1 text-docid-muted hover:text-docid-text"><Shield className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <Pagination totalLabel={`${meta?.total ?? 0} utilizador(es)`} />
      </div>
      {showCreate && <CreateUserModal sectors={sectors} onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); refresh(); }} />}
      {showInvite && <InviteUserModal sectors={sectors} isAdmin={isAdmin} onClose={() => setShowInvite(false)} onDone={() => { setShowInvite(false); refresh(); }} />}
      {showImport && <ImportUsersModal onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); refresh(); }} />}
      {selected && <DetailUserModal user={selected} sectors={sectors} onClose={() => setSelected(null)} onDone={() => { setSelected(null); refresh(); }} />}
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
    } catch (err: any) { setError(mapError(err, "Erro ao criar utilizador.")); } finally { setLoading(false); }
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

function InviteUserModal({ sectors, isAdmin, onClose, onDone }: { sectors: Sector[]; isAdmin: boolean; onClose: () => void; onDone: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ emailed: boolean; temporaryPassword?: string } | null>(null);

  const handleSubmit = async () => {
    if (!fullName.trim() || !email.trim() || !sectorId) return;
    setError(""); setLoading(true);
    try {
      const res = await api.post<{ data: { emailed: boolean; temporaryPassword?: string } }>("/users/invite", {
        fullName: fullName.trim(),
        email: email.trim(),
        sectorId,
        role: isAdmin ? role : "MEMBER",
      });
      setResult({ emailed: !!res.data?.emailed, temporaryPassword: res.data?.temporaryPassword });
    } catch (err: any) { setError(mapError(err, "Erro ao enviar convite.")); } finally { setLoading(false); }
  };

  if (result) {
    return (
      <Modal title="Convite enviado" onClose={onDone} footer={<button onClick={onDone} className="docid-button-primary">Concluir</button>}>
        <div className="space-y-3">
          {result.emailed ? (
            <p className="text-sm text-docid-secondary">O convite foi enviado por email com a password temporária.</p>
          ) : (
            <>
              <p className="text-sm text-docid-tertiary">SMTP não está configurado. Entregue esta password fora de banda:</p>
              <p className="rounded-lg bg-docid-surface-low p-3 font-mono text-sm">{result.temporaryPassword}</p>
            </>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Convidar utilizador" onClose={onClose} footer={<><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleSubmit} disabled={loading || !fullName.trim() || !email.trim() || !sectorId} className="docid-button-primary">{loading ? "A convidar..." : "Enviar convite"}</button></>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nome completo</label><input value={fullName} onChange={e => setFullName(e.target.value)} className="docid-input w-full" placeholder="Ex: Maria Santos" autoFocus /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} className="docid-input w-full" placeholder="maria@empresa.com" /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Sector</label><select value={sectorId} onChange={e => setSectorId(e.target.value)} className="docid-input w-full"><option value="">Seleccionar sector...</option>{sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        {isAdmin && (
          <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="docid-input w-full">
              <option value="MEMBER">MEMBER</option>
              <option value="SECTOR_SUPERVISOR">SECTOR_SUPERVISOR</option>
            </select>
          </div>
        )}
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
    } catch (err: any) { setError(mapError(err, "Erro ao actualizar utilizador.")); } finally { setLoading(false); }
  };

  const handleDeactivate = async () => {
    if (!confirm("Tem a certeza que deseja desactivar este utilizador?")) return;
    setLoading(true);
    try { await api.delete(`/users/${user.id}`); onDone(); } catch (err: any) { setError(mapError(err, "Erro ao desactivar utilizador.")); setLoading(false); }
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
            <div className="col-span-2"><p className="text-xs text-docid-muted mb-1">Roles</p><div className="flex flex-wrap gap-1">{(user.roles || []).map(r => <span key={r.id} className="rounded-full bg-docid-primary/10 px-3 py-1 text-xs font-medium text-docid-primary-soft">{r.name}</span>)}</div></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

interface ImportReport { created: { email: string; fullName: string; password: string }[]; skipped: { row: number; reason: string }[]; errors: { row: number; reason: string }[]; }

function ImportUsersModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);

  const downloadTemplate = () => {
    const blob = new Blob(["email,full_name,sector,role\nmaria@empresa.com,Maria Santos,Financeiro,MEMBER\njoao@empresa.com,João Lima,Comercial,ORG_ADMIN"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "modelo-utilizadores.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCsvText(await file.text());
    setReport(null);
  };

  const handleImport = async () => {
    if (!csvText.trim()) return;
    setError(""); setLoading(true);
    try {
      const res = await api.post<{ data: ImportReport }>("/users/import", { csv: csvText });
      setReport(res.data);
      if (res.data.created.length > 0) onDone();
    } catch (err: any) { setError(mapError(err, "Erro ao importar utilizadores.")); } finally { setLoading(false); }
  };

  return (
    <Modal title="Importar Utilizadores (CSV)" onClose={onClose} footer={
      report
        ? <button onClick={onClose} className="docid-button-primary">Concluir</button>
        : <><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleImport} disabled={loading || !csvText.trim()} className="docid-button-primary">{loading ? "A importar..." : "Importar"}</button></>
    }>
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        {!report && (
          <>
            <div className="rounded-lg border border-docid-tertiary/30 bg-docid-tertiary/10 p-3 text-xs text-docid-tertiary">
              Formato: <code className="font-mono">email,full_name,sector,role</code>. As colunas <code className="font-mono">sector</code> e <code className="font-mono">role</code> são opcionais. Emails duplicados são ignorados. As passwords geradas são devolvidas no relatório.
            </div>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-docid-border bg-docid-surface-low p-6 text-center text-sm text-docid-muted transition hover:border-docid-primary/50">
              <Upload className="h-6 w-6 text-docid-outline" />
              {fileName || "Escolher ficheiro CSV..."}
              <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
            </label>
            {csvText && <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setReport(null); }} className="docid-input h-28 w-full resize-none font-mono text-xs" />}
            <div className="flex items-center justify-between text-xs text-docid-muted">
              <span>{((csvText.match(/\n/g) || []).length)} linha(s) detectada(s)</span>
              <button type="button" onClick={downloadTemplate} className="flex items-center gap-1 text-docid-primary-soft hover:underline"><Download className="h-3 w-3" /> Baixar modelo</button>
            </div>
          </>
        )}
        {report && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-docid-surface-low p-3 text-center"><p className="text-2xl font-bold text-docid-success">{report.created.length}</p><p className="text-xs text-docid-muted">Criados</p></div>
              <div className="rounded-lg bg-docid-surface-low p-3 text-center"><p className="text-2xl font-bold text-docid-secondary">{report.skipped.length}</p><p className="text-xs text-docid-muted">Ignorados</p></div>
              <div className="rounded-lg bg-docid-surface-low p-3 text-center"><p className="text-2xl font-bold text-docid-error">{report.errors.length}</p><p className="text-xs text-docid-muted">Erros</p></div>
            </div>
            {report.created.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-docid-success"><CheckCircle2 className="h-3.5 w-3.5" /> Credenciais geradas — distribua aos utilizadores</p>
                <div className="max-h-40 overflow-auto rounded-lg border border-docid-border">
                  <table className="docid-table"><thead><tr><th>Email</th><th>Nome</th><th>Password</th></tr></thead><tbody>{report.created.map(u => <tr key={u.email}><td className="text-xs">{u.email}</td><td className="text-xs">{u.fullName}</td><td className="font-mono text-xs">{u.password}</td></tr>)}</tbody></table>
                </div>
              </div>
            )}
            {report.skipped.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-docid-secondary"><Ban className="h-3.5 w-3.5" /> Linhas ignoradas</p>
                <div className="max-h-28 overflow-auto rounded-lg border border-docid-border p-2 text-xs text-docid-muted">{report.skipped.map((s, i) => <p key={i} className="py-0.5">Linha {s.row}: {s.reason}</p>)}</div>
              </div>
            )}
            {report.errors.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-docid-error"><AlertTriangle className="h-3.5 w-3.5" /> Erros por linha</p>
                <div className="max-h-28 overflow-auto rounded-lg border border-docid-error/30 p-2 text-xs text-docid-error">{report.errors.map((s, i) => <p key={i} className="py-0.5">Linha {s.row}: {s.reason}</p>)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
