import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import {
  LayoutDashboard, FileText, Fingerprint, LogOut, Building2, CheckSquare, Users, UserPlus, Cog,
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
  { to: "/configuracoes", label: "Configurações", icon: Cog, roles: ["ORG_ADMIN"] },
];

export default function Layout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = async () => {
    const { syncService } = await import("../services/sync");
    await syncService.clearCredentials();
    logout();
    navigate("/login");
  };

  const visibleNav = navItems.filter(
    (item) => !item.roles || item.roles.some((r) => user?.roles.includes(r)),
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <aside className="flex w-64 flex-col bg-verano-900 text-white">
        <div className="flex items-center gap-2 px-6 py-5 border-b border-verano-700">
          <Building2 className="h-6 w-6" />
          <div>
            <p className="font-bold text-sm">DocID</p>
            <p className="text-xs text-verano-300">{user?.organization || "—"}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? "bg-verano-700 text-white" : "text-verano-200 hover:bg-verano-800 hover:text-white"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-verano-700 px-4 py-3">
          <div className="flex items-center gap-3 text-sm">
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium">{user?.fullName}</p>
              <p className="truncate text-xs text-verano-300">{user?.email}</p>
            </div>
            <button onClick={handleLogout} className="rounded-lg p-1.5 hover:bg-verano-800 transition-colors">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-end gap-2 border-b border-gray-200 bg-white px-6 py-2">
          <OfflineQueueBadge />
          <NotificationBell />
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-8">
            <Outlet />
          </div>
        </main>
      </div>

      <OfflineQueuePanel />
    </div>
  );
}
