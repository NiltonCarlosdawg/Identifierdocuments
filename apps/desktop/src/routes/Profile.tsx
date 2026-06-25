import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { useAppConfigStore } from "../stores/config";
import { api, getMe } from "../services/api";
import { Camera, CheckCircle, Lock, LogOut, Save, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "../components/docid-ui";

interface MeData {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  tenantId: string;
  sectorId: string | null;
  sectorName: string | null;
  organizationName: string | null;
  roles: string[];
  createdAt: string;
}

export default function Profile() {
  const authUser = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const avatar = useAppConfigStore((s) => s.avatar);
  const setAvatar = useAppConfigStore((s) => s.setAvatar);
  const [tab, setTab] = useState<"personal" | "settings">("personal");
  const [profile, setProfile] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState({ current: "", newPass: "", confirm: "" });
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    getMe().then((res) => {
      if (res.data) {
        setProfile(res.data as MeData);
        setEditName((res.data as MeData).fullName);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    setPreview(null);
  }, [tab]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Seleccione um ficheiro de imagem."); return; }
    if (file.size > 2 * 1024 * 1024) { alert("A imagem deve ter no máximo 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setPreview(result);
      setAvatar(result);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAvatar = () => {
    setPreview(null);
    setAvatar(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSaveName = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await api.patch<{ data: { id: string; fullName: string; email: string } }>("/auth/me", { fullName: editName.trim() });
      if (res.data) {
        setProfile((p) => p ? { ...p, fullName: res.data!.fullName } : p);
        if (token) login(token, { ...authUser!, fullName: res.data!.fullName });
        showToast("Nome actualizado com sucesso.");
      }
    } catch (err: any) {
      showToast(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);
    if (passwords.newPass !== passwords.confirm) { setPasswordError("As palavras-passe não coincidem."); return; }
    if (passwords.newPass.length < 6) { setPasswordError("A palavra-passe deve ter pelo menos 6 caracteres."); return; }
    try {
      await api.patch("/auth/me/password", { currentPassword: passwords.current, newPassword: passwords.newPass });
      setPasswords({ current: "", newPass: "", confirm: "" });
      setPasswordSuccess(true);
      showToast("Palavra-passe alterada com sucesso.");
    } catch (err: any) {
      setPasswordError(err.message);
    }
  };

  const handleLogout = async () => {
    const { syncService } = await import("../services/sync");
    await syncService.clearCredentials();
    logout();
    navigate("/login");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-docid-muted">A carregar perfil...</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Perfil do Utilizador" description="Gerencie as suas informações pessoais e configurações da conta." />

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <aside className="docid-panel p-6 text-center">
          <div className="relative mx-auto h-24 w-24">
            {preview || avatar ? (
              <img src={preview || avatar || ""} alt="Avatar" className="h-24 w-24 rounded-full object-cover" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-docid-surface-high text-2xl font-semibold text-docid-primary-soft">
                {(profile?.fullName || authUser?.fullName || "AD").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-0 right-0 rounded-full bg-docid-primary p-2 text-white transition hover:brightness-110"
            >
              <Camera className="h-4 w-4" />
            </button>
          </div>
          {(preview || avatar) && (
            <button onClick={handleRemoveAvatar} className="mt-2 flex items-center gap-1 text-xs text-docid-error transition hover:underline">
              <Trash2 className="h-3 w-3" /> Remover avatar
            </button>
          )}

          <h2 className="mt-4 text-xl font-semibold">{profile?.fullName || authUser?.fullName}</h2>
          <p className="text-sm text-docid-muted">{profile?.email || authUser?.email}</p>

          <div className="mt-5 space-y-3 text-left">
            <div className="rounded-lg border border-docid-border bg-docid-surface-lowest p-3">
              <p className="text-xs uppercase tracking-wider text-docid-muted">Cargo</p>
              <p className="mt-1 font-medium">
                {profile?.roles?.[0]?.replace(/_/g, " ") || authUser?.roles?.[0]?.replace(/_/g, " ") || "Membro"}
              </p>
            </div>
            <div className="rounded-lg border border-docid-border bg-docid-surface-lowest p-3">
              <p className="text-xs uppercase tracking-wider text-docid-muted">Sector</p>
              <p className="mt-1 font-medium">{profile?.sectorName || "—"}</p>
            </div>
            <div className="rounded-lg border border-docid-border bg-docid-surface-lowest p-3">
              <p className="text-xs uppercase tracking-wider text-docid-muted">Organização</p>
              <p className="mt-1 font-medium">{profile?.organizationName || authUser?.organization || "—"}</p>
            </div>
            <div className="rounded-lg border border-docid-border bg-docid-surface-lowest p-3">
              <p className="text-xs uppercase tracking-wider text-docid-muted">Membro desde</p>
              <p className="mt-1 font-medium">
                {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString("pt-AO", { year: "numeric", month: "long", day: "numeric" }) : "—"}
              </p>
            </div>
          </div>
        </aside>

        <main className="docid-panel overflow-hidden">
          <div className="flex border-b border-docid-border">
            <button
              onClick={() => setTab("personal")}
              className={`px-6 py-4 text-sm font-semibold transition ${tab === "personal" ? "border-b-2 border-docid-primary text-docid-primary-soft" : "text-docid-muted"}`}
            >
              Informações Pessoais
            </button>
            <button
              onClick={() => setTab("settings")}
              className={`px-6 py-4 text-sm font-semibold transition ${tab === "settings" ? "border-b-2 border-docid-primary text-docid-primary-soft" : "text-docid-muted"}`}
            >
              Configurações
            </button>
          </div>

          {tab === "personal" ? (
            <div className="p-6">
              <h2 className="mb-5 text-lg font-semibold">Informações Pessoais</h2>
              <div className="max-w-lg space-y-5">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Nome Completo</label>
                  <div className="flex gap-2">
                    <input
                      className="docid-input flex-1"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Nome completo"
                    />
                    <button
                      onClick={handleSaveName}
                      disabled={saving || editName === (profile?.fullName || authUser?.fullName)}
                      className="docid-button-primary"
                    >
                      {saving ? "A guardar..." : <><Save className="h-4 w-4" /> Guardar</>}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Endereço de Email</label>
                  <input
                    className="docid-input w-full opacity-60"
                    readOnly
                    value={profile?.email || authUser?.email || ""}
                  />
                  <p className="mt-1 text-xs text-docid-muted">* Contacte o administrador para alterar o email.</p>
                </div>

                <div className="rounded-lg border border-docid-border bg-docid-surface-lowest p-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-docid-secondary" />
                    <span className="text-sm font-medium">Conta activa</span>
                  </div>
                  <p className="mt-1 text-xs text-docid-muted">A sua conta está verificada e com acesso normal ao sistema.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-8 p-6">
              <section>
                <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold"><Lock className="h-5 w-5 text-docid-primary-soft" /> Segurança</h2>
                <form onSubmit={handleChangePassword} className="max-w-md space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Palavra-passe Actual</label>
                    <input
                      className="docid-input w-full"
                      type="password"
                      value={passwords.current}
                      onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Nova Palavra-passe</label>
                      <input
                        className="docid-input w-full"
                        type="password"
                        value={passwords.newPass}
                        onChange={(e) => setPasswords({ ...passwords, newPass: e.target.value })}
                        placeholder="Mínimo 6 caracteres"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Confirmar</label>
                      <input
                        className="docid-input w-full"
                        type="password"
                        value={passwords.confirm}
                        onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                        placeholder="Repita a palavra-passe"
                      />
                    </div>
                  </div>
                  {passwordError && <p className="text-sm text-docid-error">{passwordError}</p>}
                  {passwordSuccess && (
                    <div className="flex items-center gap-2 text-sm text-docid-secondary">
                      <CheckCircle className="h-4 w-4" /> Palavra-passe alterada com sucesso.
                    </div>
                  )}
                  <button type="submit" className="docid-button-primary">
                    <Lock className="h-4 w-4" /> Alterar Palavra-passe
                  </button>
                </form>
              </section>

              <section className="border-t border-docid-border pt-6">
                <h2 className="mb-5 text-lg font-semibold">Preferências de Notificação</h2>
                <div className="space-y-3">
                  {["Notificações por Email", "Alertas de Sistema"].map((label) => (
                    <label key={label} className="flex cursor-pointer items-center justify-between rounded-lg border border-docid-border bg-docid-surface-lowest p-4">
                      <span className="text-sm font-medium">{label}</span>
                      <input type="checkbox" defaultChecked className="h-5 w-5 rounded border-docid-border bg-docid-surface-low text-docid-primary" />
                    </label>
                  ))}
                </div>
              </section>

              <section className="border-t border-docid-border pt-6">
                <h2 className="mb-4 text-lg font-semibold text-docid-error">Zona de Perigo</h2>
                <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-docid-text">Terminar Sessão</p>
                      <p className="text-sm text-docid-muted">Encerra a sua sessão e sai da aplicação.</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2 rounded-lg border border-docid-error/50 bg-docid-error px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                    >
                      <LogOut className="h-4 w-4" /> Sair
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2 rounded-xl border border-docid-secondary/30 bg-docid-surface px-4 py-3 text-sm text-docid-secondary shadow-xl">
          <CheckCircle className="h-4 w-4" />{toast}
        </div>
      )}
    </div>
  );
}
