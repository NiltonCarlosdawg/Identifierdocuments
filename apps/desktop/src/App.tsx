import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/auth";
import Layout from "./components/Layout";
import Login from "./routes/Login";
import Dashboard from "./routes/Dashboard";
import Identifiers from "./routes/Identifiers";
import Documents from "./routes/Documents";
import Approvals from "./routes/Approvals";
import Sectors from "./routes/Sectors";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const token = useAuthStore((s) => s.token);

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="identificadores" element={<Identifiers />} />
        <Route path="documentos" element={<Documents />} />
        <Route path="aprovacoes" element={<Approvals />} />
        <Route path="sectores" element={<Sectors />} />
      </Route>
    </Routes>
  );
}
