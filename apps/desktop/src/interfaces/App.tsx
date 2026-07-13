import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { decodeJwtUser } from "../domain/entities/User";
import type { StoredUser } from "../domain/entities/User";
import { useAuthStore } from "./stores/authStore";
import { useAppConfigStore } from "./stores/configStore";
import { api, sync } from "../infrastructure/di/container";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Identifiers from "./pages/Identifiers";
import Documents from "./pages/Documents";
import Approvals from "./pages/Approvals";
import Sectors from "./pages/Sectors";
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import Audit from "./pages/Audit";
import Profile from "./pages/Profile";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function ConfigSync() {
  const token = useAuthStore(s => s.token);
  const apiBaseUrl = useAppConfigStore(s => s.apiBaseUrl);
  useEffect(() => {
    if (sync.isAvailable()) {
      sync.setApiBaseUrl(apiBaseUrl).catch(() => {});
      if (token) sync.setCredentials(token, apiBaseUrl).catch(() => {});
    }
  }, [apiBaseUrl, token]);
  return null;
}

function ThemeInit() {
  const theme = useAppConfigStore(s => s.theme);
  useEffect(() => { document.documentElement.classList.toggle("dark", theme === "dark"); }, [theme]);
  return null;
}

export default function App() {
  const token = useAuthStore(s => s.token);
  const user = useAuthStore(s => s.user);
  const setUser = useAuthStore(s => s.setUser);
  const logout = useAuthStore(s => s.logout);

  useEffect(() => {
    if (token && !user) {
      const decoded = decodeJwtUser(token);
      if (decoded) setUser({ id: decoded.userId, email: "", fullName: "", tenantId: decoded.tenantId, sectorId: decoded.sectorId, roles: decoded.roles, organization: null });
    }
  }, [token, user, setUser]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await api.get<{ data: StoredUser | null }>("/auth/me");
        if (res.data === null) { logout(); return; }
        setUser(res.data);
      } catch (err: any) {
        if (err?.message === "Sessão expirada") logout();
      }
    })();
  }, [token, setUser, logout]);

  return (
    <>
      <ConfigSync /><ThemeInit />
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/onboarding" element={token ? <Navigate to="/" replace /> : <Onboarding />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="identificadores" element={<Identifiers />} />
          <Route path="documentos" element={<Documents />} />
          <Route path="aprovacoes" element={<Approvals />} />
          <Route path="sectores" element={<Sectors />} />
          <Route path="utilizadores" element={<Users />} />
          <Route path="auditoria" element={<Audit />} />
          <Route path="configuracoes" element={<Settings />} />
          <Route path="perfil" element={<Profile />} />
        </Route>
      </Routes>
    </>
  );
}
