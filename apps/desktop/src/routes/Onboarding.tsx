import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { ArrowRight, Building2, Check, Fingerprint, Lock, ShieldCheck } from "lucide-react";

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: "",
    adminEmail: "",
    adminPassword: "",
    adminName: "",
    identifierPrefix: "DOC",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [provisioned, setProvisioned] = useState(false);
  const navigate = useNavigate();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/tenants", {
        name: form.name,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
        adminName: form.adminName || "Administrador",
        identifierPrefix: form.identifierPrefix || "DOC",
      });
      const loginRes: any = await api.post("/auth/login", {
        email: form.adminEmail,
        password: form.adminPassword,
      });
      const { useAuthStore } = await import("../stores/auth");
      const { syncService } = await import("../services/sync");
      useAuthStore.getState().login(loginRes.data.token, loginRes.data.user);
      await syncService.setCredentials(loginRes.data.token);
      setProvisioned(true);
    } catch (err: any) {
      setError(err.message || "Erro ao criar organização");
    } finally {
      setLoading(false);
    }
  };

  const preview = `${form.identifierPrefix || "DOC"}-PROP-${new Date().getFullYear()}-XXXX-001`;

  const canNext1 = form.name.length >= 2;
  const canNext2 = form.identifierPrefix.length >= 2;
  const canFinish = form.adminEmail.length > 0 && form.adminPassword.length >= 6;

  return (
    <div className="min-h-screen bg-docid-background px-6 py-8 text-docid-text">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Fingerprint className="h-7 w-7 text-docid-primary-soft" />
            <div>
              <p className="font-semibold text-docid-text">DocID</p>
              <p className="text-xs text-docid-muted">Configuração inicial</p>
            </div>
          </div>
          <span className="rounded-full border border-docid-border px-3 py-1 text-xs text-docid-muted">
            Passo {step} de 3
          </span>
        </header>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="docid-panel-low p-5">
            {[
              ["01", "Identidade Organizacional"],
              ["02", "Padrão de Identificadores"],
              ["03", "Administrador Inicial"],
            ].map(([number, label], index) => (
              <div key={number} className="mb-5 flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${
                  step > index + 1 || provisioned
                    ? "border-docid-secondary bg-docid-secondary/15 text-docid-secondary"
                    : step === index + 1
                    ? "border-docid-primary bg-docid-primary text-white"
                    : "border-docid-border text-docid-muted"
                }`}>
                  {step > index + 1 || provisioned ? <Check className="h-4 w-4" /> : number}
                </div>
                <span className={step === index + 1 ? "text-docid-text" : "text-docid-muted"}>{label}</span>
              </div>
            ))}
            <p className="mt-8 text-sm leading-6 text-docid-muted">
              Defina a identidade da organização, o padrão de identificadores e a conta administradora inicial.
            </p>
          </aside>

          <main className="docid-panel p-8">
            {provisioned ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-docid-secondary/15 text-docid-secondary">
                  <ShieldCheck className="h-10 w-10" />
                </div>
                <h1 className="text-3xl font-semibold">Organização Criada</h1>
                <p className="mt-3 max-w-md text-sm text-docid-muted">
                  A instância empresarial foi configurada com sucesso. O sector raiz "Administração" e a conta administradora foram criados.
                </p>
                <div className="mt-8 grid w-full max-w-md grid-cols-2 gap-3">
                  <div className="docid-panel-low p-4">
                    <p className="text-xs uppercase tracking-wider text-docid-muted">Prefixo</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-docid-primary-soft">
                      {form.identifierPrefix || "DOC"}
                    </p>
                  </div>
                  <div className="docid-panel-low p-4">
                    <p className="text-xs uppercase tracking-wider text-docid-muted">Primeiro Sector</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-docid-primary-soft">ADM</p>
                  </div>
                </div>
                <button onClick={() => navigate("/")} className="docid-button-primary mt-8">
                  Aceder ao Sistema <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <form onSubmit={create}>
                {step === 1 && (
                  <section>
                    <h1 className="text-3xl font-semibold">Identidade da Organização</h1>
                    <p className="mt-2 text-sm text-docid-muted">
                      Defina o nome oficial da organização. Este nome será usado em todos os documentos e auditorias.
                    </p>
                    <div className="mt-8 grid gap-5">
                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">
                          Nome da Organização
                        </span>
                        <div className="relative">
                          <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" />
                          <input
                            className="docid-input w-full pl-10"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="Nome da empresa"
                            minLength={2}
                          />
                        </div>
                      </label>
                    </div>
                  </section>
                )}

                {step === 2 && (
                  <section>
                    <h1 className="text-3xl font-semibold">Padrão de Identificadores</h1>
                    <p className="mt-2 text-sm text-docid-muted">
                      O prefixo identifica a sua organização nos códigos únicos. Escolha um código curto e único (2 a 5 letras).
                    </p>
                    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_280px]">
                      <div className="space-y-5">
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">
                            Prefixo da Organização
                          </span>
                          <input
                            className="docid-input w-full text-lg font-semibold uppercase"
                            maxLength={5}
                            minLength={2}
                            value={form.identifierPrefix}
                            onChange={(e) => setForm({ ...form, identifierPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })}
                          />
                          <p className="mt-1 text-xs text-docid-muted">
                            Ex: DOC → DOC-PROP-2026-0625-001
                          </p>
                        </label>
                        <div className="docid-panel-low p-5">
                          <p className="font-semibold">Formato do Identificador</p>
                          <p className="mt-2 text-sm leading-6 text-docid-muted">
                            O prefixo é concatenado com o código da categoria, ano, data e sequência sequencial para gerar códigos permanentes e auditáveis.
                          </p>
                        </div>
                      </div>
                      <div className="docid-panel-low p-5">
                        <p className="text-xs uppercase tracking-wider text-docid-muted">Pré-visualização</p>
                        <p className="mt-4 break-all font-mono text-xl font-semibold text-docid-primary-soft">{preview}</p>
                        <div className="mt-5 space-y-2 text-xs text-docid-muted">
                          <p>
                            PREFIXO: <span className="text-docid-text">{form.identifierPrefix || "DOC"}</span>
                          </p>
                          <p>CATEGORIA: <span className="text-docid-text">PROP</span></p>
                          <p>ANO: <span className="text-docid-text">{new Date().getFullYear()}</span></p>
                          <p>SEQ: <span className="text-docid-text">AUTO</span></p>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {step === 3 && (
                  <section>
                    <h1 className="text-3xl font-semibold">Administrador Inicial</h1>
                    <p className="mt-2 text-sm text-docid-muted">
                      Crie a conta de administrador. Esta pessoa terá acesso total à organização.
                    </p>
                    <div className="mt-8 grid gap-5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">
                            Nome Completo
                          </span>
                          <input
                            className="docid-input w-full"
                            value={form.adminName}
                            onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                            placeholder="Nome do administrador"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">
                            Email
                          </span>
                          <input
                            className="docid-input w-full"
                            type="email"
                            value={form.adminEmail}
                            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                            placeholder="admin@empresa.com"
                            required
                          />
                        </label>
                      </div>
                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">
                          Palavra-passe
                        </span>
                        <input
                          className="docid-input w-full"
                          type="password"
                          value={form.adminPassword}
                          onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                          placeholder="Mínimo 6 caracteres"
                          minLength={6}
                          required
                        />
                      </label>
                      <div className="rounded-xl border border-dashed border-docid-border bg-docid-surface-lowest p-4 text-sm text-docid-muted">
                        <p>
                          <strong>Nota:</strong> O sector <strong>"Administração"</strong> (ADM) será criado automaticamente.
                          Após o registo, pode criar mais sectores e utilizadores a partir das configurações.
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                {error && (
                  <p className="mt-5 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">
                    {error}
                  </p>
                )}

                <div className="mt-8 flex justify-between gap-3 border-t border-docid-border pt-5">
                  <button
                    type="button"
                    onClick={() => step === 1 ? navigate("/login") : setStep(step - 1)}
                    className="docid-button-secondary"
                  >
                    {step === 1 ? "Já tenho conta" : "Voltar"}
                  </button>
                  {step < 3 ? (
                    <button
                      type="button"
                      disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
                      onClick={() => setStep(step + 1)}
                      className="docid-button-primary"
                    >
                      Próximo <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={loading || !canFinish}
                      className="docid-button-primary"
                    >
                      {loading ? "A criar..." : "Concluir Configuração"} <Lock className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </form>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
