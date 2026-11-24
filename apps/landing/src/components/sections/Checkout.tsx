import { useEffect, useState, type FormEvent } from "react";
import { Check, CreditCard, Loader2 } from "lucide-react";
import { Reveal } from "@/components/Reveal";

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "https://didall.milvendas.ao";

type Plan = {
  id: string; name: string; price: number; maxUsers: number;
  monthlyOnlineIdentifiers: number; offlineBudgetPerMachine: number;
};

type Method = "multicaixa" | "transfer" | "send_order";

export function Checkout() {
  const [plans, setPlans] = useState<Plan[]>([]);
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
      .then((d) => setPlans((d.plans || []).filter((p: Plan) => p.price > 0)))
      .catch(() => setError("Não foi possível carregar os planos."));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(""); setBusy(true);
    const token = new URLSearchParams(window.location.search).get("pedido");
    const body: Record<string, string> = {
      planId,
      paymentMethod: method,
      phone,
      contactEmail,
    };
    if (token) body.token = token;
    else if (slug) body.tenantSlug = slug;
    else body.tenantEmail = tenantEmail;
    try {
      const res = await fetch(`${API}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Não foi possível enviar o pedido. Verifique os dados e tente novamente.");
      setDone(true);
    } catch {
      setError("Não foi possível enviar o pedido. Verifique os dados e tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="planos" className="scroll-mt-20">
    <Reveal className="mx-auto max-w-5xl px-6 py-20" delay={0.04}>
      <div className="mb-10 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-docid-secondary">Planos</p>
        <h2 className="mt-3 text-[clamp(1.9rem,3.8vw,2.9rem)] font-semibold">Escolha o plano para a sua organização</h2>
        <p className="mx-auto mt-3 max-w-[60ch] text-sm leading-relaxed text-docid-muted">
          Envie o pedido; a MilVendas confirma o pagamento e activa a licença. Todos os valores em kwanzas.
        </p>
      </div>

      {done ? (
        <div data-testid="checkout-success" className="docid-panel mx-auto max-w-xl p-8 text-center">
          <Check className="mx-auto h-8 w-8 text-docid-secondary" aria-hidden="true" />
          <h3 className="mt-4 text-lg font-semibold">Pedido recebido</h3>
          <p className="mt-2 text-sm text-docid-muted">A MilVendas vai confirmar o pagamento e activar a sua licença. Receberá um e-mail com a confirmação.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.2fr_1fr]" data-testid="checkout-form">
          <div className="space-y-3">
            {plans.map((p) => (
              <button
                type="button"
                key={p.id}
                data-testid="checkout-plan"
                onClick={() => setPlanId(p.id)}
                className={`docid-panel flex w-full items-center justify-between gap-4 p-4 text-left transition ${planId === p.id ? "border-docid-secondary ring-1 ring-docid-secondary" : ""}`}
              >
                <span>
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block text-xs text-docid-muted">{p.maxUsers} utilizadores · {p.monthlyOnlineIdentifiers} identificadores/mês</span>
                </span>
                <span className="font-mono text-sm">{p.price.toLocaleString("pt-AO")} Kz</span>
              </button>
            ))}
            {plans.length === 0 && !error && <p className="text-sm text-docid-muted">A carregar planos...</p>}
          </div>

          <div className="docid-panel space-y-4 p-5">
            {tenantName && <p className="text-sm text-docid-text">Organização: <strong>{tenantName}</strong></p>}
            {!tenantName && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-docid-muted">Identificador da organização
                  <input data-testid="checkout-slug" value={slug} onChange={(e) => { setSlug(e.target.value); setTenantEmail(""); }} className="docid-input mt-1 w-full" placeholder="minha-empresa" />
                </label>
                <label className="text-xs text-docid-muted">E-mail da organização
                  <input data-testid="checkout-tenant-email" type="email" value={tenantEmail} onChange={(e) => { setTenantEmail(e.target.value); setSlug(""); }} className="docid-input mt-1 w-full" placeholder="admin@empresa.com" />
                </label>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-docid-muted">Telefone
                <input data-testid="checkout-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="docid-input mt-1 w-full" required />
              </label>
              <label className="text-xs text-docid-muted">E-mail de contacto
                <input data-testid="checkout-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="docid-input mt-1 w-full" required />
              </label>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-docid-muted">Forma de pagamento</p>
              <div className="flex flex-wrap gap-2">
                {(["transfer", "multicaixa", "send_order"] as Method[]).map((m) => (
                  <button type="button" key={m} data-testid="checkout-method" onClick={() => setMethod(m)}
                    className={`rounded-lg border px-3 py-2 text-xs transition ${method === m ? "border-docid-secondary bg-docid-secondary/10 text-docid-text" : "border-docid-border text-docid-muted hover:text-docid-text"}`}>
                    {m === "transfer" ? "Transferência" : m === "multicaixa" ? "Referência Multicaixa" : "Enviar pedido"}
                  </button>
                ))}
              </div>
            </div>
            {error && <p data-testid="checkout-error" className="text-xs text-docid-error">{error}</p>}
            <button data-testid="checkout-submit" type="submit" disabled={busy || !planId || (!tenantName && !slug && !tenantEmail)}
              className="btn-primary flex w-full items-center justify-center gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {busy ? "A enviar..." : "Enviar pedido"}
            </button>
          </div>
        </form>
      )}
    </Reveal>
    </section>
  );
}
