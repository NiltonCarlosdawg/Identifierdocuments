import { useState, useRef, useEffect } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useAppConfigStore } from "../stores/configStore";
import { LayoutDashboard, FileText, Fingerprint, CheckSquare, Users, UserPlus, Cog, History, Scan, CloudOff, Search, Menu, LogOut, User, Shield, RefreshCw, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import OfflineQueuePanel, { OfflineQueueBadge } from "./OfflineQueuePanel";
import WriteQueuePanel, { WriteQueueBadge } from "./WriteQueuePanel";
import NotificationBell from "./NotificationBell";
import NativeNotificationsBridge from "./NativeNotificationsBridge";
import LicenseBanner from "./LicenseBanner";
import { useSyncStatus, syncStatusLabel } from "../hooks/useSyncStatus";
import { useQueueStore } from "../stores/queueStore";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/identificadores", label: "Identificadores", icon: Fingerprint },
  { to: "/documentos", label: "Documentos", icon: FileText },
  { to: "/aprovacoes", label: "Aprovações", icon: CheckSquare, roles: ["ORG_ADMIN", "SECTOR_SUPERVISOR"] },
  { to: "/sectores", label: "Sectores", icon: Users, roles: ["ORG_ADMIN"] },
  { to: "/utilizadores", label: "Utilizadores", icon: UserPlus, roles: ["ORG_ADMIN", "SECTOR_SUPERVISOR"] },
  { to: "/roles", label: "Permissões", icon: Shield, roles: ["ORG_ADMIN"] },
  { to: "/auditoria", label: "Auditoria", icon: History, roles: ["ORG_ADMIN"] },
  { to: "/digitalizar", label: "Digitalizar", icon: Scan },
  { to: "/configuracoes", label: "Configurações", icon: Cog },
];

export default function Layout() {
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const avatar = useAppConfigStore(s => s.avatar);
  const setQueuePanelOpen = useQueueStore(s => s.setPanelOpen);
  const { pendingUploads, pendingWrites, online, syncing, lastSyncedAt, lastError, syncNow } = useSyncStatus();
  const pendingTotal = pendingUploads + pendingWrites;
  const navigate = useNavigate();
  const visibleNav = navItems.filter(item => !item.roles || item.roles.some(r => user?.roles.includes(r)));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-docid-background text-docid-text">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-docid-border bg-docid-surface">
        <div className="flex items-center gap-3 px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-docid-primary/15 text-docid-primary-soft"><FileText className="h-5 w-5" /></div>
          <div><p className="text-lg font-bold text-docid-primary-soft">DocID</p><p className="text-xs text-docid-muted">{user?.organization || "Organização"}</p></div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "bg-docid-primary text-white" : "text-docid-muted hover:bg-docid-surface-high hover:text-docid-text"}`}>
              <Icon className="h-4 w-4" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-docid-border px-3 py-4">
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="sidebar-sync-status"
              onClick={() => setQueuePanelOpen(true)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-docid-muted transition hover:bg-docid-surface-high hover:text-docid-text"
            >
              {!online ? <CloudOff className="h-4 w-4 shrink-0 text-docid-tertiary" /> : syncing ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : pendingTotal === 0 ? <CheckCircle2 className="h-4 w-4 shrink-0 text-docid-secondary" /> : <CloudOff className="h-4 w-4 shrink-0" />}
              <span className="min-w-0">
                <span className="block truncate">Fila de sincronização</span>
                <span className="block text-xs font-normal text-docid-muted">{pendingUploads} envios · {pendingWrites} alterações</span>
              </span>
              <span className="ml-auto shrink-0 rounded-full bg-docid-surface-high px-2 py-0.5 text-[10px]" title={lastSyncedAt ? `Última sincronização: ${new Date(lastSyncedAt).toLocaleString("pt-PT")}` : "Ainda sem sincronização"}>
                {syncStatusLabel(online, syncing, pendingTotal, lastSyncedAt)}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={!online || syncing || pendingTotal === 0}
              aria-label="Sincronizar agora"
              title="Sincronizar agora"
              className="rounded-lg p-2 text-docid-muted transition hover:bg-docid-surface-high hover:text-docid-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            </button>
          </div>
          {lastError && (
            <p className="mt-2 flex items-center gap-2 px-3 text-xs text-docid-error">
              <AlertCircle className="h-3 w-3" /> A última sincronização teve um problema. Tente novamente.
            </p>
          )}
        </div>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-docid-border bg-docid-background px-6">
          <div className="flex items-center gap-3">
            <button aria-label="Abrir menu" className="rounded-lg p-2 text-docid-muted transition hover:bg-docid-surface-high hover:text-docid-text"><Menu className="h-4 w-4" /></button>
            <div className="hidden w-80 items-center gap-2 rounded-lg border border-docid-border bg-docid-surface-low px-3 py-1.5 md:flex">
              <Search className="h-4 w-4 text-docid-outline" />
              <input className="w-full border-none bg-transparent text-sm text-docid-text outline-none placeholder:text-docid-outline" placeholder="Pesquisar no DocID..." />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <OfflineQueueBadge /><WriteQueueBadge /><NotificationBell />
            <div ref={menuRef} className="relative">
              <button onClick={() => setMenuOpen(!menuOpen)} className="flex items-center gap-2 rounded-lg p-1.5 pr-3 transition hover:bg-docid-surface-high">
                {avatar ? <img src={avatar} alt="Avatar" className="h-8 w-8 rounded-full object-cover" /> : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-docid-primary/15 text-xs font-semibold text-docid-primary-soft">{(user?.fullName || "AD").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}</div>}
                <span className="text-sm font-medium text-docid-text">{user?.fullName}</span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-docid-border bg-docid-surface shadow-xl z-50 py-1">
                  <button onClick={() => { setMenuOpen(false); navigate("/perfil"); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-docid-text hover:bg-docid-surface-high transition-colors"><User className="h-4 w-4" /> Perfil</button>
                  <div className="border-t border-docid-border" />
                  <button onClick={() => { setMenuOpen(false); logout(); navigate("/login"); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-docid-error hover:bg-docid-surface-high transition-colors"><LogOut className="h-4 w-4" /> Sair</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <LicenseBanner />
        <main className="flex-1 overflow-y-auto bg-docid-background"><div className="mx-auto max-w-7xl px-6 py-7"><Outlet /></div></main>
      </div>
      <OfflineQueuePanel />
      <WriteQueuePanel />
      <NativeNotificationsBridge />
    </div>
  );
}
