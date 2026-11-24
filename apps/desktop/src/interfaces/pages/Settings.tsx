import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useAppConfigStore } from "../stores/configStore";
import { useWatcherStore } from "../stores/watcherStore";
import { useScannerStore } from "../stores/scannerStore";
import { usePrinterStore } from "../stores/printerStore";
import { PageHeader, OfflineNotice } from "../components/docid-ui";
import { useOfflineCache } from "../hooks/useOfflineCache";
import { useCachedAux } from "../hooks/useCachedAux";
import { mapError, friendlyMessage, friendlyPlan, friendlyLicenseState, friendlySubscription, friendlyStatus } from "../../shared/errors/mapError";
import { sync, api } from "../../infrastructure/di/container";
import type { WatcherFileRow } from "../../domain/entities/Watcher";
import { Server, Sun, Moon, Save, RotateCcw, FolderPlus, Trash2, Play, Square, Eye, RefreshCw, Building2, Bell, Download, Smartphone, AlertTriangle, Printer, Mail } from "lucide-react";

export default function Settings() {
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.roles?.includes("ORG_ADMIN") ?? false;
  const [tab, setTab] = useState<"server" | "appearance" | "watcher" | "organizacao" | "notificacoes" | "dispositivos" | "email">(
    isAdmin ? "server" : "watcher"
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" description="Gerir definições do servidor e preferências da aplicação" />
      <div className="mb-4 flex gap-2 flex-wrap">
        {isAdmin && <TabBtn active={tab === "server"} onClick={() => setTab("server")}>Servidor</TabBtn>}
        {isAdmin && <TabBtn active={tab === "appearance"} onClick={() => setTab("appearance")}>Aparência</TabBtn>}
        <TabBtn active={tab === "watcher"} onClick={() => setTab("watcher")}>Pastas Vigiladas</TabBtn>
        {isAdmin && <TabBtn active={tab === "organizacao"} onClick={() => setTab("organizacao")}><Building2 className="h-4 w-4" /> Organização</TabBtn>}
        <TabBtn active={tab === "dispositivos"} onClick={() => setTab("dispositivos")}><Smartphone className="h-4 w-4" /> Dispositivos</TabBtn>
        {isAdmin && <TabBtn active={tab === "notificacoes"} onClick={() => setTab("notificacoes")}><Bell className="h-4 w-4" /> Notificações</TabBtn>}
        {isAdmin && <TabBtn active={tab === "email"} onClick={() => setTab("email")}><Mail className="h-4 w-4" /> E-mail</TabBtn>}
      </div>
      <div className="max-w-2xl">
        {tab === "server" ? <ServerTab /> : tab === "appearance" ? <AppearanceTab /> : tab === "watcher" ? <WatcherTab /> : tab === "organizacao" ? <OrganizationTab /> : tab === "dispositivos" ? <DevicesTab /> : tab === "email" ? <EmailTab /> : <NotificationsTab />}
      </div>
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
  const [updateMsg, setUpdateMsg] = useState("");
  const [updateError, setUpdateError] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const handleSave = () => {
    setSaveError("");
    setApiBaseUrl(input);
    const actualUrl = useAppConfigStore.getState().apiBaseUrl;
    if (actualUrl === input) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setSaveError("Só é possível ligar sem segurança a este computador. Para outros computadores, use uma ligação segura.");
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateMsg("");
    setUpdateError("");
    setCheckingUpdate(true);
    try {
      if (!sync.isAvailable()) {
        setUpdateError("As actualizações só estão disponíveis na aplicação instalada no computador.");
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const msg = await invoke<string>("check_for_updates");
      setUpdateMsg(msg);
      if (msg.includes("instalada")) {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      }
    } catch (err: unknown) {
      setUpdateError(mapError(err, "Não foi possível verificar actualizações."));
    } finally {
      setCheckingUpdate(false);
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
    <div className="docid-panel p-6 space-y-6">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Endereço do servidor</label>
        <input value={input} onChange={e => setInput(e.target.value)} className="docid-input w-full font-mono text-sm" placeholder="https://didall.milvendas.ao" />
        {saveError && <p className="mt-1 text-xs text-docid-error">{saveError}</p>}
        <p className="mt-1 text-xs text-docid-muted">Endereço actual: <span className="font-mono text-docid-text">{apiBaseUrl}</span></p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={!isValid || input === apiBaseUrl} className="docid-button-primary"><Save className="h-4 w-4" /> Guardar</button>
        <button onClick={() => { resetApiBaseUrl(); setInput(useAppConfigStore.getState().apiBaseUrl); }} className="docid-button-secondary"><RotateCcw className="h-4 w-4" /> Restaurar predefinição</button>
        {saved && <span className="text-sm text-docid-secondary">Guardado!</span>}
      </div>

      <div className="pt-6 space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Actualizações</label>
          <p className="text-xs text-docid-muted mb-3">Verifica se existe uma versão mais recente disponível.</p>
          <button onClick={handleCheckUpdate} disabled={checkingUpdate} className="docid-button-secondary">
            <Download className="h-4 w-4" /> {checkingUpdate ? "A verificar..." : "Procurar actualizações"}
          </button>
        </div>
        {updateMsg && <p className="text-sm text-docid-secondary">{updateMsg}</p>}
        {updateError && <p className="text-sm text-docid-error">{updateError}</p>}
      </div>
    </div>
  );
}

function AppearanceTab() {
  const theme = useAppConfigStore(s => s.theme);
  const setTheme = useAppConfigStore(s => s.setTheme);
  const isDark = theme === "dark";

  return (
    <div className="docid-panel p-6 space-y-6">
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

type LicenseView = {
  licenseNumber: string;
  plan: string;
  state: "active" | "grace" | "expired" | "suspended";
  canWrite: boolean;
  validUntil: string | null;
  graceUntil: string | null;
  daysLeft: number | null;
  maxUsers: number | null;
  activeUsers: number;
};

type OrgView = {
  name: string;
  slug: string;
  identifierPrefix: string;
  subscription: { status: string; planName: string; price: number; expiresAt: string | null };
  license?: LicenseView | null;
};

/** Snapshot legado de GET /tenants/me/license — mantido ao lado da licença moderna. */
type LegacyLicenseView = {
  licenseNumber: string | null;
  state: string;
  status: string | null;
  planName: string | null;
  maxUsers: number | null;
  validUntil: string | null;
};

function OrganizationTab() {
  const [org, setOrg] = useState<OrgView | null>(null);
  const [license, setLicense] = useState<LicenseView | null>(null);
  const [legacyLicense, setLegacyLicense] = useState<LegacyLicenseView | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [exportingAudit, setExportingAudit] = useState(false);
  const [exportingStats, setExportingStats] = useState(false);
  const [exportError, setExportError] = useState("");

  const { loading, error: loadError, isStale, cachedAt, refresh } = useOfflineCache<OrgView>({
    endpoint: "/tenants/me",
    fetcher: async () => {
      const res = await api.get<{ data: OrgView }>("/tenants/me");
      return res.data;
    },
    onData: data => {
      setOrg(data);
      setName(data.name);
      setPrefix(data.identifierPrefix);
      if (data.license !== undefined) setLicense(data.license);
    },
  });

  useOfflineCache<LegacyLicenseView>({
    endpoint: "/tenants/me/license",
    fetcher: async () => {
      const res = await api.get<{ data: LegacyLicenseView }>("/tenants/me/license");
      return res.data;
    },
    onData: setLegacyLicense,
  });

  const handleCheckout = async () => {
    setCheckoutBusy(true);
    setCheckoutError("");
    try {
      const res = await api.post<{ token: string; url: string }>("/subscriptions/checkout-token", {});
      if (res?.url) window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setCheckoutError(mapError(e, "Não foi possível gerar o link de renovação."));
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await api.patch<{ data: OrgView }>("/tenants/me", {
        name,
        identifierPrefix: prefix,
      });
      setOrg(o => o ? { ...o, ...res.data } : null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(mapError(e, "Não foi possível guardar os dados da organização."));
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
      setExportError(mapError(e, "Não foi possível exportar os dados. Tente novamente mais tarde."));
    } finally {
      setter(false);
    }
  };

  if (loading) return <div className="docid-panel p-6 max-w-xl"><div className="text-sm text-docid-muted">A carregar...</div></div>;

  return (
    <div className="space-y-6 max-w-xl">
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}
      <div className="docid-panel p-6 space-y-6">
        <h3 className="text-sm font-semibold text-docid-text">Dados da Organização</h3>
        {(error || loadError) && <p className="text-xs text-docid-error">{error || loadError}</p>}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nome</label>
          <input value={name} onChange={e => setName(e.target.value)} className="docid-input w-full" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Prefixo do Identificador</label>
          <input value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} className="docid-input w-full font-mono" maxLength={6} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Endereço da organização</label>
          <input value={org?.slug ?? ""} readOnly className="docid-input w-full font-mono bg-docid-surface-low text-docid-muted cursor-not-allowed" />
        </div>
        <div className="rounded-lg border border-docid-border bg-docid-surface-low p-4 space-y-1.5" data-testid="license-details">
          <p className="text-xs font-semibold uppercase tracking-wider text-docid-muted">Licença</p>
          <p className="font-mono text-sm text-docid-text">{license?.licenseNumber ?? "—"}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-docid-muted">Plano</dt><dd className="text-docid-text">{friendlyPlan(license?.plan ?? org?.subscription.planName)}</dd>
            <dt className="text-docid-muted">Estado</dt><dd className="text-docid-text">{license?.state ? friendlyLicenseState(license.state) : friendlySubscription(org?.subscription.status)}</dd>
            <dt className="text-docid-muted">Validade</dt><dd className="text-docid-text">{license?.validUntil ? new Date(license.validUntil).toLocaleDateString("pt-AO") : "Sem prazo"}</dd>
            <dt className="text-docid-muted">Utilizadores</dt><dd className="text-docid-text">{license ? `${license.activeUsers}/${license.maxUsers ?? "∞"}` : "—"}</dd>
          </dl>
          <div className="border-t border-docid-border pt-3 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-docid-muted">Dados antigos</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" data-testid="legacy-license-details">
              <dt className="text-docid-muted">Número</dt><dd className="text-docid-text font-mono">{legacyLicense?.licenseNumber ?? "—"}</dd>
              <dt className="text-docid-muted">Estado</dt><dd className="text-docid-text">{friendlyLicenseState(legacyLicense?.state)}</dd>
              <dt className="text-docid-muted">Situação</dt><dd className="text-docid-text">{friendlySubscription(legacyLicense?.status)}</dd>
              <dt className="text-docid-muted">Plano</dt><dd className="text-docid-text">{friendlyPlan(legacyLicense?.planName)}</dd>
              <dt className="text-docid-muted">Validade</dt><dd className="text-docid-text">{legacyLicense?.validUntil ? new Date(legacyLicense.validUntil).toLocaleDateString("pt-AO") : "Sem prazo"}</dd>
              <dt className="text-docid-muted">Limite</dt><dd className="text-docid-text">{legacyLicense?.maxUsers ?? "∞"}</dd>
            </dl>
            {checkoutError && <p className="text-xs text-docid-error">{checkoutError}</p>}
            <button data-testid="license-checkout" onClick={handleCheckout} disabled={checkoutBusy} className="docid-button-secondary mt-1">
              <RefreshCw className="h-4 w-4" /> {checkoutBusy ? "A gerar..." : "Renovar / Actualizar"}
            </button>
          </div>
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
          <button onClick={() => handleExport("audit")} disabled={exportingAudit} className="docid-button-secondary"><Download className="h-4 w-4" /> {exportingAudit ? "A exportar..." : "Exportar auditoria"}</button>
          <button onClick={() => handleExport("stats")} disabled={exportingStats} className="docid-button-secondary"><Download className="h-4 w-4" /> {exportingStats ? "A exportar..." : "Exportar estatísticas"}</button>
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

interface DeviceRow {
  id: string;
  name: string;
  status: string;
  sectorId: string | null;
  registeredByUserId: string;
  lastSeenAt: string | null;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  createdAt: string;
  sector: { id: string; name: string } | null;
  registeredBy: { id: string; fullName: string } | null;
}

interface SectorOption { id: string; name: string; }

function DevicesTab() {
  const user = useAuthStore(s => s.user);
  const isOrgAdmin = user?.roles?.includes("ORG_ADMIN") ?? false;
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [sectors, setSectors] = useState<SectorOption[]>([]);
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [writeError, setWriteError] = useState("");
  const [releaseInfo, setReleaseInfo] = useState<{ leaseId: string; message: string } | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [releasingUnused, setReleasingUnused] = useState<string | null>(null);
  const [sectorSaving, setSectorSaving] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const [isTauri] = useState(() => sync.isAvailable());
  const fetchAux = useCachedAux();

  const { loading, error: loadError, isStale, cachedAt, refresh } = useOfflineCache<DeviceRow[]>({
    endpoint: "/devices",
    fetcher: async () => {
      const res = await api.get<{ data: DeviceRow[] }>("/devices");
      return res.data || [];
    },
    onData: setDevices,
  });

  const reloadLeases = async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setLeases(await invoke<LeaseRow[]>("get_leases"));
    } catch {}
  };

  const handleRefresh = async () => { await refresh(); await reloadLeases(); };

  useEffect(() => { reloadLeases(); }, [isTauri]);

  useEffect(() => {
    (async () => {
      const loaded = await fetchAux<SectorOption[]>("/sectors");
      if (loaded) setSectors(loaded);
    })();
  }, [fetchAux]);

  const scannerDevices = useScannerStore(s => s.devices);
  const defaultScanner = useScannerStore(s => s.selectedDevice);
  const loadScanners = useScannerStore(s => s.loadDevices);
  const selectScanner = useScannerStore(s => s.selectDevice);
  const [scannerLoaded, setScannerLoaded] = useState(false);
  const printers = usePrinterStore(s => s.printers);
  const selectedPrinter = usePrinterStore(s => s.selectedPrinter);
  const loadPrinters = usePrinterStore(s => s.loadPrinters);
  const selectPrinter = usePrinterStore(s => s.selectPrinter);
  const printersLoading = usePrinterStore(s => s.loading);
  const [printersLoaded, setPrintersLoaded] = useState(false);

  useEffect(() => {
    if (isTauri && !scannerLoaded) {
      loadScanners();
      setScannerLoaded(true);
    }
  }, [isTauri, scannerLoaded, loadScanners]);

  useEffect(() => {
    if (isTauri && !printersLoaded) {
      loadPrinters();
      setPrintersLoaded(true);
    }
  }, [isTauri, printersLoaded, loadPrinters]);

  const calcUsage = (lease: LeaseRow) => {
    const total = lease.end_seq - lease.start_seq + 1;
    const used = Math.min(lease.next_to_use - lease.start_seq, total);
    return { used, total, pct: total > 0 ? Math.round(used / total * 100) : 0 };
  };

  const handleDeactivate = async (device: DeviceRow) => {
    if (!confirm(`Tem a certeza que deseja desactivar o dispositivo «${device.name}»?\n\nDeixa de ser possível gerar identificadores offline nele. As reservas de números já existentes não são afectadas.`)) return;

    setDeactivating(device.id);
    setWriteError("");
    try {
      await api.patch(`/devices/${device.id}/deactivate`, {});
      await handleRefresh();
    } catch (e: any) {
      setWriteError(mapError(e, "Não foi possível desactivar o dispositivo."));
    } finally {
      setDeactivating(null);
    }
  };

  const handleSectorChange = async (device: DeviceRow, value: string) => {
    setSectorSaving(device.id);
    setWriteError("");
    try {
      await api.patch(`/devices/${device.id}`, { sectorId: value || null });
      await handleRefresh();
    } catch (e: any) {
      setWriteError(mapError(e, "Não foi possível alterar o sector do dispositivo."));
    } finally {
      setSectorSaving(null);
    }
  };

  // shortcut: o estado do lease local não é alterado por /identifiers/release; marcar remote_released quando a app precisar de estado local sincronizado.
  const handleReleaseUnused = async (lease: LeaseRow) => {
    setReleasingUnused(lease.id);
    setWriteError("");
    setReleaseInfo(null);
    try {
      const res = await api.post<{ data: { message: string } }>("/identifiers/release", { leaseId: lease.id });
      setReleaseInfo({ leaseId: lease.id, message: friendlyMessage(res?.data?.message, "Números não usados libertados.") });
    } catch (e: any) {
      setWriteError(mapError(e, "Não foi possível libertar os números não usados."));
    } finally {
      setReleasingUnused(null);
    }
  };

  const handleForceRelease = async (lease: LeaseRow) => {
    if (!confirm("Tem a certeza? Esta acção é irreversível.\n\nOs números reservados para esta categoria e sector serão libertados. Os identificadores pendentes associados passarão a exigir confirmação manual.")) return;

    setReleasing(lease.id);
    setWriteError("");
    try {
      await api.post("/identifiers/force-release", { leaseId: lease.id });

      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("mark_lease_remote_released", { leaseId: lease.id });
      }

      await handleRefresh();
    } catch (e: any) {
      setWriteError(mapError(e, "Não foi possível libertar a reserva de números."));
    } finally {
      setReleasing(null);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}
      {(loadError || writeError) && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{loadError || writeError}</div>}

      <div className="docid-panel p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-docid-text">Dispositivos Registados</h3>
          <button onClick={handleRefresh} className="docid-button-secondary text-xs" disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-docid-muted">A carregar...</div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Smartphone className="h-8 w-8 text-docid-outline" />
            <p className="text-sm text-docid-muted">Nenhum dispositivo registado.</p>
            <p className="text-xs text-docid-muted">Os dispositivos são registados automaticamente ao usar a aplicação desktop.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-docid-border text-xs text-docid-muted">
                  <th className="px-3 py-2 text-left font-medium">Nome</th>
                  <th className="px-3 py-2 text-left font-medium">Estado</th>
                  <th className="px-3 py-2 text-left font-medium">Sector</th>
                  <th className="px-3 py-2 text-left font-medium">Registado por</th>
                  <th className="px-3 py-2 text-left font-medium">Último visto</th>
                  {isOrgAdmin && <th className="px-3 py-2 text-left font-medium">Acções</th>}
                </tr>
              </thead>
              <tbody>
                {devices.map(device => (
                  <tr key={device.id} className="border-b border-docid-border hover:bg-docid-surface-high">
                    <td className="px-3 py-2.5 font-mono text-xs text-docid-text">{device.name}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        device.status === "active" ? "bg-emerald-500/15 text-emerald-500" : "bg-docid-muted/15 text-docid-muted"
                      }`}>
                        {device.status === "active" ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-docid-muted">
                      {isOrgAdmin ? (
                        <select
                          data-testid={`device-sector-${device.id}`}
                          value={device.sectorId ?? ""}
                          onChange={e => handleSectorChange(device, e.target.value)}
                          disabled={sectorSaving === device.id}
                          className="docid-input w-36 text-xs"
                        >
                          <option value="">Sem sector</option>
                          {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      ) : (device.sector?.name ?? "—")}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-docid-muted">{device.registeredBy?.fullName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-docid-muted">{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleDateString("pt-AO") : "—"}</td>
                    {isOrgAdmin && (
                      <td className="px-3 py-2.5">
                        {device.status === "active" && (
                          <button
                            onClick={() => handleDeactivate(device)}
                            disabled={deactivating === device.id}
                            className="docid-button-secondary text-xs text-docid-error border-docid-error/30 hover:bg-docid-error/10"
                          >
                            {deactivating === device.id ? "A desactivar..." : "Desactivar"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isTauri && (
        <>
          <div className="docid-panel p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-docid-text">Scanner Predefinido</h3>
              <button onClick={loadScanners} className="docid-button-secondary text-xs" disabled={scannerDevices.length === 0}>
                <RefreshCw className="h-3 w-3" /> Actualizar
              </button>
            </div>
            {scannerDevices.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <Smartphone className="h-8 w-8 text-docid-outline" />
                <p className="text-sm text-docid-muted">Nenhum scanner encontrado.</p>
                <button onClick={loadScanners} className="docid-button-secondary text-xs"><RefreshCw className="h-3 w-3" /> Procurar scanners</button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-docid-muted">Scanner usado por omissão na página Digitalizar.</p>
                <select value={defaultScanner || ""} onChange={e => selectScanner(e.target.value)} className="docid-input w-full text-sm">
                  {scannerDevices.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="docid-panel p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-docid-text">Impressora Predefinida</h3>
              <button onClick={loadPrinters} className="docid-button-secondary text-xs" disabled={printersLoading}>
                <RefreshCw className={`h-3 w-3 ${printersLoading ? "animate-spin" : ""}`} /> Actualizar
              </button>
            </div>
            {printers.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <Printer className="h-8 w-8 text-docid-outline" />
                <p className="text-sm text-docid-muted">Nenhuma impressora encontrada.</p>
                <button onClick={loadPrinters} className="docid-button-secondary text-xs"><RefreshCw className="h-3 w-3" /> Procurar impressoras</button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-docid-muted">Usada por omissão ao imprimir digitalizações e documentos.</p>
                <select value={selectedPrinter || ""} onChange={e => selectPrinter(e.target.value)} className="docid-input w-full text-sm">
                  {printers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="docid-panel p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-docid-text">Reservas de números</h3>
            </div>

            {leases.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Smartphone className="h-8 w-8 text-docid-outline" />
                <p className="text-sm text-docid-muted">Nenhuma reserva de números neste dispositivo.</p>
                <p className="text-xs text-docid-muted">As reservas são criadas automaticamente ao gerar identificadores offline para documentos fiscais.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {leases.map(lease => {
                  const usage = calcUsage(lease);
                  return (
                    <div key={lease.id} className="rounded-lg border border-docid-border p-4 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-docid-text">Reserva de números</p>
                          <p className="mt-1 text-sm font-medium">{lease.category_id}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          lease.status === "active" ? "bg-emerald-500/15 text-emerald-500" :
                          lease.status === "exhausted" ? "bg-docid-muted/15 text-docid-muted" :
                          lease.status === "remote_released" ? "bg-amber-500/15 text-amber-500" :
                          "bg-docid-muted/10 text-docid-muted"
                        }`}>
                          {friendlyStatus(lease.status)}
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
                        <div className="flex justify-end gap-2">
                          <button
                            data-testid={`release-unused-${lease.id}`}
                            onClick={() => handleReleaseUnused(lease)}
                            disabled={releasingUnused === lease.id || !!releasing}
                            className="docid-button-secondary text-xs"
                          >
                            {releasingUnused === lease.id ? "A libertar..." : "Libertar não usados"}
                          </button>
                          <button
                            onClick={() => handleForceRelease(lease)}
                            disabled={releasing === lease.id || !!releasingUnused}
                            className="docid-button-secondary text-xs text-docid-error border-docid-error/30 hover:bg-docid-error/10"
                          >
                            {releasing === lease.id ? "A libertar..." : "Forçar libertação"}
                          </button>
                        </div>
                      )}
                      {releaseInfo?.leaseId === lease.id && <p data-testid="release-message" className="text-xs text-docid-secondary">{releaseInfo.message}</p>}
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
                <p className="font-medium text-amber-500 mb-1">Libertar uma reserva de números</p>
                <p>Usado quando um dispositivo foi perdido ou nunca mais será reconectado. Devolve os números não usados à organização, permitindo que outros dispositivos os reutilizem.</p>
                <p className="mt-1">Os identificadores pendentes associados precisarão de confirmação manual.</p>
                <p className="mt-1"><strong>Esta acção é irreversível.</strong></p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NotificationsTab() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const setNotificationPrefs = useAppConfigStore(s => s.setNotificationPrefs);
  const patchNotificationPref = useAppConfigStore(s => s.patchNotificationPref);

  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<Record<string, boolean>>({
    endpoint: "/auth/me",
    fetcher: async () => {
      const res = await api.get<{ notificationPreferences?: Record<string, boolean> }>("/auth/me");
      return res.notificationPreferences ?? {};
    },
    onData: (data) => {
      setPrefs(data);
      setNotificationPrefs(data);
    },
  });

  const handleToggle = async (key: string) => {
    const current = key in prefs ? !!prefs[key] : true;
    const newVal = !current;
    setPrefs(p => ({ ...p, [key]: newVal }));
    patchNotificationPref(key, newVal);
    setSaving(key);
    try {
      await api.patch("/auth/me/notifications-preferences", { [key]: newVal });
    } catch {
      setPrefs(p => ({ ...p, [key]: current }));
      patchNotificationPref(key, current);
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="docid-panel p-6 max-w-xl"><div className="text-sm text-docid-muted">A carregar...</div></div>;

  const items = [
    { key: "approval_pending", label: "Aprovação pendente", desc: "Quando um documento necessita da sua aprovação" },
    { key: "approval_resolved", label: "Aprovação resolvida", desc: "Quando uma aprovação foi concedida ou rejeitada" },
    { key: "document_shared", label: "Documento partilhado", desc: "Quando um documento é partilhado consigo ou com o seu sector" },
    { key: "sync_complete", label: "Sincronização concluída", desc: "Quando os ficheiros guardados são enviados com sucesso" },
    { key: "sync_failed", label: "Falha na sincronização", desc: "Quando um ficheiro guardado não é enviado" },
    { key: "queue_enqueued", label: "Ficheiro guardado para envio", desc: "Quando um ficheiro é guardado por falta de ligação" },
    { key: "write_enqueued", label: "Alteração pendente", desc: "Quando uma alteração fica guardada até haver ligação" },
    { key: "watcher_detected", label: "Novo ficheiro detectado", desc: "Quando aparece um ficheiro novo na pasta vigiada" },
  ];

  return (
    <div className="docid-panel p-6 space-y-6">
      <h3 className="text-sm font-semibold text-docid-text">Preferências de Notificação</h3>
      <p className="text-xs text-docid-muted">Seleccione os avisos que pretende receber. Alguns aparecem directamente no computador.</p>
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}
      {error && <p className="text-xs text-docid-error">{error}</p>}
      {items.map(({ key, label, desc }) => (
        <label key={key} className="flex items-center justify-between gap-4 rounded-lg border border-docid-border p-4 hover:bg-docid-surface-high cursor-pointer">
          <div>
            <p className="text-sm font-medium text-docid-text">{label}</p>
            <p className="text-xs text-docid-muted">{desc}</p>
          </div>
          <input type="checkbox" checked={key in prefs ? !!prefs[key] : true} onChange={() => handleToggle(key)} disabled={saving === key} className="rounded border-docid-border bg-docid-surface-low text-docid-primary focus:ring-docid-primary" />
        </label>
      ))}
    </div>
  );
}

function WatcherTab() {
  const navigate = useNavigate();
  const { folders, running, loading, error, detectedCount, files, reminders, report, loadFolders, addFolder, removeFolder, start, stop, refreshFiles, refreshReminders, refreshReport, setFileStatus, attachDetectedFile } = useWatcherStore();
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState("");

  useEffect(() => { loadFolders(); }, [loadFolders]);

  useEffect(() => {
    let unlisteners: (() => void)[] = [];
    (async () => {
      if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) return;
      const { listen } = await import("@tauri-apps/api/event");
      const f1 = await listen("watcher:file_detected", () => {
        refreshFiles(); refreshReport();
      });
      const f2 = await listen("watcher:identifier_found", () => {
        refreshFiles(); refreshReport();
      });
      const f3 = await listen("watcher:status_changed", () => {
        refreshFiles(); refreshReminders(); refreshReport();
      });
      unlisteners = [f1, f2, f3];
    })();
    return () => unlisteners.forEach(f => f());
  }, [refreshFiles, refreshReminders, refreshReport]);

  const handleAddFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Seleccionar pasta para vigiar" });
      if (selected) await addFolder(selected);
    } catch {}
  };

  const reportCards = report ? [
    { label: "Detectados", value: report.detected, tone: "text-docid-primary-soft" },
    { label: "Com identificador", value: report.identifier_found, tone: "text-docid-secondary" },
    { label: "Lembretes", value: report.pending, tone: "text-docid-tertiary" },
    { label: "Adicionados", value: report.added, tone: "text-docid-success" },
    { label: "Ignorados", value: report.ignored, tone: "text-docid-muted" },
    { label: "Sem identificador", value: report.file_detected, tone: "text-docid-muted" },
  ] : [];

  const detectedFiles = files.filter(f => f.status === "detected");
  const fileLabel = (p: string) => decodeURIComponent(p.split("/").pop() || p);

  const handleAddNow = async (f: WatcherFileRow) => {
    setActionInfo("");
    if (!f.identifier) {
      navigate(`/documentos?attachPath=${encodeURIComponent(f.path)}`);
      return;
    }
    setBusyPath(f.path);
    try {
      const result = await attachDetectedFile(f.path, f.identifier);
      setActionInfo(result === "queued"
        ? "Guardado na fila offline — será enviado quando houver ligação."
        : "Documento anexado.");
    } catch {
      // o store já preenche `error`
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      {actionInfo && <div className="rounded-lg border border-docid-secondary/30 bg-docid-secondary/10 p-3 text-sm text-docid-secondary">{actionInfo}</div>}
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

      {report && (
        <div className="grid grid-cols-3 gap-2">
          {reportCards.map(c => (
            <div key={c.label} className="rounded-lg bg-docid-surface-low p-3 text-center">
              <p className={`text-xl font-bold ${c.tone}`}>{c.value}</p>
              <p className="text-xs text-docid-muted">{c.label}</p>
            </div>
          ))}
        </div>
      )}

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

      {detectedFiles.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-docid-text">Ficheiros detectados</h3>
          <div className="docid-panel divide-y divide-docid-border">
            {detectedFiles.map(f => (
              <div key={f.path} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-docid-text" title={f.path}>{fileLabel(f.path)}</p>
                  <p className="text-xs text-docid-muted">{f.kind === "identifier_found" ? `Identificador: ${f.identifier}` : "Sem identificador encontrado"}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button onClick={() => handleAddNow(f)} disabled={busyPath === f.path} className="docid-button-primary text-xs py-1.5">{busyPath === f.path ? "A anexar..." : "Adicionar agora"}</button>
                  <button onClick={() => setFileStatus(f.path, "pending")} disabled={!!busyPath} className="docid-button-secondary text-xs py-1.5">Mais tarde</button>
                  <button onClick={() => setFileStatus(f.path, "ignored")} disabled={!!busyPath} className="docid-button-secondary text-xs py-1.5 text-docid-error">Não pertence</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {reminders.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-docid-text">Lembretes <span className="font-normal text-docid-muted">({reminders.length})</span></h3>
          <div className="docid-panel divide-y divide-docid-border">
            {reminders.map(f => (
              <div key={f.path} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-docid-text" title={f.path}>{fileLabel(f.path)}</p>
                  <p className="text-xs text-docid-muted">{f.identifier ? `Identificador: ${f.identifier}` : "Sem identificador encontrado"}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button onClick={() => handleAddNow(f)} disabled={busyPath === f.path} className="docid-button-primary text-xs py-1.5">{busyPath === f.path ? "A anexar..." : "Adicionar agora"}</button>
                  <button onClick={() => setFileStatus(f.path, "ignored")} disabled={!!busyPath} className="docid-button-secondary text-xs py-1.5 text-docid-error">Dispensar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-docid-muted">Quando encontra um identificador, «Adicionar agora» anexa o ficheiro (ou guarda-o para envio se não houver ligação). Sem identificador, abre Documentos para completar o anexo.</p>
    </div>
  );
}

/* ── E-mail dos alertas (configuração por organização) ── */

const EMAIL_PROVIDER_LABELS: Record<string, string> = {
  smtp: "Servidor da empresa", resend: "Serviço de e-mail A", sendgrid: "Serviço de e-mail B",
};

export type EmailForm = {
  provider: "smtp" | "resend" | "sendgrid";
  fromEmail: string; fromName: string; replyTo: string;
  smtpHost: string; smtpPort: string; smtpSecurity: "ssl" | "starttls" | "none"; smtpUser: string;
  secret: string; enabled: boolean;
};

export function emailSettingsPayload(f: EmailForm) {
  const base = {
    provider: f.provider,
    fromEmail: f.fromEmail.trim(),
    fromName: f.fromName.trim() || null,
    replyTo: f.replyTo.trim() || null,
    enabled: f.enabled,
  };
  const secret = f.secret ? { secret: f.secret } : {};
  if (f.provider === "smtp") {
    return { ...base, ...secret, smtpHost: f.smtpHost.trim(), smtpPort: Number(f.smtpPort), smtpSecurity: f.smtpSecurity, smtpUser: f.smtpUser.trim() || null };
  }
  return { ...base, ...secret };
}

type EmailSettingsView = {
  provider: "smtp" | "resend" | "sendgrid";
  fromEmail: string; fromName: string | null; replyTo: string | null;
  smtpHost: string | null; smtpPort: number | null; smtpSecurity: "ssl" | "starttls" | "none" | null;
  smtpUser: string | null; enabled: boolean; hasSecret: boolean;
  verifiedAt: string | null; lastTestAt: string | null; lastTestError: string | null;
};

type EmailLog = {
  id: string; eventType: string; recipientEmail: string; subject: string; status: string;
  attempts: number; provider: string | null; sender: string | null; lastError: string | null;
  createdAt: string; sentAt: string | null;
};

const emptyEmailForm: EmailForm = {
  provider: "smtp", fromEmail: "", fromName: "", replyTo: "",
  smtpHost: "", smtpPort: "587", smtpSecurity: "starttls", smtpUser: "",
  secret: "", enabled: true,
};

function EmailTab() {
  const [form, setForm] = useState<EmailForm>(emptyEmailForm);
  const [settings, setSettings] = useState<EmailSettingsView | null>(null);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [s, l] = await Promise.all([
        api.get<{ data: { settings: EmailSettingsView | null; fallbackMode: string } }>("/email/settings"),
        api.get<{ data: EmailLog[] }>("/email/logs?limit=20"),
      ]);
      setSettings(s.data.settings);
      setLogs(l.data);
      if (s.data.settings) {
        const v = s.data.settings;
        setForm({
          provider: v.provider, fromEmail: v.fromEmail, fromName: v.fromName ?? "", replyTo: v.replyTo ?? "",
          smtpHost: v.smtpHost ?? "", smtpPort: String(v.smtpPort ?? 587), smtpSecurity: v.smtpSecurity ?? "starttls",
          smtpUser: v.smtpUser ?? "", secret: "", enabled: v.enabled,
        });
      }
    } catch (err: any) { setError(mapError(err, "Não foi possível carregar a configuração de e-mail.")); }
  };

  useEffect(() => { void load(); }, []);

  const run = async (action: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(action); setError(""); setMessage("");
    try { await fn(); setMessage(ok); await load(); }
    catch (err: any) { setError(mapError(err, "Não foi possível guardar a configuração de e-mail.")); }
    finally { setBusy(""); }
  };

  const set = <K extends keyof EmailForm>(key: K, value: EmailForm[K]) => setForm(f => ({ ...f, [key]: value }));

  return (
    <div className="space-y-5" data-testid="email-settings">
      <div>
        <h3 className="text-sm font-semibold text-docid-text">Alertas por e-mail</h3>
        <p className="text-xs text-docid-muted">Configure o envio de avisos quando um documento é aprovado ou partilhado. Sem configuração própria, os avisos são enviados pela DocID.</p>
      </div>

      <div className="docid-panel p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-docid-muted">Fornecedor
            <select data-testid="email-provider" className="docid-input mt-1 w-full" value={form.provider} onChange={e => set("provider", e.target.value as EmailForm["provider"])}>
              <option value="smtp">Servidor da empresa</option><option value="resend">Serviço de e-mail A</option><option value="sendgrid">Serviço de e-mail B</option>
            </select>
          </label>
          <label className="text-xs text-docid-muted">Remetente (e-mail)
            <input data-testid="email-from" className="docid-input mt-1 w-full" value={form.fromEmail} onChange={e => set("fromEmail", e.target.value)} placeholder="alertas@empresa.ao" />
          </label>
          <label className="text-xs text-docid-muted">Nome do remetente
            <input className="docid-input mt-1 w-full" value={form.fromName} onChange={e => set("fromName", e.target.value)} />
          </label>
          <label className="text-xs text-docid-muted">Responder a
            <input className="docid-input mt-1 w-full" value={form.replyTo} onChange={e => set("replyTo", e.target.value)} />
          </label>
        </div>

        {form.provider === "smtp" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-docid-muted">Endereço do servidor de e-mail
              <input data-testid="email-smtp-host" className="docid-input mt-1 w-full" value={form.smtpHost} onChange={e => set("smtpHost", e.target.value)} />
            </label>
            <label className="text-xs text-docid-muted">Porta
              <input className="docid-input mt-1 w-full" value={form.smtpPort} onChange={e => set("smtpPort", e.target.value)} inputMode="numeric" />
            </label>
            <label className="text-xs text-docid-muted">Segurança
              <select className="docid-input mt-1 w-full" value={form.smtpSecurity} onChange={e => set("smtpSecurity", e.target.value as EmailForm["smtpSecurity"])}>
                <option value="starttls">Segurança padrão</option><option value="ssl">Segurança reforçada</option><option value="none">Sem segurança</option>
              </select>
            </label>
            <label className="text-xs text-docid-muted">Utilizador do servidor
              <input className="docid-input mt-1 w-full" value={form.smtpUser} onChange={e => set("smtpUser", e.target.value)} />
            </label>
          </div>
        )}

        <label className="block text-xs text-docid-muted">Palavra-passe ou chave de acesso
          <input data-testid="email-secret" type="password" className="docid-input mt-1 w-full" value={form.secret} onChange={e => set("secret", e.target.value)}
            placeholder={settings?.hasSecret ? "Já guardada — deixe vazio para manter" : "Obrigatório para serviços externos"} />
        </label>
        <label className="flex items-center gap-2 text-xs text-docid-text">
          <input type="checkbox" checked={form.enabled} onChange={e => set("enabled", e.target.checked)} /> Activar notificações
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button data-testid="email-save" disabled={!!busy} className="docid-button-primary" onClick={() => run("guardar", () => api.put("/email/settings", emailSettingsPayload(form)), "Configuração guardada.")}>
            <Save className="h-4 w-4" /> {busy === "guardar" ? "A guardar..." : "Guardar"}
          </button>
          <button disabled={!!busy} className="docid-button-secondary" onClick={() => run("testar", () => api.post("/email/settings/test", { to: testTo }), "E-mail de teste enviado.")}>
            <Mail className="h-4 w-4" /> Enviar teste
          </button>
          <input className="docid-input w-56" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="destinatario@empresa.ao" />
          {settings && <button disabled={!!busy} className="docid-button-secondary text-docid-error" onClick={() => run("remover", () => api.delete("/email/settings"), "Configuração removida. Os avisos voltam a ser enviados pela DocID.")}><Trash2 className="h-4 w-4" /> Remover</button>}
        </div>
        {message && <p data-testid="email-message" className="text-xs text-docid-secondary">{message}</p>}
        {error && <p className="text-xs text-docid-error">{error}</p>}
        {settings?.lastTestError && <p className="text-xs text-docid-error">O último e-mail de teste não foi enviado. Verifique a configuração.</p>}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-docid-text">Histórico de envios</h3>
        {logs.length === 0 ? <p className="text-xs text-docid-muted">Ainda não há e-mails registados.</p> : (
          <div className="docid-panel divide-y divide-docid-border">
            {logs.map(l => (
              <div key={l.id} data-testid="email-log-row" className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-docid-text">{l.subject} <span className="text-docid-muted">→ {l.recipientEmail}</span></p>
                  <p className="text-xs text-docid-muted">{new Date(l.createdAt).toLocaleString("pt-AO")} · {friendlyStatus(l.status)} · {EMAIL_PROVIDER_LABELS[l.provider ?? ""] ?? "Serviço da DocID"}</p>
                </div>
                {(l.status === "failed" || l.status === "skipped") && l.eventType !== "test" && (
                  <button disabled={!!busy} className="docid-button-secondary text-xs py-1" onClick={() => run("reenviar", () => api.post(`/email/logs/${l.id}/retry`), "E-mail marcado para reenvio.")}>Reenviar</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
