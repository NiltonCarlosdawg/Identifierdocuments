import { useState, useEffect, useCallback } from "react";
import { useAppConfigStore } from "../stores/configStore";
import { useWatcherStore } from "../stores/watcherStore";
import { PageHeader } from "../components/docid-ui";
import { sync, api } from "../../infrastructure/di/container";
import { Server, Sun, Moon, Save, RotateCcw, FolderPlus, Trash2, Play, Square, Eye, RefreshCw, Building2, Bell, Download, Smartphone, AlertTriangle } from "lucide-react";

export default function Settings() {
  const [tab, setTab] = useState<"server" | "appearance" | "watcher" | "organizacao" | "notificacoes" | "dispositivos">("server");

  return (
    <div>
      <PageHeader title="Configurações" description="Gerir definições do servidor e preferências da aplicação" />
      <div className="mb-4 flex gap-2 flex-wrap">
        <TabBtn active={tab === "server"} onClick={() => setTab("server")}>Servidor</TabBtn>
        <TabBtn active={tab === "appearance"} onClick={() => setTab("appearance")}>Aparência</TabBtn>
        <TabBtn active={tab === "watcher"} onClick={() => setTab("watcher")}>Pastas Vigiladas</TabBtn>
        <TabBtn active={tab === "organizacao"} onClick={() => setTab("organizacao")}><Building2 className="h-4 w-4" /> Organização</TabBtn>
        <TabBtn active={tab === "dispositivos"} onClick={() => setTab("dispositivos")}><Smartphone className="h-4 w-4" /> Dispositivos</TabBtn>
        <TabBtn active={tab === "notificacoes"} onClick={() => setTab("notificacoes")}><Bell className="h-4 w-4" /> Notificações</TabBtn>
      </div>
      {tab === "server" ? <ServerTab /> : tab === "appearance" ? <AppearanceTab /> : tab === "watcher" ? <WatcherTab /> : tab === "organizacao" ? <OrganizationTab /> : tab === "dispositivos" ? <DevicesTab /> : <NotificationsTab />}
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
  const [org, setOrg] = useState<{ name: string; slug: string; identifierPrefix: string; plan: string; identifierLeaseBatchSize: number | null } | null>(null);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [batchSize, setBatchSize] = useState(50);
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
        const res = await api.get<{ data: { name: string; slug: string; identifierPrefix: string; plan: string; identifierLeaseBatchSize: number | null } }>("/tenants/me");
        setOrg(res.data);
        setName(res.data.name);
        setPrefix(res.data.identifierPrefix);
        setBatchSize(res.data.identifierLeaseBatchSize ?? 50);
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
      const res = await api.patch<{ data: { name: string; identifierPrefix: string; identifierLeaseBatchSize: number } }>("/tenants/me", {
        name,
        identifierPrefix: prefix,
        identifierLeaseBatchSize: batchSize,
      });
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
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Tamanho do lote de identificadores</label>
          <div className="flex items-center gap-3">
            <input type="number" value={batchSize} onChange={e => setBatchSize(Math.max(10, Math.min(500, parseInt(e.target.value) || 50)))} min={10} max={500} className="docid-input w-32 font-mono" />
            <span className="text-xs text-docid-muted">(10–500) Números reservados por lease em cada dispositivo</span>
          </div>
          <p className="mt-1 text-xs text-docid-muted">Valores mais altos reduzem a frequência de renovações mas aumentam o desperdício se o dispositivo for perdido.</p>
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

interface LeaseRow {
  id: string;
  category_id: string;
  device_id: string;
  sector_id: string;
  start_seq: number;
  end_seq: number;
  next_to_use: number;
  status: string;
  created_at: string;
}

function DevicesTab() {
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [releasing, setReleasing] = useState<string | null>(null);
  const [isTauri] = useState(() => sync.isAvailable());

  const loadLeases = useCallback(async () => {
    if (!isTauri) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<LeaseRow[]>("get_leases");
      setLeases(result);
    } catch (e: any) {
      setError(e.message || "Erro ao carregar leases.");
    } finally {
      setLoading(false);
    }
  }, [isTauri]);

  useEffect(() => { loadLeases(); }, [loadLeases]);

  const calcUsage = (lease: LeaseRow) => {
    const total = lease.end_seq - lease.start_seq + 1;
    const used = Math.min(lease.next_to_use - lease.start_seq, total);
    return { used, total, pct: total > 0 ? Math.round(used / total * 100) : 0 };
  };

  const handleForceRelease = async (lease: LeaseRow) => {
    if (!confirm(`Tem a certeza? Esta acção é irreversível.\n\nLease: ${lease.id}\nCategoria: ${lease.category_id}\nSector: ${lease.sector_id}\nIntervalo: ${lease.start_seq}–${lease.end_seq}\n\nOs identificadores pendentes associados a este lease serão marcados como conflito.`)) return;

    setReleasing(lease.id);
    setError("");
    try {
      await api.post("/identifiers/force-release", { leaseId: lease.id });

      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("mark_lease_remote_released", { leaseId: lease.id });
      }

      await loadLeases();
    } catch (e: any) {
      setError(e.message || "Erro ao forçar libertação.");
    } finally {
      setReleasing(null);
    }
  };

  if (!isTauri) {
    return (
      <div className="docid-panel p-6 max-w-xl">
        <div className="flex items-center gap-3 text-sm text-docid-muted">
          <Smartphone className="h-5 w-5" /> Gestão de dispositivos disponível apenas na aplicação desktop.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}

      <div className="docid-panel p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-docid-text">Leases Locais</h3>
          <button onClick={loadLeases} className="docid-button-secondary text-xs" disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-docid-muted">A carregar...</div>
        ) : leases.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Smartphone className="h-8 w-8 text-docid-outline" />
            <p className="text-sm text-docid-muted">Nenhum lease encontrado neste dispositivo.</p>
            <p className="text-xs text-docid-muted">Os leases são criados automaticamente ao gerar identificadores offline para categorias fiscais.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {leases.map(lease => {
              const usage = calcUsage(lease);
              return (
                <div key={lease.id} className="rounded-lg border border-docid-border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono text-docid-text break-all">{lease.id}</p>
                      <p className="mt-1 text-sm font-medium">{lease.category_id} · Sector {lease.sector_id}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      lease.status === "active" ? "bg-emerald-500/15 text-emerald-500" :
                      lease.status === "exhausted" ? "bg-docid-muted/15 text-docid-muted" :
                      lease.status === "remote_released" ? "bg-amber-500/15 text-amber-500" :
                      "bg-docid-muted/10 text-docid-muted"
                    }`}>
                      {lease.status === "active" ? "Activo" : lease.status === "exhausted" ? "Esgotado" : lease.status === "remote_released" ? "Libertado" : lease.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div><span className="text-docid-muted">Intervalo</span><p className="font-mono font-medium">{lease.start_seq} – {lease.end_seq}</p></div>
                    <div><span className="text-docid-muted">Usados</span><p className="font-mono font-medium">{usage.used} / {usage.total}</p></div>
                    <div><span className="text-docid-muted">Criado em</span><p className="font-medium">{new Date(lease.created_at).toLocaleDateString("pt-AO")}</p></div>
                  </div>
                  <div className="h-2 rounded-full bg-docid-surface-high overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${
                      lease.status !== "active" ? "bg-docid-muted/30" :
                      usage.pct >= 80 ? "bg-amber-500" :
                      usage.pct >= 50 ? "bg-docid-primary-soft" :
                      "bg-emerald-500"
                    }`} style={{ width: `${Math.min(usage.pct, 100)}%` }} />
                  </div>
                  {lease.status === "active" && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleForceRelease(lease)}
                        disabled={releasing === lease.id}
                        className="docid-button-secondary text-xs text-docid-error border-docid-error/30 hover:bg-docid-error/10"
                      >
                        {releasing === lease.id ? "A libertar..." : "Forçar libertação"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
          <div className="text-xs text-docid-muted">
            <p className="font-medium text-amber-500 mb-1">Forçar libertação de um lease</p>
            <p>Usado quando um dispositivo foi perdido ou nunca mais será reconectado. Liberta os números não usados de volta ao pool da organização, permitindo que outros dispositivos os reutilizem.</p>
            <p className="mt-1">Os identificadores pendentes associados a este lease serão marcados como conflito e precisarão de resolução manual.</p>
            <p className="mt-1"><strong>Esta acção é irreversível.</strong></p>
          </div>
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
      if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) return;
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
