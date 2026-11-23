import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { DOWNLOADS } from "@/components/ui/download-section";

const LINKS = [
  { href: "#produto", label: "Produto" },
  { href: "#funcionalidades", label: "Funcionalidades" },
  { href: "#seguranca", label: "Segurança" },
  { href: "#planos", label: "Planos" },
  { href: "#perguntas", label: "Perguntas" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        open
          ? "border-b border-docid-border bg-docid-bg"
          : scrolled
            ? "border-b border-docid-border bg-docid-bg/85 backdrop-blur-md"
            : "border-b border-transparent"
      } on-dark`}
    >
      <div className="shell flex h-16 items-center justify-between gap-6">
        <a href="#topo" className="flex items-center" aria-label="DocID, início">
          <img src="/logo-dark.png" alt="DocID" width={107} height={28} className="h-7 w-auto" />
        </a>

        <nav aria-label="Navegação principal" className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-docid-muted underline-offset-[6px] transition-colors hover:text-docid-text hover:underline"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a href={DOWNLOADS.installer.href} className="btn-primary hidden h-10 px-4 sm:inline-flex">
            Descarregar
          </a>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-docid-border text-docid-text md:hidden"
            aria-expanded={open}
            aria-controls="menu-mobile"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div id="menu-mobile" className="shell pb-5 md:hidden">
          <nav aria-label="Navegação principal (móvel)" className="flex flex-col">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="border-b border-docid-border py-3 text-sm font-medium text-docid-text"
              >
                {link.label}
              </a>
            ))}
            <a href={DOWNLOADS.installer.href} className="btn-primary mt-4">
              Descarregar para Windows
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
