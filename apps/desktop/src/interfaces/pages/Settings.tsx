import { useState, useEffect } from "react";
import { useAppConfigStore } from "../stores/configStore";
import { useWatcherStore } from "../stores/watcherStore";
import { PageHeader } from "../components/docid-ui";
import { api } from "../../infrastructure/di/container";
import { Server, Sun, Moon, Save, RotateCcw, FolderPlus, Trash2, Play, Square, Eye, RefreshCw, Building2, Bell, Download } from "lucide-react";

export default function Settings() {
  const [tab, setTab] = useState<"server" | "appearance" | "watcher" | "organizacao" | "notificacoes">("server");

  return (
    <div>
      <PageHeader title="Configurações" description="Gerir definições do servidor e preferências da aplicação" />
      <div className="mb-4 flex gap-2 flex-wrap">
        <TabBtn active={tab === "server"} onClick={() => setTab("server")}>Servidor</TabBtn>
        <TabBtn active={tab === "appearance"} onClick={() => setTab("appearance")}>Aparência</TabBtn>
        <TabBtn active={tab === "watcher"} onClick={() => setTab("watcher")}>Pastas Vigiladas</TabBtn>
        <TabBtn active={tab === "organizacao"} onClick={() => setTab("organizacao")}><Building2 className="h-4 w-4" /> Organização</TabBtn>
        <TabBtn active={tab === "notificacoes"} onClick={() => setTab("notificacoes")}><Bell className="h-4 w-4" /> Notificações</TabBtn>
      </div>
      {tab === "server" ? <ServerTab /> : tab === "appearance" ? <AppearanceTab /> : tab === "watcher" ? <WatcherTab /> : tab === "organizacao" ? <OrganizationTab /> : <NotificationsTab />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${active ? "bg-docid-primary text-white" : "border border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>
      {children}
    </button>
  );
}

function ServerTab() {
  const apiBaseUrl = useAppConfigStore(s => s.apiBaseUrl);
  const setApiBaseUrl = useAppConfigStore(s => s.setApiBaseUrl);
  const resetApiBaseUrl = useAppConfigStore(s => s.resetApiBaseUrl);
  const [input, setInput] = useState(apiBaseUrl);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  const handleSave = () => {
    setSaveError("");
    setApiBaseUrl(input);
    const actualUrl = useAppConfigStore.getState().apiBaseUrl;
    if (actualUrl === input) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setSaveError("HTTP só é permitido para localhost — use HTTPS para servidores remotos.");
    }
  };

  const isValid = (() => {
    const trimmed = input.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("https://") && trimmed.length > 8) return true;
    if (trimmed.startsWith("http://")) {
      const host = trimmed.replace("http://", "").split("/")[0].split(":")[0];
      return host === "localhost" || host === "127.0.0.1";
    }
    return false;
  })();

  return (
    <div className="docid-panel p-6 max-w-xl space-y-5">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-docid-muted">URL da API</label>
        <input value={input} onChange={e => setInput(e.target.value)} className="docid-input w-full font-mono text-sm" placeholder="http://localhost:3000" />
        {saveError && <p className="mt-1 text-xs text-docid-error">{saveError}</p>}
        <p className="mt-1 text-xs text-docid-muted">URL actual: <span className="font-mono text-docid-text">{apiBaseUrl}</span></p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={!isValid || input === apiBaseUrl} className="docid-button-primary"><Save className="h-4 w-4" /> Guardar</button>
        <button onClick={() => { resetApiBaseUrl(); setInput(useAppConfigStore.getState().apiBaseUrl); }} className="docid-button-secondary"><RotateCcw className="h-4 w-4" /> Restaurar predefinição</button>
        {saved && <span className="text-sm text-docid-secondary">Guardado!</span>}
      </div>
    </div>
  );
}

function AppearanceTab() {
  const theme = useAppConfigStore(s => s.theme);
  const setTheme = useAppConfigStore(s => s.setTheme);
  const isDark = theme === "dark";

  return (
    <div className="docid-panel p-6 max-w-xl space-y-5">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Tema</label>
        <div className="flex gap-3">
          <button onClick={() => setTheme("light")} className={`flex flex-1 items-center gap-3 rounded-lg border p-4 text-sm font-medium transition ${!isDark ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>
            <Sun className="h-5 w-5" /> Claro
          </button>
          <button onClick={() => setTheme("dark")} className={`flex flex-1 items-center gap-3 rounded-lg border p-4 text-sm font-medium transition ${isDark ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>
            <Moon className="h-5 w-5" /> Escuro
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-docid-border bg-docid-surface-low p-4">
        <p className="text-xs text-docid-muted mb-2">Pré-visualização</p>
        <div className={`rounded-lg border p-4 ${isDark ? "border-[#434655] bg-[#1e1f26] text-[#e2e2eb]" : "border-[#ced4da] bg-white text-[#212529]"}`}>
          <p className="text-sm font-semibold">Texto de exemplo</p>
          <p className={`mt-1 text-xs ${isDark ? "text-[#c3c6d7]" : "text-[#6c757d]"}`}>Este é um preview do tema {isDark ? "escuro" : "claro"}.</p>
        </div>
      </div>
    </div>
  );
}

function OrganizationTab() {
  const [org, setOrg] = useState<{ name: string; slug: string; identifierPrefix: string; plan: string } | null>(null);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [exportingAudit, setExportingAudit] = useState(false);
  const [exportingStats, setExportingStats] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ data: { name: string; slug: string; identifierPrefix: string; plan: string } }>("/tenants/me");
        setOrg(res.data);
        setName(res.data.name);
        setPrefix(res.data.identifierPrefix);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await api.patch<{ data: { name: string; identifierPrefix: string } }>("/tenants/me", { name, identifierPrefix: prefix });
      setOrg(o => o ? { ...o, ...res.data } : null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async (type: "audit" | "stats") => {
    const setter = type === "audit" ? setExportingAudit : setExportingStats;
    const path = type === "audit" ? "/audit/export?format=csv" : "/stats/export?format=json";
    const filename = type === "audit" ? `audit-export-${Date.now()}.csv` : `stats-export-${Date.now()}.json`;
    setter(true);
    setExportError("");
    try {
      const blob = await api.getBlob(path);
      if (blob) downloadBlob(blob, filename);
    } catch (e: any) {
      setExportError(e.message === "Erro 429" ? "Limite de exportações excedido (5/hora). Tente novamente dentro de 1 hora." : e.message);
    } finally {
      setter(false);
    }
  };

  if (loading) return <div className="docid-panel p-6 max-w-xl"><div className="text-sm text-docid-muted">A carregar...</div></div>;

  return (
    <div className="space-y-6 max-w-xl">
      <div className="docid-panel p-6 space-y-5">
        <h3 className="text-sm font-semibold text-docid-text">Dados da Organização</h3>
        {error && <p className="text-xs text-docid-error">{error}</p>}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nome</label>
          <input value={name} onChange={e => setName(e.target.value)} className="docid-input w-full" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Prefixo do Identificador</label>
          <input value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} className="docid-input w-full font-mono" maxLength={6} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Slug</label>
          <input value={org?.slug ?? ""} readOnly className="docid-input w-full font-mono bg-docid-surface-low text-docid-muted cursor-not-allowed" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Plano</label>
          <input value={org?.plan ?? ""} readOnly className="docid-input w-full bg-docid-surface-low text-docid-muted cursor-not-allowed" />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving || !name.trim()} className="docid-button-primary"><Save className="h-4 w-4" /> {saving ? "A guardar..." : "Guardar"}</button>
          {saved && <span className="text-sm text-docid-secondary">Guardado!</span>}
        </div>
      </div>

      <div className="docid-panel p-6 space-y-4">
        <h3 className="text-sm font-semibold text-docid-text">Exportar Dados</h3>
        {exportError && <p className="text-xs text-docid-error">{exportError}</p>}
        <p className="text-xs text-docid-muted">Limite de 5 exportações por hora.</p>
        <div className="flex gap-3 flex-wrap">
          <button onClick={() => handleExport("audit")} disabled={exportingAudit} className="docid-button-secondary"><Download className="h-4 w-4" /> {exportingAudit ? "A exportar..." : "Exportar auditoria (CSV)"}</button>
          <button onClick={() => handleExport("stats")} disabled={exportingStats} className="docid-button-secondary"><Download className="h-4 w-4" /> {exportingStats ? "A exportar..." : "Exportar estatísticas (JSON)"}</button>
        </div>
      </div>
    </div>
  );
}

function NotificationsTab() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ notificationPreferences?: Record<string, boolean> }>("/auth/me");
        setPrefs(res.notificationPreferences ?? {});
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleToggle = async (key: string) => {
    const newVal = !prefs[key];
    setPrefs(p => ({ ...p, [key]: newVal }));
    setSaving(key);
    try {
      await api.patch("/auth/me/notifications-preferences", { [key]: newVal });
    } catch {
      setPrefs(p => ({ ...p, [key]: !newVal }));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="docid-panel p-6 max-w-xl"><div className="text-sm text-docid-muted">A carregar...</div></div>;

  const items = [
    { key: "approval_pending", label: "Aprovação pendente", desc: "Quando um documento necessita da sua aprovação" },
    { key: "approval_resolved", label: "Aprovação resolvida", desc: "Quando uma aprovação foi concedida ou rejeitada" },
    { key: "document_shared", label: "Documento partilhado", desc: "Quando um documento é partilhado consigo ou com o seu sector" },
    { key: "sync_complete", label: "Sync completo", desc: "Quando uma sincronização de ficheiros é concluída" },
    { key: "watcher_detected", label: "Ficheiro detectado pelo watcher", desc: "Quando um novo ficheiro é detectado na pasta vigiada" },
  ];

  return (
    <div className="docid-panel p-6 max-w-xl space-y-5">
      <h3 className="text-sm font-semibold text-docid-text">Preferências de Notificação</h3>
      <p className="text-xs text-docid-muted">Seleccione para que eventos pretende ser notificado.</p>
      {error && <p className="text-xs text-docid-error">{error}</p>}
      {items.map(({ key, label, desc }) => (
        <label key={key} className="flex items-center justify-between gap-4 rounded-lg border border-docid-border p-4 hover:bg-docid-surface-high cursor-pointer">
          <div>
            <p className="text-sm font-medium text-docid-text">{label}</p>
            <p className="text-xs text-docid-muted">{desc}</p>
          </div>
          <input type="checkbox" checked={!!prefs[key]} onChange={() => handleToggle(key)} disabled={saving === key} className="rounded border-docid-border bg-docid-surface-low text-docid-primary focus:ring-docid-primary" />
        </label>
      ))}
    </div>
  );
}

function WatcherTab() {
  const { folders, running, loading, error, detectedCount, loadFolders, addFolder, removeFolder, start, stop, bumpDetected, clearDetected } = useWatcherStore();

  useEffect(() => { loadFolders(); }, [loadFolders]);

  useEffect(() => {
    let unlisteners: (() => void)[] = [];
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const f1 = await listen("watcher:file_detected", () => bumpDetected());
      const f2 = await listen("watcher:identifier_found", () => bumpDetected());
      unlisteners = [f1, f2];
    })();
    return () => unlisteners.forEach(f => f());
  }, [bumpDetected]);

  const handleAddFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Seleccionar pasta para vigiar" });
      if (selected) await addFolder(selected);
    } catch {}
  };

  return (
    <div className="space-y-6 max-w-xl">
      {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      <div className="flex items-center gap-3">
        {running ? (
          <button onClick={stop} className="docid-button-secondary"><Square className="h-4 w-4" /> Parar</button>
        ) : (
          <button onClick={start} disabled={folders.length === 0} className="docid-button-primary"><Play className="h-4 w-4" /> Iniciar</button>
        )}
        <button onClick={handleAddFolder} className="docid-button-secondary"><FolderPlus className="h-4 w-4" /> Adicionar pasta</button>
        <button onClick={loadFolders} className="docid-button-secondary"><RefreshCw className="h-4 w-4" /></button>
        {detectedCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-docid-primary/15 px-3 py-1 text-xs font-medium text-docid-primary-soft">
            <Eye className="h-3 w-3" /> {detectedCount} detectado(s)
          </span>
        )}
      </div>
      <div className="docid-panel overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-docid-muted">A carregar...</div>
        ) : folders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <FolderPlus className="h-8 w-8 text-docid-outline" />
            <p className="text-sm text-docid-muted">Nenhuma pasta a ser vigiada.</p>
            <button onClick={handleAddFolder} className="docid-button-secondary text-xs"><FolderPlus className="h-3 w-3" /> Adicionar pasta</button>
          </div>
        ) : (
          <ul className="divide-y divide-docid-border">
            {folders.map(f => (
              <li key={f} className="flex items-center justify-between px-4 py-3">
                <span className="truncate text-sm font-mono text-docid-text" title={f}>{f}</span>
                <button onClick={() => removeFolder(f)} className="shrink-0 rounded p-1.5 text-docid-muted hover:bg-docid-surface-high hover:text-docid-error"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-docid-muted">Os ficheiros detectados podem ser anexados a identificadores na página Documentos.</p>
    </div>
  );
}
