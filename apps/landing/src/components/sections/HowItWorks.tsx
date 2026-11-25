import { Reveal } from "@/components/Reveal";

const STEPS = [
  {
    title: "Instale e entre",
    body: "Descarregue o instalador, abra a aplicação e entre com a conta que a organização criou para si.",
  },
  {
    title: "Emita o identificador",
    body: "Escolha a categoria, anexe o ficheiro ou digitalize. O identificador é gerado nesse momento.",
  },
  {
    title: "Envie para aprovação",
    body: "O sector responsável aprova o acesso. A auditoria regista o pedido, a decisão e quem consultou.",
  },
];

export function HowItWorks() {
  return (
    <section aria-labelledby="como-funciona-titulo" className="relative bg-docid-bg">
      <div className="shell py-24 sm:py-28">
        <Reveal className="max-w-2xl">
          <h2 id="como-funciona-titulo" className="text-[clamp(1.9rem,3.8vw,2.9rem)] font-semibold text-docid-text">
            Do instalador ao primeiro identificador
          </h2>
          <p className="mt-5 text-base leading-relaxed text-docid-muted">
            Três passos. O primeiro é o único que depende de ficheiros; os outros dois acontecem dentro da aplicação.
          </p>
        </Reveal>

        <ol className="mt-14 grid gap-10 border-t border-docid-border pt-10 sm:grid-cols-3 sm:gap-8">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Reveal delay={i * 0.08}>
                <span className="font-mono text-xs text-docid-muted">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 font-display text-lg font-semibold tracking-tight text-docid-text">{step.title}</h3>
                <p className="mt-2 max-w-[36ch] text-sm leading-relaxed text-docid-muted">{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
