import { useEffect, useState } from "react";
import { api } from "../services/api";
import { useAuthStore } from "../stores/auth";
import { User, Building2, Save } from "lucide-react";

export default function Settings() {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<"profile" | "org">("profile");

  const [profile, setProfile] = useState({ fullName: "", email: "" });
  const [passwordForm, setPasswordForm] = useState({ current: "", newPass: "", confirm: "" });
  const [org, setOrg] = useState({ name: "", identifierPrefix: "" });
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      setProfile({ fullName: user.fullName, email: user.email });
    }
    api.get<any>("/tenants/me").then((res) => {
      if (res.data) {
        setOrg({ name: res.data.name, identifierPrefix: res.data.identifierPrefix || "VL" });
      }
    }).catch(() => {});
  }, [user]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSaved("");
    try {
      await api.patch(`/users/${user!.id}`, profile);
      setSaved("Perfil actualizado.");
    } catch (err: any) { setError(err.message); }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSaved("");
    if (passwordForm.newPass !== passwordForm.confirm) { setError("Passwords não coincidem."); return; }
    try {
      await api.patch("/auth/me/password", { currentPassword: passwordForm.current, newPassword: passwordForm.newPass, confirmPassword: passwordForm.confirm });
      setSaved("Password alterada.");
      setPasswordForm({ current: "", newPass: "", confirm: "" });
    } catch (err: any) { setError(err.message); }
  };

  const saveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSaved("");
    try {
      await api.patch("/tenants/me", org);
      setSaved("Organização actualizada.");
    } catch (err: any) { setError(err.message); }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Configurações</h1>

      <div className="mb-6 flex gap-2 border-b border-gray-200">
        <button onClick={() => setTab("profile")}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === "profile" ? "border-verano-600 text-verano-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          <User className="h-4 w-4" /> Perfil
        </button>
        <button onClick={() => setTab("org")}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === "org" ? "border-verano-600 text-verano-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          <Building2 className="h-4 w-4" /> Organização
        </button>
      </div>

      {saved && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{saved}</div>}
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {tab === "profile" && (
        <div className="space-y-6">
          <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4">Dados do perfil</h2>
            <form onSubmit={saveProfile} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Nome completo</label>
                <input value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-verano-500 focus:outline-none focus:ring-1 focus:ring-verano-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-verano-500 focus:outline-none focus:ring-1 focus:ring-verano-500" />
              </div>
              <button type="submit" className="flex items-center gap-2 rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700 transition-colors">
                <Save className="h-4 w-4" /> Guardar
              </button>
            </form>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4">Alterar password</h2>
            <form onSubmit={savePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Password actual</label>
                <input type="password" value={passwordForm.current} onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Nova password</label>
                  <input type="password" value={passwordForm.newPass} onChange={(e) => setPasswordForm({ ...passwordForm, newPass: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" minLength={6} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Confirmar</label>
                  <input type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required />
                </div>
              </div>
              <button type="submit" className="flex items-center gap-2 rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700 transition-colors">
                <Save className="h-4 w-4" /> Alterar password
              </button>
            </form>
          </div>
        </div>
      )}

      {tab === "org" && (
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold mb-4">Dados da organização</h2>
          <form onSubmit={saveOrg} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Nome</label>
              <input value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-verano-500 focus:outline-none focus:ring-1 focus:ring-verano-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Prefixo do identificador</label>
              <input value={org.identifierPrefix} onChange={(e) => setOrg({ ...org, identifierPrefix: e.target.value.toUpperCase() })}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" maxLength={5} />
              <p className="mt-1 text-xs text-gray-400">Ex: VL → VL-PROP-2026-0622-001</p>
            </div>
            <button type="submit" className="flex items-center gap-2 rounded-lg bg-verano-600 px-4 py-2 text-sm font-medium text-white hover:bg-verano-700 transition-colors">
              <Save className="h-4 w-4" /> Guardar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
