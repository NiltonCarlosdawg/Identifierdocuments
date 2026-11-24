import { Plus } from "lucide-react";
import { Reveal } from "@/components/Reveal";

const QUESTIONS = [
  {
    q: "Preciso de internet para usar o DocID?",
    a: "Sim, para entrar e sincronizar. O trabalho em curso fica reservado enquanto decorre a sincronização, por isso uma falha de rede não duplica documentos nem deixa dois postos a gravar por cima um do outro.",
  },
  {
    q: "Onde ficam os dados da minha empresa?",
    a: "Na base de dados da organização, com cada registo separado por organização. Cada pedido é autenticado e limitado à organização a que pertence.",
  },
  {
    q: "Quantas pessoas podem usar?",
    a: "A conta pertence à organização. O número de utilizadores e de sectores é acordado com a equipa que instala o DocID, antes de abrir o acesso à equipa.",
  },
  {
    q: "Funciona em Mac ou Linux?",
    a: "Sim, em Linux: há um pacote .deb para Ubuntu 22.04 e compatíveis (64 bits). Windows 10 e 11, 64 bits, tem instalador completo. A versão para macOS está em preparação e será publicada na mesma página.",
  },
  {
    q: "Como actualizo a aplicação?",
    a: "A aplicação verifica actualizações ao arrancar e instala a versão mais recente. Também pode descarregar o instalador por cima da versão antiga: os dados ficam no servidor e a sessão mantém-se.",
  },
  {
    q: "O que é um identificador DocID?",
    a: "Um código único com o prefixo da organização, a categoria, a data e uma sequência diária. Por exemplo, VL-PROP-2026-1118-001: organização VL, categoria Propostas, 18 de Novembro de 2026, primeiro documento do dia.",
  },
];

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
              {QUESTIONS.map((item) => (
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
