import { useEffect, useState } from "react";
import { api } from "../services/api";
import { syncService } from "../services/sync";
import { useAuthStore } from "../stores/auth";
import { useAppConfigStore } from "../stores/config";
import { Bell, Building2, Mail, Moon, Save, Server, ShieldAlert, Sun, Tag } from "lucide-react";
import { PageHeader, StatusChip } from "../components/docid-ui";

type Tab = "org" | "ident" | "notif" | "server" | "appearance";

export default function Settings() {
  const user = useAuthStore((s) => s.user);
  const { apiBaseUrl, setApiBaseUrl, theme, setTheme } = useAppConfigStore();
  const [tab, setTab] = useState<Tab>("org");
  const [org, setOrg] = useState({ name: "", identifierPrefix: "VL", taxId: "", industry: "", address: "" });
  const [serverUrl, setServerUrl] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [toggles, setToggles] = useState({ shared: true, approvals: true, offline: false });

  useEffect(() => {
    api.get<any>("/tenants/me").then((res) => {
      if (res.data) setOrg((current) => ({ ...current, name: res.data.name, identifierPrefix: res.data.identifierPrefix || "VL" }));
    }).catch(() => {});
    setServerUrl(apiBaseUrl);
  }, [apiBaseUrl]);

  const saveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSaved("");
    try {
      await api.patch("/tenants/me", { name: org.name, identifierPrefix: org.identifierPrefix });
      setSaved("Organização actualizada.");
    } catch (err: any) { setError(err.message); }
  };

  const saveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSaved("");
    const url = serverUrl.trim().replace(/\/$/, "");
    if (!url) { setError("URL do servidor é obrigatória."); return; }
    try {
      const res = await fetch(`${url}/`, { method: "GET" });
      if (!res.ok) throw new Error("Não foi possível conectar ao servidor.");
      setApiBaseUrl(url);
      if (syncService.isAvailable()) {
        const token = useAuthStore.getState().token;
        await syncService.setApiBaseUrl(url);
        if (token) await syncService.setCredentials(token, url);
      }
      setSaved("Servidor actualizado. A aplicação vai usar este endereço.");
    } catch (err: any) {
      setError(err.message || "Não foi possível conectar ao servidor.");
    }
  };

  const tabs: Array<[Tab, string]> = [["org", "Organização"], ["ident", "Identificadores"], ["notif", "Notificações"], ["server", "Servidor"], ["appearance", "Aparência"]];

  return (
    <div>
      <PageHeader
        title="Configurações da Organização"
        description="Administração institucional, padrões de identificadores e notificações globais."
        actions={<StatusChip tone="warning">Acesso Restrito</StatusChip>}
      />

      <div className="mb-6 flex gap-6 border-b border-docid-border">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`border-b-2 pb-4 text-sm font-semibold transition ${tab === id ? "border-docid-primary text-docid-primary-soft" : "border-transparent text-docid-muted hover:text-docid-text"}`}>
            {label}
          </button>
        ))}
      </div>

      {saved && <div className="mb-4 rounded-lg border border-docid-secondary/30 bg-docid-secondary/10 p-3 text-sm text-docid-secondary">{saved}</div>}
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}

      {tab === "org" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <form onSubmit={saveOrg} className="docid-panel p-6">
            <h2 className="mb-6 text-lg font-semibold">Perfil Institucional</h2>
            <div className="grid gap-5 md:grid-cols-2">
              <label>
                <span className="mb-2 block text-xs uppercase tracking-wider text-docid-muted">Nome da Organização</span>
                <input className="docid-input w-full" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} required />
              </label>
              <label>
                <span className="mb-2 block text-xs uppercase tracking-wider text-docid-muted">NIF / Número de Contribuinte</span>
                <input className="docid-input w-full" value={org.taxId} onChange={(e) => setOrg({ ...org, taxId: e.target.value })} />
              </label>
              <label>
                <span className="mb-2 block text-xs uppercase tracking-wider text-docid-muted">Sector de Actividade</span>
                <select className="docid-input w-full" value={org.industry} onChange={(e) => setOrg({ ...org, industry: e.target.value })}>
                  <option>Logística e Cadeia de Abastecimento</option>
                  <option>Tecnologia e Software</option>
                  <option>Serviços Financeiros</option>
                  <option>Saúde e Farmacêutica</option>
                </select>
              </label>
              <label>
                <span className="mb-2 block text-xs uppercase tracking-wider text-docid-muted">Morada / Localização Central</span>
                <input className="docid-input w-full" value={org.address} onChange={(e) => setOrg({ ...org, address: e.target.value })} placeholder="Av. Comandante Gika, Luanda" />
              </label>
            </div>
            <button type="submit" className="docid-button-primary mt-6"><Save className="h-4 w-4" /> Guardar Alterações</button>
          </form>

          <aside className="space-y-4">
            <div className="docid-panel p-5">
              <Building2 className="mb-3 h-5 w-5 text-docid-primary-soft" />
              <h3 className="font-semibold">Sede Fiscal</h3>
              <p className="mt-2 text-sm text-docid-muted">{org.address || "Localização central não definida."}</p>
            </div>
            <div className="docid-panel p-5">
              <ShieldAlert className="mb-3 h-5 w-5 text-docid-tertiary" />
              <h3 className="font-semibold">Segurança da Conta</h3>
              <p className="mt-2 text-sm leading-6 text-docid-muted">Estas alterações afetam todos os utilizadores da organização e são registadas no log de auditoria.</p>
            </div>
          </aside>
        </div>
      )}

      {tab === "ident" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <section className="docid-panel p-6">
            <h2 className="mb-6 text-lg font-semibold">Padrão de Identificadores</h2>
            <label>
              <span className="mb-2 block text-xs uppercase tracking-wider text-docid-muted">Prefixo Global da Organização</span>
              <input className="docid-input w-full max-w-xs font-mono text-lg uppercase text-docid-primary-soft" maxLength={5} value={org.identifierPrefix} onChange={(e) => setOrg({ ...org, identifierPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
            </label>
            <div className="mt-5 rounded-lg border border-docid-tertiary/30 bg-docid-tertiary/10 p-3 text-sm text-docid-tertiary">Este prefixo não deve ser alterado depois de existir documentação emitida.</div>
            <div className="mt-6 docid-panel-low p-5">
              <p className="text-xs uppercase tracking-wider text-docid-muted">Previsão do próximo registo</p>
              <p className="mt-3 font-mono text-xl text-docid-primary-soft">{org.identifierPrefix || "VL"}-PROP-{new Date().getFullYear()}-XXXX-001</p>
            </div>
          </section>
          <section className="docid-panel p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Categorias de Documentos</h2>
              <button className="text-sm text-docid-primary-soft hover:underline">+ Nova Categoria</button>
            </div>
            {["Propostas Comerciais · 5 Years", "Non-Disclosure Agreements · 10 Years", "Memorandum of Understanding · Permanent", "Facturas de Fornecedores · 7 Years"].map((item) => (
              <div key={item} className="mb-3 rounded-lg border border-docid-border bg-docid-surface-lowest p-3 text-sm">
                <Tag className="mr-2 inline h-4 w-4 text-docid-primary-soft" />{item}
              </div>
            ))}
          </section>
        </div>
      )}

      {tab === "notif" && (
        <section className="docid-panel max-w-3xl p-6">
          <h2 className="mb-6 text-lg font-semibold">Configurações Globais de Notificação</h2>
          {[
            ["shared", "Documentos Partilhados", "Notificar administradores quando um documento é partilhado externamente."],
            ["approvals", "Resolução de Aprovações", "Notificar intervenientes quando uma cadeia de aprovação é concluída ou rejeitada."],
            ["offline", "Sincronização de Fila Offline", "Notificar quando operações offline forem sincronizadas com sucesso."],
          ].map(([key, title, text]) => (
            <label key={key} className="mb-4 flex cursor-pointer items-center justify-between rounded-xl border border-docid-border bg-docid-surface-lowest p-4">
              <span>
                <span className="block font-medium">{title}</span>
                <span className="text-sm text-docid-muted">{text}</span>
              </span>
              <input type="checkbox" checked={toggles[key as keyof typeof toggles]} onChange={(e) => setToggles({ ...toggles, [key]: e.target.checked })} className="h-5 w-5 rounded border-docid-border bg-docid-surface-low text-docid-primary focus:ring-docid-primary" />
            </label>
          ))}
          <div className="mt-6 rounded-xl border border-docid-border bg-docid-surface-lowest p-4">
            <Mail className="mr-2 inline h-4 w-4 text-docid-primary-soft" />
            <span className="text-sm text-docid-muted">Destinatário padrão do sistema: </span>
            <span className="font-mono text-docid-primary-soft">{user?.email || "—"}</span>
          </div>
        </section>
      )}

      {tab === "server" && (
        <form onSubmit={saveServer} className="docid-panel max-w-3xl p-6">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold"><Server className="h-5 w-5 text-docid-primary-soft" /> Configuração do servidor</h2>
          <p className="mb-5 text-sm text-docid-muted">Endereço da API DocID usado pelo app desktop.</p>
          <input type="url" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="http://localhost:3000" className="docid-input w-full font-mono" />
          <p className="mt-2 text-xs text-docid-muted">Valor actual: <span className="font-mono">{apiBaseUrl}</span></p>
          <button type="submit" className="docid-button-primary mt-5"><Save className="h-4 w-4" /> Testar e guardar</button>
        </form>
      )}

      {tab === "appearance" && (
        <div className="docid-panel max-w-3xl p-6">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-docid-text">Tema da aplicação</h2>
          <p className="mb-6 text-sm text-docid-muted">Escolha o tema de visualização do aplicativo.</p>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setTheme("light")}
              className={`docid-panel flex flex-col items-center gap-3 p-6 transition ${theme === "light" ? "ring-2 ring-docid-primary" : "hover:bg-docid-surface-low"}`}
            >
              <div className="h-16 w-full rounded-lg bg-white border border-gray-200 flex items-center justify-center">
                <div className="space-y-1.5">
                  <div className="h-2 w-16 rounded bg-gray-300" />
                  <div className="h-2 w-12 rounded bg-gray-200" />
                  <div className="h-2 w-14 rounded bg-gray-200" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium text-docid-text">Claro</span>
              </div>
              {theme === "light" && <div className="h-1.5 w-1.5 rounded-full bg-docid-primary" />}
            </button>

            <button
              onClick={() => setTheme("dark")}
              className={`docid-panel flex flex-col items-center gap-3 p-6 transition ${theme === "dark" ? "ring-2 ring-docid-primary" : "hover:bg-docid-surface-low"}`}
            >
              <div className="h-16 w-full rounded-lg bg-[#1e1f26] border border-[#434655] flex items-center justify-center">
                <div className="space-y-1.5">
                  <div className="h-2 w-16 rounded bg-[#434655]" />
                  <div className="h-2 w-12 rounded bg-[#2a2c34]" />
                  <div className="h-2 w-14 rounded bg-[#2a2c34]" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Moon className="h-4 w-4 text-docid-primary-soft" />
                <span className="text-sm font-medium text-docid-text">Escuro</span>
              </div>
              {theme === "dark" && <div className="h-1.5 w-1.5 rounded-full bg-docid-primary" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
