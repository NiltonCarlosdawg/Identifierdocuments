import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/utils";

const ROWS = [
  { id: "VL-PROP-2026-1118-001", file: "proposta-comercial.pdf", sector: "Jurídico", state: "Aprovado", date: "18.11.2026" },
  { id: "VL-CONTR-2026-1118-004", file: "contrato-servico.pdf", sector: "Comercial", state: "Pendente", date: "18.11.2026" },
  { id: "VL-ACT-2026-1117-012", file: "acta-reuniao.pdf", sector: "Direcção", state: "Restrito", date: "17.11.2026" },
  { id: "VL-FACT-2026-1117-003", file: "factura-2026-118.pdf", sector: "Financeiro", state: "Aprovado", date: "17.11.2026" },
];

const TONE: Record<string, string> = {
  Aprovado: "text-docid-secondary",
  Pendente: "text-docid-tertiary",
  Restrito: "text-docid-error",
};

export function Product() {
  return (
    <section id="produto" aria-labelledby="produto-titulo" className="relative bg-docid-bg">
      <div className="shell py-24 sm:py-28">
        <Reveal className="max-w-3xl">
          <h2 id="produto-titulo" className="text-[clamp(1.9rem,3.8vw,2.9rem)] font-semibold text-docid-text">
            O ficheiro é o anexo. O&nbsp;registo é o documento.
          </h2>
          <p className="mt-6 max-w-[62ch] text-base leading-relaxed text-docid-muted">
            Uma pasta partilhada diz onde está o ficheiro. Não diz quem o emitiu, que sector o pode abrir, nem se
            alguém o aprovou. No DocID cada documento tem uma linha própria, com identificador, sector, estado e data.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-12">
          <div className="overflow-hidden rounded-xl border border-docid-border bg-docid-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left md:min-w-[680px]">
                <caption className="sr-only">
                  Exemplo de registo de documentos do DocID. Dados ilustrativos.
                </caption>
                <thead>
                  <tr className="border-b border-docid-border bg-docid-surface-low">
                    {["Identificador", "Documento", "Sector", "Estado", "Emitido"].map((column, i) => (
                      <th
                        key={column}
                        scope="col"
                        className={cn(
                          "px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-docid-muted",
                          i === 4 && "text-right",
                          (i === 1 || i === 2 || i === 4) && "hidden md:table-cell",
                        )}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.id} className="border-b border-docid-border last:border-0 transition-colors hover:bg-docid-surface-low/60">
                      <td className="whitespace-nowrap px-4 py-4 sm:px-5 font-mono text-[11px] font-medium text-docid-text sm:text-xs">
                        {row.id}
                      </td>
                      <td className="hidden px-4 py-4 text-sm text-docid-text md:table-cell md:px-5">{row.file}</td>
                      <td className="hidden px-4 py-4 text-sm text-docid-muted md:table-cell md:px-5">{row.sector}</td>
                      <td className={`px-4 py-4 font-mono text-[10px] uppercase tracking-[0.16em] sm:px-5 ${TONE[row.state]}`}>
                        {row.state}
                      </td>
                      <td className="hidden px-4 py-4 text-right font-mono text-xs text-docid-muted md:table-cell md:px-5">
                        {row.date}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-docid-muted">
            Exemplo de registo · dados ilustrativos
          </p>
        </Reveal>

        <Reveal delay={0.16} className="mt-14 grid gap-8 border-t border-docid-border pt-10 sm:grid-cols-3">
          {[
            { title: "Identificador na emissão", body: "Gerado no momento em que o documento entra, com prefixo da organização e da categoria." },
            { title: "Sector define o acesso", body: "Quem está fora do sector vê que o documento existe, não o conteúdo." },
            { title: "Aprovação antes do acesso", body: "Documentos restritos só abrem depois de um pedido aprovado, com registo." },
          ].map((item) => (
            <div key={item.title}>
              <h3 className="font-display text-base font-semibold tracking-tight text-docid-text">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-docid-muted">{item.body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
