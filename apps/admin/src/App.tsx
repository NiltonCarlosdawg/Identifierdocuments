import { useEffect, useState, type FormEvent } from "react";
import { api, clearToken, friendlyError, getPlatformToken, getToken, setPlatformToken, setToken, type License, type Order, type Plan, type PlatformLicense, type PlatformLicensePatch, type Tenant } from "./api";

type Tab = "orders" | "plans" | "tenants" | "licenses" | "platform";

const friendly = (values: Record<string, string>, value: string) => values[value] ?? "—";
const PAYMENT_METHODS: Record<string, string> = { multicaixa: "Referência Multicaixa", transfer: "Transferência", send_order: "Enviar pedido" };
const ORDER_STATUSES: Record<string, string> = { pending: "Pendente", approved: "Aprovado", rejected: "Rejeitado" };
const TENANT_STATUSES: Record<string, string> = { free: "Gratuito", paid: "Pago", expired: "Expirado", suspended: "Suspenso" };
const LICENSE_STATES: Record<string, string> = { none: "Sem licença", trial: "Teste", active: "Activa", grace: "Em tolerância", read_only: "Só leitura", suspended: "Suspensa" };
const PLATFORM_STATES: Record<string, string> = { active: "Activa", grace: "Em tolerância", expired: "Expirada", suspended: "Suspensa" };

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const res = await api.login(email, password);
      setToken(res.token); onLogin();
    } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  };

  return (
    <main className="login-wrap">
      <form className="card login" onSubmit={submit} data-testid="provider-login-form">
        <h1>DocID</h1>
        <p>Painel da empresa provedora</p>
        <label>E-mail<input data-testid="provider-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Palavra-passe<input data-testid="provider-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <p className="error" data-testid="provider-error">{error}</p>}
        <button data-testid="provider-submit" disabled={busy}>{busy ? "A entrar..." : "Entrar"}</button>
      </form>
    </main>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const refresh = () => { setError(""); load().then(setData).catch(e => setError(friendlyError(e))); };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, deps);
  return { data, error, refresh };
}

function Orders() {
  const { data, error, refresh } = useLoad(api.orders, []);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const act = async (id: string, action: "approve" | "reject") => {
    setBusy(id);
    try {
      if (action === "approve") await api.approveOrder(id);
      else await api.rejectOrder(id, reason[id] || "Pedido recusado");
      refresh();
    } catch (e) { alert(friendlyError(e)); } finally { setBusy(""); }
  };
  return (
    <section data-testid="orders-panel">
      <h2>Pedidos de subscrição</h2>
      {error && <p className="error">{error}</p>}
      <table><thead><tr><th>Organização</th><th>Plano</th><th>Pagamento</th><th>Contacto</th><th>Estado</th><th></th></tr></thead>
        <tbody>{(data || []).map(o => (
          <tr key={o.id} data-testid="order-row">
            <td>{o.tenantName}</td><td>{o.planName}</td><td>{friendly(PAYMENT_METHODS, o.paymentMethod)}</td>
            <td>{o.contactEmail || o.phone || "—"}</td><td>{friendly(ORDER_STATUSES, o.status)}</td>
            <td>{o.status === "pending" && (
              <div className="row-actions">
                <button data-testid="order-approve" disabled={busy === o.id} onClick={() => act(o.id, "approve")}>Aprovar</button>
                <input placeholder="Motivo" value={reason[o.id] || ""} onChange={e => setReason(r => ({ ...r, [o.id]: e.target.value }))} />
                <button data-testid="order-reject" disabled={busy === o.id} onClick={() => act(o.id, "reject")}>Rejeitar</button>
              </div>
            )}</td>
          </tr>
        ))}</tbody></table>
    </section>
  );
}

function Plans() {
  const { data, error, refresh } = useLoad(api.plans, []);
  const [form, setForm] = useState({ name: "", price: 0, maxUsers: 5, monthlyOnlineIdentifiers: 100, offlineBudgetPerMachine: 100 });
  const [editing, setEditing] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.savePlan({ ...form, id: editing || undefined });
      setForm({ name: "", price: 0, maxUsers: 5, monthlyOnlineIdentifiers: 100, offlineBudgetPerMachine: 100 });
      setEditing(null); refresh();
    } catch (e) { alert(friendlyError(e)); }
  };
  return (
    <section data-testid="plans-panel">
      <h2>Planos</h2>
      {error && <p className="error">{error}</p>}
      <div className="card form-grid">
        <label>Nome<input data-testid="plan-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
        <label>Preço (Kz)<input data-testid="plan-price" type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) }))} /></label>
        <label>Utilizadores<input data-testid="plan-users" type="number" value={form.maxUsers} onChange={e => setForm(f => ({ ...f, maxUsers: Number(e.target.value) }))} /></label>
        <label>Identificadores/mês<input type="number" value={form.monthlyOnlineIdentifiers} onChange={e => setForm(f => ({ ...f, monthlyOnlineIdentifiers: Number(e.target.value) }))} /></label>
        <label>Offline por máquina<input type="number" value={form.offlineBudgetPerMachine} onChange={e => setForm(f => ({ ...f, offlineBudgetPerMachine: Number(e.target.value) }))} /></label>
        <button data-testid="plan-save" onClick={save} disabled={!form.name}>{editing ? "Guardar" : "Criar plano"}</button>
      </div>
      <table><thead><tr><th>Plano</th><th>Preço</th><th>Utilizadores</th><th>Activo</th><th></th></tr></thead>
        <tbody>{(data?.plans || []).map((p: Plan) => (
          <tr key={p.id} data-testid="plan-row">
            <td>{p.name}</td><td>{p.price}</td><td>{p.maxUsers}</td><td>{p.active ? "sim" : "não"}</td>
            <td>{!p.isFree && <button onClick={() => { setEditing(p.id); setForm({ name: p.name, price: p.price, maxUsers: p.maxUsers, monthlyOnlineIdentifiers: p.monthlyOnlineIdentifiers, offlineBudgetPerMachine: p.offlineBudgetPerMachine }); }}>Editar</button>}</td>
          </tr>
        ))}</tbody></table>
    </section>
  );
}

function Tenants() {
  const { data, error, refresh } = useLoad(api.tenants, []);
  const act = async (id: string, action: "suspend" | "reactivate") => {
    try { await api.setTenantStatus(id, action); refresh(); } catch (e) { alert(friendlyError(e)); }
  };
  return (
    <section data-testid="tenants-panel">
      <h2>Organizações</h2>
      {error && <p className="error">{error}</p>}
      <table><thead><tr><th>Organização</th><th>Plano</th><th>Estado</th><th>Utilizadores</th><th>Validade</th><th></th></tr></thead>
        <tbody>{(data || []).map((t: Tenant) => (
          <tr key={t.id} data-testid="tenant-row">
            <td>{t.name}<small>Endereço: {t.slug}</small></td><td>{t.planName}</td><td>{friendly(TENANT_STATUSES, t.status)}</td><td>{t.userCount}</td>
            <td>{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString("pt-AO") : "—"}</td>
            <td>{t.status === "suspended"
              ? <button onClick={() => act(t.id, "reactivate")}>Reactivar</button>
              : <button onClick={() => act(t.id, "suspend")}>Suspender</button>}</td>
          </tr>
        ))}</tbody></table>
    </section>
  );
}

function Licenses() {
  const { data, error, refresh } = useLoad(api.licenses, []);
  const [days, setDays] = useState<Record<string, string>>({});
  const act = async (n: string, patch: Record<string, unknown>) => {
    try { await api.updateLicense(n, patch); refresh(); } catch (e) { alert(friendlyError(e)); }
  };
  return (
    <section data-testid="licenses-panel">
      <h2>Licenças</h2>
      {error && <p className="error">{error}</p>}
      <table><thead><tr><th>Organização</th><th>Número</th><th>Estado</th><th>Validade</th><th>Utilizadores</th><th></th></tr></thead>
        <tbody>{(data || []).map((l: License) => (
          <tr key={l.tenantId} data-testid="license-row">
            <td>{l.tenantName}</td><td className="mono">{l.licenseNumber || "—"}</td><td>{friendly(LICENSE_STATES, l.state)}</td>
            <td>{l.validUntil ? new Date(l.validUntil).toLocaleDateString("pt-AO") : "Sem prazo"}</td>
            <td>{l.activeUsers}{l.maxUsers ? ` / ${l.maxUsers}` : ""}</td>
            <td className="row-actions">
              <input placeholder="Dias" type="number" value={days[l.licenseNumber || ""] || ""} onChange={e => setDays(d => ({ ...d, [l.licenseNumber || ""]: e.target.value }))} />
              <button data-testid="license-extend" onClick={() => act(l.licenseNumber!, { extendDays: Number(days[l.licenseNumber || ""] || 365) })}>Renovar</button>
              <button data-testid="license-suspend" onClick={() => act(l.licenseNumber!, { status: "suspended" })}>Suspender</button>
              <button onClick={() => act(l.licenseNumber!, { status: "active" })}>Activar</button>
            </td>
          </tr>
        ))}</tbody></table>
    </section>
  );
}

function Platform() {
  const [token, setToken] = useState(getPlatformToken() || "");
  const [lookup, setLookup] = useState("");
  const [rows, setRows] = useState<PlatformLicense[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = async () => {
    if (!token) return;
    setError("");
    try { setRows((await api.platformLicenses(token)).data); }
    catch (e) { setError(friendlyError(e)); }
  };

  // Carrega apenas se já houver token guardado; nunca dispara pedido com token vazio.
  useEffect(() => { if (token) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = () => { setPlatformToken(token); load(); };

  const find = async () => {
    if (!token || !lookup.trim()) return;
    setError("");
    try { setRows([(await api.platformLicense(token, lookup.trim())).data]); }
    catch (e) { setError(friendlyError(e)); }
  };

  const act = async (n: string, patch: PlatformLicensePatch) => {
    if (!token) return;
    setBusy(n); setError("");
    try { await api.updatePlatformLicense(token, n, patch); await load(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(""); }
  };

  return (
    <section data-testid="platform-panel">
      <h2>Plataforma · Licenças</h2>
      {error && <p className="error">{error}</p>}
      <div className="card form-grid">
        <label>Chave de acesso da plataforma<input data-testid="platform-token" type="password" value={token} onChange={e => setToken(e.target.value)} /></label>
        <button data-testid="platform-save" onClick={save} disabled={!token}>Guardar chave</button>
        <label>Consultar licença<input data-testid="platform-lookup" value={lookup} onChange={e => setLookup(e.target.value)} placeholder="DOCID-..." /></label>
        <button data-testid="platform-find" onClick={find} disabled={!token || !lookup.trim()}>Consultar</button>
      </div>
      <table data-testid="platform-list"><thead><tr><th>Organização</th><th>Número</th><th>Estado</th><th>Validade</th><th>Dias</th><th>Utilizadores</th><th></th></tr></thead>
        <tbody>{(rows || []).map((l: PlatformLicense) => (
          <tr key={l.organizationId} data-testid="platform-row">
            <td>{l.name}<small>Endereço: {l.slug}</small></td><td className="mono">{l.licenseNumber}</td><td>{friendly(PLATFORM_STATES, l.state)}</td>
            <td>{l.validUntil ? new Date(l.validUntil).toLocaleDateString("pt-AO") : "Sem prazo"}</td>
            <td>{l.daysLeft ?? "—"}</td>
            <td>{l.activeUsers}{l.maxUsers ? ` / ${l.maxUsers}` : ""}</td>
            <td className="row-actions">
              <button data-testid="platform-renew" disabled={!token || busy === l.licenseNumber} onClick={() => act(l.licenseNumber, { extendDays: 365 })}>Renovar</button>
              <button data-testid="platform-suspend" disabled={!token || busy === l.licenseNumber} onClick={() => act(l.licenseNumber, { status: "suspended" })}>Suspender</button>
              <button disabled={!token || busy === l.licenseNumber} onClick={() => act(l.licenseNumber, { status: "active" })}>Reactivar</button>
            </td>
          </tr>
        ))}</tbody></table>
    </section>
  );
}

export default function App() {
  const [token, setTokenState] = useState(getToken());
  const [tab, setTab] = useState<Tab>("orders");
  if (!token) return <Login onLogin={() => setTokenState(getToken())} />;

  const tabs: Array<[Tab, string]> = [["orders", "Pedidos"], ["plans", "Planos"], ["tenants", "Organizações"], ["licenses", "Licenças"], ["platform", "Plataforma"]];
  return (
    <div className="shell">
      <header>
        <div><h1>DocID · Provedora</h1><p>Gestão de pedidos, planos e licenças</p></div>
        <button onClick={() => { clearToken(); setTokenState(null); }}>Sair</button>
      </header>
      <nav>{tabs.map(([key, label]) => <button key={key} data-testid={`tab-${key}`} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
      <main>
        {tab === "orders" && <Orders />}
        {tab === "plans" && <Plans />}
        {tab === "tenants" && <Tenants />}
        {tab === "licenses" && <Licenses />}
        {tab === "platform" && <Platform />}
      </main>
    </div>
  );
}
