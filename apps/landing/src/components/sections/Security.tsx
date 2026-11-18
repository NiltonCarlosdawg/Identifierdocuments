import { Reveal } from "@/components/Reveal";

const FACTS = [
  {
    title: "Isolamento por organização",
    body: "Cada organização tem o seu próprio espaço na base de dados, com políticas de acesso ao nível da linha. Uma consulta de outra organização não devolve registos.",
  },
  {
    title: "Permissões por sector",
    body: "Documentos restritos exigem um pedido aprovado. A permissão fica registada com autor, data e documento.",
  },
  {
    title: "Registo de auditoria",
    body: "Emissões, aprovações, downloads e alterações ficam guardados por organização e consultáveis na aplicação.",
  },
];

export function Security() {
  return (
    <section id="seguranca" aria-labelledby="seguranca-titulo" className="on-dark relative isolate overflow-hidden bg-docid-bg">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_50%_at_15%_0%,rgba(37,99,235,0.16),transparent_65%)]"
      />
      <div className="shell py-24 sm:py-28">
        <Reveal className="max-w-3xl">
          <h2 id="seguranca-titulo" className="text-[clamp(1.9rem,3.8vw,2.9rem)] font-semibold text-docid-text">
            O isolamento está na base de dados, não só na aplicação.
          </h2>
          <p className="mt-6 max-w-[60ch] text-base leading-relaxed text-docid-muted">
            A aplicação autentica o pedido e a base de dados limita o que esse pedido pode ler. Duas barreiras, não uma.
          </p>
        </Reveal>

        <dl className="mt-14 grid gap-10 border-t border-docid-border pt-10 sm:grid-cols-3 sm:gap-8">
          {FACTS.map((fact, i) => (
            <Reveal key={fact.title} delay={i * 0.08}>
              <dt className="font-display text-base font-semibold tracking-tight text-docid-text">{fact.title}</dt>
              <dd className="mt-2 max-w-[38ch] text-sm leading-relaxed text-docid-muted">{fact.body}</dd>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}
