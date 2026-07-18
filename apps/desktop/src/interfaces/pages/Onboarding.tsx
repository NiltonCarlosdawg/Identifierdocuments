import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../infrastructure/di/container";
import { Building2, UserCheck, CheckCircle2, ArrowRight, ArrowLeft, FileText, Eye, EyeOff, Lock, Mail, User } from "lucide-react";

type Step = "org" | "admin" | "confirm";

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("org");
  const [orgName, setOrgName] = useState("");
  const [slug, setSlug] = useState("");
  const [prefix, setPrefix] = useState("");
  const [autoSlug, setAutoSlug] = useState(true);
  const [autoPrefix, setAutoPrefix] = useState(true);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleOrgNameChange = (val: string) => {
    setOrgName(val);
    if (autoSlug) setSlug(val.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 63));
    if (autoPrefix) setPrefix(val.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4) || "ORG");
  };

  const canAdvanceToAdmin = orgName.trim().length >= 2 && slug.trim().length >= 2 && prefix.trim().length > 0;
  const canAdvanceToConfirm = adminEmail.includes("@") && adminPassword.length >= 6 && adminPassword === confirmPassword;

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      await api.post("/tenants", {
        name: orgName,
        slug: slug || undefined,
        identifierPrefix: prefix || undefined,
        adminEmail,
        adminPassword,
        adminName: adminName || undefined,
      });

      navigate("/login?created=1", { replace: true });
    } catch (err: any) { setError(err.message || "Erro ao criar organização."); } finally { setLoading(false); }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-docid-background p-6 text-docid-text">
      <div className="pointer-events-none absolute left-[-20%] top-1/4 h-96 w-96 rounded-full bg-docid-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-1/4 right-[-20%] h-96 w-96 rounded-full bg-docid-secondary/10 blur-3xl" />
      <div className="docid-panel relative z-10 w-full max-w-lg p-8 shadow-2xl shadow-black/20">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex items-center gap-2"><FileText className="h-7 w-7 text-docid-primary-soft" /><h1 className="text-xl font-bold text-docid-primary-soft">DocID</h1></div>
          <p className="text-sm text-docid-muted">Criar nova organização</p>
        </div>

        <div className="mb-8 flex items-center justify-center gap-2 text-xs">
          <StepDot active={step === "org"} done={step !== "org"} label="Organização" />
          <div className="h-px w-8 bg-docid-border" />
          <StepDot active={step === "admin"} done={step === "confirm"} label="Administrador" />
          <div className="h-px w-8 bg-docid-border" />
          <StepDot active={step === "confirm"} done={false} label="Confirmar" />
        </div>

        {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}

        {step === "org" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nome da organização</label>
              <div className="relative"><Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input value={orgName} onChange={e => handleOrgNameChange(e.target.value)} className="docid-input w-full pl-10" placeholder="Ex: Verano Labs" autoFocus /></div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Slug <span className="font-normal text-docid-outline">(URL da organização)</span></label>
              <input value={slug} onChange={e => { setSlug(e.target.value); setAutoSlug(false); }} className="docid-input w-full font-mono text-xs" placeholder="verano-labs" />
              {autoSlug && <p className="mt-1 text-xs text-docid-muted">Gerado automaticamente.</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Prefixo do identificador <span className="font-normal text-docid-outline">(máx. 6 caracteres)</span></label>
              <input value={prefix} onChange={e => { setPrefix(e.target.value.toUpperCase().slice(0, 6)); setAutoPrefix(false); }} className="docid-input w-full font-mono text-sm uppercase" placeholder="VL" maxLength={6} />
              {autoPrefix && <p className="mt-1 text-xs text-docid-muted">Gerado automaticamente.</p>}
            </div>
            <div className="flex justify-end pt-4">
              <button onClick={() => setStep("admin")} disabled={!canAdvanceToAdmin} className="docid-button-primary">Avançar <ArrowRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}

        {step === "admin" && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Nome do administrador</label>
              <div className="relative"><User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input value={adminName} onChange={e => setAdminName(e.target.value)} className="docid-input w-full pl-10" placeholder="Ex: João Silva" autoFocus /></div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-docid-muted">E-mail corporativo</label>
              <div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} className="docid-input w-full pl-10" placeholder="admin@empresa.com" /></div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Palavra-passe <span className="font-normal text-docid-outline">(mín. 6 caracteres)</span></label>
              <div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input type={showPassword ? "text" : "password"} value={adminPassword} onChange={e => setAdminPassword(e.target.value)} className="docid-input w-full pl-10 pr-10" placeholder="••••••••" /><button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-docid-outline transition hover:text-docid-text">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Confirmar palavra-passe</label>
              <div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" /><input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={`docid-input w-full pl-10 ${confirmPassword && confirmPassword !== adminPassword ? "border-docid-error" : ""}`} placeholder="••••••••" /></div>
              {confirmPassword && confirmPassword !== adminPassword && <p className="mt-1 text-xs text-docid-error">As palavras-passe não coincidem.</p>}
            </div>
            <div className="flex justify-between pt-4">
              <button onClick={() => setStep("org")} className="docid-button-secondary"><ArrowLeft className="h-4 w-4" /> Voltar</button>
              <button onClick={() => setStep("confirm")} disabled={!canAdvanceToConfirm} className="docid-button-primary">Rever <ArrowRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-docid-border bg-docid-surface-low p-4 space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-docid-text"><Building2 className="h-4 w-4 text-docid-primary-soft" /> Organização</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><p className="text-xs text-docid-muted">Nome</p><p className="font-medium">{orgName}</p></div>
                <div><p className="text-xs text-docid-muted">Slug</p><p className="font-mono text-xs">{slug}</p></div>
                <div><p className="text-xs text-docid-muted">Prefixo</p><p className="font-mono text-xs">{prefix}</p></div>
              </div>
              <div className="border-t border-docid-border pt-3">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-docid-text"><UserCheck className="h-4 w-4 text-docid-primary-soft" /> Administrador</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><p className="text-xs text-docid-muted">Nome</p><p className="font-medium">{adminName || "Administrador"}</p></div>
                  <div><p className="text-xs text-docid-muted">Email</p><p className="font-medium">{adminEmail}</p></div>
                </div>
              </div>
            </div>
            <div className="flex justify-between pt-4">
              <button onClick={() => setStep("admin")} className="docid-button-secondary"><ArrowLeft className="h-4 w-4" /> Voltar</button>
              <button onClick={handleSubmit} disabled={loading} className="docid-button-primary">{loading ? "A criar..." : "Criar organização"} <CheckCircle2 className="h-4 w-4" /></button>
            </div>
          </div>
        )}

        <div className="mt-8 border-t border-docid-border pt-6 text-center">
          <p className="text-xs text-docid-muted">Já tem conta? <button onClick={() => navigate("/login")} className="font-semibold text-docid-primary-soft hover:underline">Entrar</button></p>
          <p className="mt-4 text-xs uppercase tracking-wider text-docid-outline">© 2026 <span className="font-semibold text-docid-muted">VERANO Labs</span> · Luanda, Angola</p>
        </div>
      </div>
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  let cls = "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition ";
  if (done) cls += "bg-docid-secondary text-white";
  else if (active) cls += "border-2 border-docid-primary text-docid-primary";
  else cls += "border border-docid-border text-docid-muted";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cls}>{done ? <CheckCircle2 className="h-3.5 w-3.5" /> : active ? "•" : ""}</div>
      <span className="text-[10px] text-docid-muted">{label}</span>
    </div>
  );
}
