import { useAuthStore } from "../stores/authStore";

export default function Dashboard() {
  const user = useAuthStore(s => s.user);
  return <div><h1 className="text-2xl font-semibold text-docid-text">Dashboard</h1><p className="mt-2 text-docid-muted">Bem-vindo, {user?.fullName || "utilizador"}.</p></div>;
}
