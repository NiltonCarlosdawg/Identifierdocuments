import { DOWNLOADS } from "@/components/ui/download-section";

const API_HEALTH = "https://didall.milvendas.ao/health";

export function Footer() {
  return (
    <footer className="on-dark border-t border-docid-border bg-docid-bg">
      <div className="shell py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center">
              <img src="/logo-dark.png" alt="DocID" width={91} height={24} className="h-6 w-auto" />
            </div>
            <p className="mt-4 max-w-[42ch] text-sm leading-relaxed text-docid-muted">
              Gestão documental para empresas angolanas. Identificadores únicos, acesso por sector e auditoria por
              organização.
            </p>
          </div>

          <nav aria-label="Produto">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-docid-muted">Produto</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {[
                { href: "#produto", label: "Produto" },
                { href: "#funcionalidades", label: "Funcionalidades" },
                { href: "#seguranca", label: "Segurança" },
                { href: "#perguntas", label: "Perguntas" },
              ].map((link) => (
                <li key={link.href}>
                  <a className="text-docid-text underline-offset-4 hover:underline" href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-docid-muted">Descarregar</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <a className="text-docid-text underline-offset-4 hover:underline" href={DOWNLOADS.installer.href}>
                  Windows · instalador 1.1.6
                </a>
              </li>
              <li>
                <a className="text-docid-text underline-offset-4 hover:underline" href={DOWNLOADS.portable.href}>
                  Windows · portátil
                </a>
              </li>
              <li>
                <a
                  className="text-docid-muted underline-offset-4 hover:text-docid-text hover:underline"
                  href={API_HEALTH}
                  rel="noreferrer"
                >
                  Estado do serviço
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-docid-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-docid-muted">
            © 2026 Verano Labs · Luanda, Angola
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-docid-muted">DocID 1.1.6 · Windows x64</p>
        </div>
      </div>
    </footer>
  );
}
