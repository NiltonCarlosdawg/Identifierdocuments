import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore, decodeJwtUser } from "./stores/auth";
import { useAppConfigStore } from "./stores/config";
import { syncService } from "./services/sync";
import Layout from "./components/Layout";
import Login from "./routes/Login";
import Onboarding from "./routes/Onboarding";
import Dashboard from "./routes/Dashboard";
import Identifiers from "./routes/Identifiers";
import Documents from "./routes/Documents";
import Approvals from "./routes/Approvals";
import Sectors from "./routes/Sectors";
import Users from "./routes/Users";
import Settings from "./routes/Settings";
import Audit from "./routes/Audit";
import Profile from "./routes/Profile";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function ConfigSync() {
  const token = useAuthStore((s) => s.token);
  const apiBaseUrl = useAppConfigStore((s) => s.apiBaseUrl);

  useEffect(() => {
    if (syncService.isAvailable()) {
      syncService.setApiBaseUrl(apiBaseUrl).catch(() => {});
      if (token) {
        syncService.setCredentials(token, apiBaseUrl).catch(() => {});
      }
    }
  }, [apiBaseUrl, token]);

  return null;
}

function ThemeInit() {
  const theme = useAppConfigStore((s) => s.theme);
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);
  return null;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  useEffect(() => {
    if (token && !user) {
      const decoded = decodeJwtUser(token);
      if (decoded) {
        setUser({
          id: decoded.userId,
          email: "",
          fullName: "",
          tenantId: decoded.tenantId,
          sectorId: decoded.sectorId,
          roles: decoded.roles,
          organization: null,
        });
      }
    }
  }, [token, user, setUser]);

  return (
    <>
      <ConfigSync />
      <ThemeInit />
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
