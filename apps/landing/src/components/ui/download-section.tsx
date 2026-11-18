import { Download, ExternalLink, ShieldCheck } from "lucide-react";
import { ColumnLines } from "@/components/ui/column-lines";
import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/utils";

const RELEASE = "https://github.com/NiltonCarlosdawg/Identifierdocuments/releases/download/desktop-v1.1.6";
const ALL_RELEASES = "https://github.com/NiltonCarlosdawg/Identifierdocuments/releases";

export const DOWNLOADS = {
  installer: {
    href: `${RELEASE}/DocID_1.1.6_x64-setup.exe`,
    size: "8,6 MB",
    sha256: "66f2f31576fe1c39fe60a3e8a43d1967629b1cad6378074c6a17c01edb1bbf12",
  },
  portable: {
    href: `${RELEASE}/docid-desktop-1.1.6.exe`,
    size: "42,9 MB",
    sha256: "f89cbaf7a79b0c1513bb86df868b4b8fb98c765482e59ad74b83c6a7f9bcae78",
  },
} as const;

const WindowsMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="currentColor"
      d="M3 5.557L10.373 4.6v7.05H3V5.557zm0 12.886L10.373 19.4v-6.896H3v5.94zm8.189-13.02L21 3v8.65h-9.811V5.423zm0 13.154V13.35H21V21l-9.811-1.457z"
    />
  </svg>
);

const LinuxMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
    <path
      fill="currentColor"
      d="M186.575 162.152c18.146 15.312 47.429 31.274 72.844 41.233c-21.862-15.866-43.618-33.749-65.334-57.155c18.076-38.546 39.66-91.786 61.912-146.132c36.28 92.698 103.9 232.202 194.486 397.718c-24.61-13.513-46.908-21.207-69.93-27.152c7.63 4.355 25.665 14.197 37.237 22.108c18.28 12.497 35.198 26.163 51.107 39.249c14.2 26.11 28.574 52.76 43.103 79.88c-72.256-41.837-142.473-75.727-200-86.195c18.833-104.471-54.88-166.107-96.76-99.61c-16.126 25.603-20.487 67.787-12.84 99.133C129.667 439.235 58.503 478.44 0 511.902c68.143-123.477 137.038-248.649 186.575-349.75"
    />
  </svg>
);

const AppleMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="currentColor"
      d="M17.05 12.54c-.03-2.5 2.04-3.7 2.13-3.76-1.16-1.7-2.97-1.93-3.62-1.96-1.54-.16-3 .9-3.78.9-.78 0-1.98-.88-3.25-.86-1.67.03-3.21.97-4.07 2.46-1.73 3-.44 7.44 1.25 9.87.83 1.19 1.81 2.53 3.1 2.48 1.24-.05 1.71-.8 3.21-.8 1.5 0 1.92.8 3.23.78 1.33-.02 2.18-1.21 3-2.41.94-1.37 1.33-2.7 1.35-2.77-.03-.01-2.59-.99-2.62-3.93zM14.6 5.2c.68-.83 1.14-1.97 1.01-3.12-.98.04-2.17.65-2.87 1.47-.63.73-1.18 1.9-1.03 3.02 1.09.09 2.21-.55 2.89-1.37z"
    />
  </svg>
);

function PlatformRow({
  mark,
  name,
  detail,
  meta,
  action,
}: {
  mark: React.ReactNode;
  name: string;
  detail: string;
  meta: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:gap-6 sm:px-7">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-docid-border bg-docid-surface-low text-docid-text">
        {mark}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-base font-semibold tracking-tight text-docid-text">{name}</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-docid-muted">{meta}</span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-docid-muted">{detail}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export function DownloadSection() {
  return (
    <section id="descarregar" aria-labelledby="descarregar-titulo" className="on-dark relative isolate overflow-hidden bg-docid-bg">
      <ColumnLines className="text-docid-border" />
      <div className="shell relative z-10 py-24 sm:py-28">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="descarregar-titulo" className="text-[clamp(2rem,4.4vw,3.25rem)] font-semibold text-docid-text">
            Instale o DocID no Windows
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-docid-muted">
            Versão 1.1.6 para Windows 10 e 11, 64 bits. A conta é criada pela sua organização; depois de instalar,
            entre com as credenciais que recebeu.
          </p>
        </Reveal>

        <Reveal delay={0.08} className="mx-auto mt-12 max-w-3xl">
          <div className="overflow-hidden rounded-2xl border border-docid-border bg-docid-surface">
            <PlatformRow
              mark={<WindowsMark className="h-4 w-4" />}
              name="Instalador"
              meta="Recomendado · x64"
              detail="Cria a aplicação no perfil do utilizador e activa as actualizações automáticas."
              action={
                <a className="btn-primary w-full sm:w-auto" href={DOWNLOADS.installer.href}>
                  <Download className="h-4 w-4" />
                  Descarregar {DOWNLOADS.installer.size}
                </a>
              }
            />
            <div className="rule" />
            <PlatformRow
              mark={<WindowsMark className="h-4 w-4" />}
              name="Versão portátil"
              meta="Sem instalação · x64"
              detail="Um único ficheiro executável. Precisa do Microsoft Edge WebView2, já presente na maioria dos Windows 10 e 11."
              action={
                <a className="btn-ghost w-full sm:w-auto" href={DOWNLOADS.portable.href}>
                  <Download className="h-4 w-4" />
                  Descarregar {DOWNLOADS.portable.size}
                </a>
              }
            />
            <div className="rule" />
            <PlatformRow
              mark={<LinuxMark className="h-4 w-4" />}
              name="Linux"
              meta="Em breve"
              detail="Estamos a preparar os pacotes .deb e AppImage."
              action={<span className="btn-ghost w-full cursor-not-allowed opacity-55 sm:w-auto" aria-disabled="true">Em breve</span>}
            />
            <div className="rule" />
            <PlatformRow
              mark={<AppleMark className="h-4 w-4" />}
              name="macOS"
              meta="Em breve"
              detail="Versão para Apple Silicon e Intel em desenvolvimento."
              action={<span className="btn-ghost w-full cursor-not-allowed opacity-55 sm:w-auto" aria-disabled="true">Em breve</span>}
            />
          </div>
        </Reveal>

        <Reveal delay={0.14} className="mx-auto mt-8 max-w-3xl">
          <div className="rounded-xl border border-docid-border bg-docid-surface-low p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-docid-secondary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm leading-relaxed text-docid-text">
                  O instalador não tem certificado comercial da Microsoft. Se o Windows mostrar “Windows protegeu o seu
                  PC”, escolha <span className="font-semibold">Mais informações</span> e depois{" "}
                  <span className="font-semibold">Executar mesmo assim</span>.
                </p>
                <dl className="mt-4 space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-docid-muted">SHA-256 instalador</dt>
                    <dd className="w-full break-all font-mono text-[11px] leading-relaxed text-docid-muted">
                      {DOWNLOADS.installer.sha256}
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-docid-muted">SHA-256 portátil</dt>
                    <dd className="w-full break-all font-mono text-[11px] leading-relaxed text-docid-muted">
                      {DOWNLOADS.portable.sha256}
                    </dd>
                  </div>
                </dl>
                <a
                  className={cn("mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-docid-link underline-offset-4 hover:underline")}
                  href={ALL_RELEASES}
                  rel="noreferrer"
                >
                  Ver todas as versões publicadas
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
