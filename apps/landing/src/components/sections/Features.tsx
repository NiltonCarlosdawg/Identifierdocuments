import { Check, ScanLine, ShieldCheck, Workflow } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/utils";

function Tile({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-[14px] border border-docid-border bg-docid-surface p-6 sm:p-7", className)}>
      {children}
    </div>
  );
}

function TileTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display text-lg font-semibold tracking-tight text-docid-text">{children}</h3>;
}

const LOG = [
  { time: "09:42", text: "Ana M. emitiu VL-PROP-2026-1118-001" },
  { time: "09:51", text: "Júri aprovou pedido de acesso · Direcção" },
  { time: "10:03", text: "Carlos T. descarregou contrato-servico.pdf" },
];

const CHIPS = ["VL-PROP-2026-1118-001", "VL-CONTR-2026-1118-004", "VL-ACT-2026-1117-012"];

export function Features() {
  return (
    <section id="funcionalidades" aria-labelledby="funcionalidades-titulo" className="relative bg-docid-surface-low">
      <div className="shell py-24 sm:py-28">
        <Reveal className="max-w-2xl">
          <h2 id="funcionalidades-titulo" className="text-[clamp(1.9rem,3.8vw,2.9rem)] font-semibold text-docid-text">
            O que fica registado
          </h2>
          <p className="mt-5 text-base leading-relaxed text-docid-muted">
            Seis coisas acontecem quando um documento entra na organização. Todas deixam rasto.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Reveal className="lg:col-span-7">
            <Tile className="h-full">
              <TileTitle>Identificadores por organização e categoria</TileTitle>
              <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-docid-muted">
                O prefixo vem da organização e da categoria; a sequência é diária e não repete. Copiar, pesquisar ou
                restringir um identificador leva um clique.
              </p>
              <ul className="mt-6 space-y-2">
                {CHIPS.map((chip, i) => (
                  <li
                    key={chip}
                    className={cn(
                      "flex items-center justify-between gap-4 rounded-lg border border-docid-border px-3.5 py-2.5",
                      i === 0 ? "bg-docid-surface-low" : "bg-transparent",
                    )}
                  >
                    <span className="truncate font-mono text-xs text-docid-text">{chip}</span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-docid-muted">
                      {i === 0 ? "activo" : i === 1 ? "pendente" : "restrito"}
                    </span>
                  </li>
                ))}
              </ul>
            </Tile>
          </Reveal>

          <Reveal delay={0.06} className="lg:col-span-5">
            <Tile className="h-full">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-docid-primary" aria-hidden="true" />
                <TileTitle>Auditoria de tudo o que acontece</TileTitle>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-docid-muted">
                Emissões, aprovações, downloads e alterações ficam registados por organização.
              </p>
              <ul className="mt-6 divide-y divide-docid-border border-y border-docid-border">
                {LOG.map((entry) => (
                  <li key={entry.time} className="flex gap-3 py-2.5">
                    <span className="shrink-0 font-mono text-[11px] text-docid-muted">{entry.time}</span>
                    <span className="font-mono text-[11px] leading-relaxed text-docid-text">{entry.text}</span>
                  </li>
                ))}
              </ul>
            </Tile>
          </Reveal>

          <Reveal delay={0.04} className="lg:col-span-4">
            <Tile className="h-full">
              <TileTitle>Acesso por sector</TileTitle>
              <p className="mt-3 text-sm leading-relaxed text-docid-muted">
                Cada documento pertence a um sector. Fora dele, vê-se o identificador e o estado, não o conteúdo.
              </p>
            </Tile>
          </Reveal>

          <Reveal delay={0.08} className="lg:col-span-4">
            <Tile className="h-full">
              <div className="flex items-center gap-2">
                <Workflow className="h-4 w-4 text-docid-primary" aria-hidden="true" />
                <TileTitle>Aprovações</TileTitle>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-docid-muted">
                Pedidos de acesso e aprovações ficam no mesmo sítio. Aprovar concede acesso e fecha o pedido.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-docid-muted">
                <span className="rounded border border-docid-border px-1.5 py-1">pedido</span>
                <span aria-hidden="true">→</span>
                <span className="rounded border border-docid-border px-1.5 py-1">aprovação</span>
                <span aria-hidden="true">→</span>
                <span className="rounded border border-docid-border px-1.5 py-1 text-docid-secondary">acesso</span>
              </div>
            </Tile>
          </Reveal>

          <Reveal delay={0.12} className="lg:col-span-4">
            <Tile className="h-full">
              <div className="flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-docid-primary" aria-hidden="true" />
                <TileTitle>Digitalização</TileTitle>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-docid-muted">
                Scanner ligado ao PC. As páginas entram direitas no documento, sem passar por outra pasta.
              </p>
            </Tile>
          </Reveal>

          <Reveal delay={0.16} className="lg:col-span-12">
            <Tile>
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-[52ch]">
                  <TileTitle>Sincronização por leases</TileTitle>
                  <p className="mt-3 text-sm leading-relaxed text-docid-muted">
                    Rede instável não trava o trabalho. O DocID reserva o documento, sincroniza as alterações e liberta
                    a reserva. Dois postos não gravam por cima um do outro.
                  </p>
                </div>
                <ol className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] sm:justify-end">
                  {["reservado", "sincronizado", "liberto"].map((state, i) => (
                    <li key={state} className="flex items-center gap-2">
                      {i > 0 && <span aria-hidden="true" className="text-docid-outline">→</span>}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded border px-2 py-1",
                          i === 1
                            ? "border-docid-secondary/60 text-docid-secondary"
                            : "border-docid-border text-docid-muted",
                        )}
                      >
                        {i === 1 && <Check className="h-3 w-3" aria-hidden="true" />}
                        {state}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </Tile>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
