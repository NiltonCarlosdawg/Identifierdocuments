import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDown, Download } from "lucide-react";
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import { DOWNLOADS } from "@/components/ui/download-section";
import { cn } from "@/lib/utils";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function Scramble({ text, className }: { text: string; className?: string }) {
  const reduced = useReducedMotion();
  const [out, setOut] = useState(text);

  useEffect(() => {
    if (reduced) {
      setOut(text);
      return;
    }
    let frame = 0;
    const id = window.setInterval(() => {
      frame += 1;
      const revealed = Math.floor(frame / 2);
      if (revealed >= text.length) {
        setOut(text);
        window.clearInterval(id);
        return;
      }
      setOut(
        text.slice(0, revealed) +
          text
            .slice(revealed)
            .split("")
            .map((ch) => (ch === "-" ? ch : CHARS[Math.floor(Math.random() * CHARS.length)]))
            .join(""),
      );
    }, 34);
    return () => window.clearInterval(id);
  }, [text, reduced]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{out}</span>
    </span>
  );
}


const ROWS = [
  { id: "VL-PROP-2026-1118-001", sector: "Jurídico", date: "18.11.2026", state: "aprovado" },
  { id: "VL-CONTR-2026-1118-004", sector: "Comercial", date: "18.11.2026", state: "pendente" },
  { id: "VL-ACT-2026-1117-012", sector: "Direcção", date: "17.11.2026", state: "restrito" },
] as const;

const STATE_TONE: Record<string, string> = {
  aprovado: "text-docid-secondary",
  pendente: "text-docid-tertiary",
  restrito: "text-docid-error",
};

export function Hero() {
  const reduced = useReducedMotion();
  const fade = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 18, filter: "blur(6px)" },
          animate: { opacity: 1, y: 0, filter: "blur(0px)" },
          transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <section id="topo" className="on-dark relative isolate overflow-hidden bg-docid-bg">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(37,99,235,0.22),transparent_70%)]"
      />
      <AnimatedGridPattern
        className="text-docid-primary [mask-image:radial-gradient(ellipse_60%_55%_at_50%_25%,black,transparent)]"
        duration={5}
        maxOpacity={0.35}
        numSquares={22}
      />

      <div className="shell relative z-10 grid gap-14 pb-20 pt-28 sm:pt-32 lg:grid-cols-[1.04fr_0.96fr] lg:items-center lg:gap-16 lg:pb-28 lg:pt-36">
        <div>
          <motion.h1
            {...fade(0.05)}
            className="max-w-[17ch] text-[clamp(2.4rem,4.4vw,3.6rem)] font-semibold text-docid-text"
          >
            Quem emitiu, quem aprovou, quem consultou.
          </motion.h1>

          <motion.p {...fade(0.15)} className="mt-6 max-w-[46ch] text-base leading-relaxed text-docid-muted sm:text-lg">
            Cada documento tem um identificador único, acesso restrito por sector e registo de todas as acções da
            organização.
          </motion.p>

          <motion.div {...fade(0.24)} className="mt-8 flex flex-wrap items-center gap-3">
            <a href={DOWNLOADS.installer.href} className="btn-primary px-6 text-[0.95rem]">
              <Download className="h-4 w-4" aria-hidden="true" />
              Descarregar para Windows
            </a>
            <a href="#produto" className="btn-ghost px-5">
              Ver como funciona
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </a>
          </motion.div>

          <motion.p {...fade(0.3)} className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-docid-muted">
            Instalador para Windows · 300 MB
          </motion.p>
        </div>

        <motion.div {...fade(0.34)}>
          <div className="overflow-hidden rounded-xl border border-docid-border bg-docid-surface/70 backdrop-blur-sm">
            <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-docid-border bg-docid-surface-low/60 px-4 py-2.5 sm:grid-cols-[1.7fr_0.7fr_0.8fr_auto] sm:px-5">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-docid-muted">Identificador</span>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-docid-muted sm:block">
                Sector
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-docid-muted">Estado</span>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-docid-muted sm:block">
                Data
              </span>
            </div>

            {ROWS.map((row, i) => (
              <div
                key={row.id}
                className={cn(
                  "grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3.5 sm:grid-cols-[1.7fr_0.7fr_0.8fr_auto] sm:px-5",
                  i > 0 && "border-t border-docid-border",
                )}
              >
                {i === 0 ? (
                  <Scramble text={row.id} className="font-mono text-[11px] font-medium text-docid-text sm:text-xs" />
                ) : (
                  <span className="font-mono text-[11px] font-medium text-docid-text sm:text-xs">{row.id}</span>
                )}
                <span className="hidden font-mono text-xs text-docid-muted sm:block">{row.sector}</span>
                <span className={cn("font-mono text-[10px] uppercase tracking-[0.16em]", STATE_TONE[row.state])}>
                  {row.state}
                </span>
                <span className="hidden text-right font-mono text-xs text-docid-muted sm:block">{row.date}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-docid-muted">
            Exemplo de registo · dados ilustrativos
          </p>
        </motion.div>
      </div>
    </section>
  );
}
