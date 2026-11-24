import { useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { useAppConfigStore } from "../stores/configStore";
import { api } from "../../infrastructure/di/container";
import { mapError, friendlyRole } from "../../shared/errors/mapError";
import { PageHeader } from "../components/docid-ui";
import { User, Lock, Save, Sun, Moon } from "lucide-react";

export default function Profile() {
  const user = useAuthStore(s => s.user);
  const setUser = useAuthStore(s => s.setUser);
  const theme = useAppConfigStore(s => s.theme);
  const setTheme = useAppConfigStore(s => s.setTheme);
  const [fullName, setFullName] = useState(user?.fullName || "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  const initials = (name?: string | null) => (name || "AD").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();

  const handleSaveName = async () => {
    if (!fullName.trim() || fullName === user?.fullName) return;
    setSaving(true); setSaveMsg("");
    try {
      const res = await api.patch<{ data?: { fullName?: string }; fullName?: string }>("/auth/me", { fullName: fullName.trim() });
      const updatedName = res.data?.fullName ?? res.fullName ?? fullName.trim();
      if (user) setUser({ ...user, fullName: updatedName });
      setSaveMsg("Nome actualizado.");
    } catch (err: any) { setSaveMsg(mapError(err, "Não foi possível guardar o nome.")); } finally { setSaving(false); }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(""); setPwSuccess("");
    if (newPassword !== confirmPassword) { setPwError("As palavras-passe não coincidem."); return; }
    if (newPassword.length < 6) { setPwError("A nova palavra-passe deve ter pelo menos 6 caracteres."); return; }
    setPwLoading(true);
    try {
      const res = await api.patch<{ token?: string; data?: { token?: string } }>("/auth/me/password", { currentPassword, newPassword });
      // O servidor termina todas as sessões antigas e devolve um token novo para esta.
      const newToken = res?.token ?? res?.data?.token;
      if (newToken && user) useAuthStore.getState().login(newToken, user);
      setPwSuccess("Palavra-passe alterada com sucesso.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err: any) { setPwError(mapError(err, "Não foi possível alterar a palavra-passe.")); } finally { setPwLoading(false); }
  };

  if (!user) return <div className="flex items-center justify-center py-16 text-sm text-docid-muted">A carregar perfil...</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Perfil" description="Gerir os seus dados pessoais" />
      <div className="docid-panel p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-docid-primary/15 text-2xl font-bold text-docid-primary-soft">{initials(user.fullName)}</div>
          <div>
            <p className="text-lg font-semibold">{user.fullName}</p>
            <p className="text-sm text-docid-muted">{user.email}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-docid-muted">Organização</p>
            <p className="font-medium">{user.organization || "-"}</p>
          </div>
          <div>
            <p className="text-xs text-docid-muted">Sector</p>
            <p className="font-medium">{user.sectorName || "—"}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-docid-muted">Funções de acesso</p>
            <p className="font-medium">{user.roles.map(friendlyRole).join(", ") || "—"}</p>
          </div>
        </div>
      </div>

      <div className="docid-panel p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold mb-4"><User className="h-4 w-4" /> Editar Nome</h2>
        <div className="flex items-end gap-3">
          <div className="flex-1"><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nome completo</label><input value={fullName} onChange={e => setFullName(e.target.value)} className="docid-input w-full" /></div>
          <button onClick={handleSaveName} disabled={saving || !fullName.trim() || fullName === user?.fullName} className="docid-button-primary"><Save className="h-4 w-4" /> {saving ? "A guardar..." : "Guardar"}</button>
        </div>
        {saveMsg && <p className="mt-2 text-xs text-docid-secondary">{saveMsg}</p>}
      </div>

      <div className="docid-panel p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold mb-4"><Lock className="h-4 w-4" /> Alterar palavra-passe</h2>
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
          <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Palavra-passe actual</label><input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="docid-input w-full" required /></div>
          <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nova palavra-passe</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="docid-input w-full" required minLength={6} /></div>
          <div><label className="mb-1.5 block text-xs font-semibold text-docid-muted">Confirmar nova palavra-passe</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="docid-input w-full" required /></div>
          {pwError && <p className="text-xs text-docid-error">{pwError}</p>}
          {pwSuccess && <p className="text-xs text-docid-secondary">{pwSuccess}</p>}
          <button type="submit" disabled={pwLoading || !currentPassword || !newPassword || !confirmPassword} className="docid-button-primary">{pwLoading ? "A alterar..." : "Alterar palavra-passe"}</button>
        </form>
      </div>

      <div className="docid-panel p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold mb-4"><Sun className="h-4 w-4" /> Aparência</h2>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Tema</label>
          <div className="flex gap-3">
            <button onClick={() => setTheme("light")} className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition ${theme === "light" ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}><Sun className="h-5 w-5" /> Claro</button>
            <button onClick={() => setTheme("dark")} className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition ${theme === "dark" ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}><Moon className="h-5 w-5" /> Escuro</button>
          </div>
        </div>
      </div>
    </div>
  );
}
