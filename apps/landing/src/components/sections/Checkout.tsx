import { useEffect, useState, type FormEvent } from "react";
import { Check, CreditCard, Loader2 } from "lucide-react";
import ComparisonBlock from "@/components/ui/comparison-3";
import { Reveal } from "@/components/Reveal";

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "https://didall.milvendas.ao";

type Plan = {
  id: string; name: string; price: number; maxUsers: number;
  monthlyOnlineIdentifiers: number; offlineBudgetPerMachine: number;
};

type Method = "multicaixa" | "transfer" | "send_order";

export function Checkout() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [planId, setPlanId] = useState("");
  const [method, setMethod] = useState<Method>("transfer");
  const [phone, setPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [slug, setSlug] = useState("");
  const [tenantEmail, setTenantEmail] = useState("");
  const [tenantName, setTenantName] = useState("");
  // Clientes novos (sem conta) são o caso por omissão: quem chega pelo site ainda não usa o DocID.
  const [existing, setExisting] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [sentAsLead, setSentAsLead] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("pedido");
    if (token) {
      fetch(`${API}/subscriptions/checkout?token=${encodeURIComponent(token)}`)
        .then(async (r) => {
          if (!r.ok) throw new Error("Não foi possível verificar o link. Tente novamente.");
          const data = await r.json();
          setTenantName(data.tenantName || "");
        })
        .catch(() => setError("Não foi possível verificar o link. Tente novamente."));
    }
    fetch(`${API}/plans`)
      .then((r) => r.json())
      .then((d) => {
        const available: Plan[] = (d.plans || []).filter((p: Plan) => p.price > 0);
        setPlans(available);
        setPlansLoaded(true);
        const chosen = new URLSearchParams(window.location.search).get("plano");
        const match = available.find((p) => p.name.toLowerCase() === (chosen || "").toLowerCase());
        if (match) setPlanId(match.id);
      })
      .catch(() => { setPlansLoaded(true); setError("Não foi possível carregar os planos."); });
  }, []);

  const choosePlan = (name: string) => {
    const match = plans.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!match) return;
    setPlanId(match.id);
    window.history.replaceState(null, "", `?plano=${encodeURIComponent(name)}#pedido`);
    document.getElementById("pedido")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(""); setBusy(true);
    const token = new URLSearchParams(window.location.search).get("pedido");
    const body: Record<string, string> = {
      planId,
      paymentMethod: method,
      phone,
      contactEmail,
    };
    const lead = !token && !existing;
    if (token) body.token = token;
    else if (lead) {
      body.companyName = companyName.trim();
      if (contactName.trim()) body.contactName = contactName.trim();
    } else if (slug) body.tenantSlug = slug;
    else body.tenantEmail = tenantEmail;
    try {
      const res = await fetch(`${API}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = data?.error?.code === "VALIDATION_ERROR" ? null : data?.error?.message;
        throw new Error(message || "Não foi possível enviar o pedido. Verifique os dados e tente novamente.");
      }
      setSentAsLead(lead);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Não foi possível enviar o pedido. Verifique os dados e tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="planos" className="scroll-mt-20">
    <Reveal className="mx-auto max-w-5xl px-6 py-20" delay={0.04}>
      <div className="mb-10 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-docid-secondary">Planos</p>
        <h2 className="mt-3 text-[clamp(1.9rem,3.8vw,2.9rem)] font-semibold">Pedido de subscrição</h2>
        <p className="mx-auto mt-3 max-w-[60ch] text-sm leading-relaxed text-docid-muted">
          Compare os planos abaixo, escolha o que pretende e envie o pedido. A MilVendas confirma o pagamento e activa a licença. Todos os valores em kwanzas.
        </p>
      </div>

      <ComparisonBlock
        onChoosePlan={choosePlan}
        prices={plansLoaded ? Object.fromEntries(plans.map((p) => [p.name.toLowerCase(), p.price])) : undefined}
      />

      <div className="mx-auto mt-12 max-w-3xl">
        {done ? (
          <div data-testid="checkout-success" className="docid-panel p-8 text-center">
            <Check className="mx-auto h-8 w-8 text-docid-secondary" aria-hidden="true" />
            <h3 className="mt-4 text-lg font-semibold">Pedido recebido</h3>
            <p className="mt-2 text-sm text-docid-muted">
              {sentAsLead
                ? "A equipa MilVendas vai contactá-lo pelo telefone ou e-mail indicados para criar a conta da sua empresa e combinar o pagamento."
                : "A MilVendas vai confirmar o pagamento e activar a sua licença. Receberá um e-mail com a confirmação."}
            </p>
          </div>
        ) : (
          <form id="pedido" onSubmit={submit} className="space-y-5" data-testid="checkout-form">
            <div className="docid-panel p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-docid-muted">Plano escolhido</p>
              {planId ? (
                <p data-testid="checkout-selected-plan" className="mt-1.5 text-xl font-semibold text-docid-text">
                  {plans.find((p) => p.id === planId)?.name ?? "Plano seleccionado"}
                </p>
              ) : (
                <p className="mt-1.5 text-sm text-docid-muted">Escolha um plano na tabela comparativa acima.</p>
              )}
            </div>

            <div className="docid-panel space-y-5 p-5 sm:p-6">
              <div>
                <h3 className="text-base font-semibold text-docid-text">Dados para o pedido</h3>
                <p className="mt-1 text-xs text-docid-muted">Indique a empresa e como quer ser contactado.</p>
              </div>

              {!tenantName && (
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold uppercase tracking-wider text-docid-muted">Já usa o DocID?</legend>
                  <div className="flex flex-wrap gap-2">
                    {([[false, "Ainda não"], [true, "Sim, a minha empresa já tem conta"]] as Array<[boolean, string]>).map(([value, label]) => (
                      <button key={label} type="button" data-testid={value ? "checkout-existing" : "checkout-new"} aria-pressed={existing === value}
                        onClick={() => setExisting(value)}
                        className={`min-h-11 rounded-lg border px-4 text-sm font-medium transition ${existing === value ? "border-docid-primary bg-docid-primary/10 text-docid-text ring-1 ring-docid-primary" : "border-docid-border bg-docid-surface-lowest text-docid-muted hover:border-docid-primary/50 hover:text-docid-text"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}

              {!tenantName && !existing && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-docid-text">Empresa</span>
                    <input data-testid="checkout-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="docid-input" placeholder="Nome da empresa" required minLength={2} maxLength={160} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-docid-text">O seu nome</span>
                    <input data-testid="checkout-contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} className="docid-input" placeholder="Nome e apelido" maxLength={120} />
                  </label>
                </div>
              )}

              {tenantName && <p className="rounded-lg bg-docid-surface-low px-4 py-3 text-sm text-docid-text">Organização: <strong>{tenantName}</strong></p>}
              {!tenantName && existing && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-docid-text">Identificador da organização</span>
                    <input data-testid="checkout-slug" value={slug} onChange={(e) => { setSlug(e.target.value); setTenantEmail(""); }} className="docid-input" placeholder="minha-empresa" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-docid-text">E-mail da organização</span>
                    <input data-testid="checkout-tenant-email" type="email" value={tenantEmail} onChange={(e) => { setTenantEmail(e.target.value); setSlug(""); }} className="docid-input" placeholder="admin@empresa.com" />
                  </label>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-docid-text">Telefone</span>
                  <input data-testid="checkout-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="docid-input" placeholder="9XX XXX XXX" required />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-docid-text">E-mail de contacto</span>
                  <input data-testid="checkout-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="docid-input" placeholder="nome@empresa.com" required />
                </label>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold uppercase tracking-wider text-docid-muted">Forma de pagamento</legend>
                <div className="flex flex-wrap gap-2">
                  {(["transfer", "multicaixa", "send_order"] as Method[]).map((m) => (
                    <button key={m} type="button" data-testid="checkout-method" onClick={() => setMethod(m)}
                      className={`min-h-11 rounded-lg border px-4 text-sm font-medium transition ${method === m ? "border-docid-primary bg-docid-primary/10 text-docid-text ring-1 ring-docid-primary" : "border-docid-border bg-docid-surface-lowest text-docid-muted hover:border-docid-primary/50 hover:text-docid-text"}`}>
                      {m === "transfer" ? "Transferência" : m === "multicaixa" ? "Referência Multicaixa" : "Enviar pedido"}
                    </button>
                  ))}
                </div>
              </fieldset>

              {error && <p data-testid="checkout-error" className="text-sm text-docid-error">{error}</p>}
              <button data-testid="checkout-submit" type="submit" disabled={busy || !planId || (!tenantName && (existing ? !slug && !tenantEmail : companyName.trim().length < 2))}
                className="btn-primary flex w-full items-center justify-center gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                {busy ? "A enviar..." : "Enviar pedido"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Reveal>
    </section>
  );
}
