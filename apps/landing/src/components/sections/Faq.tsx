import { Plus } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { FAQ } from "@/content/faq";


export function Faq() {
  return (
    <section id="perguntas" aria-labelledby="perguntas-titulo" className="relative bg-docid-surface-low">
      <div className="shell py-24 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <Reveal>
            <h2 id="perguntas-titulo" className="text-[clamp(1.9rem,3.8vw,2.9rem)] font-semibold text-docid-text">
              Perguntas antes de instalar
            </h2>
            <p className="mt-5 max-w-[38ch] text-base leading-relaxed text-docid-muted">
              Se ficar alguma dúvida, fale com o administrador do DocID na sua empresa. É ele que cria as contas e os
              sectores.
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="border-t border-docid-border">
              {FAQ.map((item) => (
                <details key={item.q} className="group border-b border-docid-border">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
                    <span className="font-display text-base font-semibold tracking-tight text-docid-text">
                      {item.q}
                    </span>
                    <Plus
                      className="mt-0.5 h-4 w-4 shrink-0 text-docid-muted transition-transform duration-300 ease-out-expo group-open:rotate-45"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="max-w-[62ch] pb-5 text-sm leading-relaxed text-docid-muted">{item.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
