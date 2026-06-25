import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { useAppConfigStore } from "../stores/config";
import {
  LayoutDashboard,
  FileText,
  Fingerprint,
  CheckSquare,
  Users,
  UserPlus,
  Cog,
  History,
  CloudOff,
  Search,
  Menu,
} from "lucide-react";
import OfflineQueuePanel, { OfflineQueueBadge } from "./OfflineQueuePanel";
import NotificationBell from "./NotificationBell";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/identificadores", label: "Identificadores", icon: Fingerprint },
  { to: "/documentos", label: "Documentos", icon: FileText },
  { to: "/aprovacoes", label: "Aprovações", icon: CheckSquare, roles: ["ORG_ADMIN", "SECTOR_SUPERVISOR"] },
  { to: "/sectores", label: "Sectores", icon: Users, roles: ["ORG_ADMIN"] },
  { to: "/utilizadores", label: "Utilizadores", icon: UserPlus, roles: ["ORG_ADMIN"] },
  { to: "/auditoria", label: "Auditoria", icon: History, roles: ["ORG_ADMIN"] },
  { to: "/configuracoes", label: "Configurações", icon: Cog, roles: ["ORG_ADMIN"] },
];

export default function Layout() {
  const user = useAuthStore((s) => s.user);
  const avatar = useAppConfigStore((s) => s.avatar);
  const navigate = useNavigate();

  const visibleNav = navItems.filter(
    (item) => !item.roles || item.roles.some((r) => user?.roles.includes(r)),
  );

  return (
    <div className="flex h-screen overflow-hidden bg-docid-background text-docid-text">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-docid-border bg-docid-surface">
        <div className="flex items-center gap-3 px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-docid-primary/15 text-docid-primary-soft">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-bold text-docid-primary-soft">DocID</p>
            <p className="text-xs text-docid-muted">{user?.organization || "Enterprise Management"}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-docid-primary text-white" : "text-docid-muted hover:bg-docid-surface-high hover:text-docid-text"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-docid-border px-3 py-4">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-docid-muted">
            <CloudOff className="h-4 w-4" />
            Fila Offline
            <span className="ml-auto rounded-full bg-docid-surface-high px-2 py-0.5 text-[10px]">Sync</span>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-docid-border bg-docid-background px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 text-docid-muted transition hover:bg-docid-surface-high hover:text-docid-text">
              <Menu className="h-4 w-4" />
            </button>
            <div className="hidden w-80 items-center gap-2 rounded-lg border border-docid-border bg-docid-surface-low px-3 py-1.5 md:flex">
              <Search className="h-4 w-4 text-docid-outline" />
              <input className="w-full border-none bg-transparent text-sm text-docid-text outline-none placeholder:text-docid-outline" placeholder="Pesquisar no DocID..." />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <OfflineQueueBadge />
            <NotificationBell />
            <button
              onClick={() => navigate("/perfil")}
              className="flex items-center gap-2 rounded-lg p-1.5 pr-3 transition hover:bg-docid-surface-high"
            >
              {avatar ? (
                <img src={avatar} alt="Avatar" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-docid-primary/15 text-xs font-semibold text-docid-primary-soft">
                  {(user?.fullName || "AD").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="text-sm font-medium text-docid-text">{user?.fullName}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-docid-background">
          <div className="mx-auto max-w-7xl px-6 py-7">
            <Outlet />
          </div>
        </main>
      </div>

      <OfflineQueuePanel />
    </div>
  );
}
