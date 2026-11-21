import DoodleCrewFooter from "@/components/ui/doodle-crew-footer";
import { DOWNLOADS } from "@/components/ui/download-section";

const API_HEALTH = "https://didall.milvendas.ao/health";

const CREW = [
  {
    kind: "clerk" as const,
    letter: 0,
    seat: "front" as const,
    offset: -0.5,
    name: "Clara",
    says: "Ficha atualizada.",
  },
  {
    kind: "analyst" as const,
    letter: 2,
    seat: "top" as const,
    offset: 0.05,
    name: "Rui",
    says: "Tudo auditado.",
  },
  {
    kind: "worker" as const,
    letter: 4,
    seat: "front" as const,
    offset: 0.45,
    flip: true,
    name: "Aónio",
    says: "Documentos registados.",
  },
];

export function Footer() {
  return (
    <DoodleCrewFooter
      wordmark="DOCID"
      brand="DocID"
      blurb="Gestão documental para empresas angolanas. Identificadores únicos, acesso por sector e auditoria por organização."
      tagline="Um identificador único para cada documento, encontrado em segundos."
      columns={[
        {
          title: "Produto",
          links: [
            { label: "Produto", href: "#produto" },
            { label: "Funcionalidades", href: "#funcionalidades" },
            { label: "Segurança", href: "#seguranca" },
            { label: "Perguntas", href: "#perguntas" },
          ],
        },
        {
          title: "Descarregar",
          links: [
            { label: "Windows · instalador 1.1.6", href: DOWNLOADS.installer.href },
            { label: "Estado do serviço", href: API_HEALTH },
          ],
        },
      ]}
      actions={[
        { label: "Ver o produto", href: "#produto", icon: "paper", variant: "outline" },
        { label: "Descarregar para Windows", href: DOWNLOADS.installer.href, icon: "laptop", variant: "solid" },
      ]}
      copyright="© 2026 Verano Labs · Luanda, Angola"
      legal={[]}
      socials={[]}
      crew={CREW}
      doodles={["paper", "folder", "laptop", "check"]}
      doodleCount={10}
      preset="paper"
      palette={{ background: "#f8f9fa", ink: "#14171c", accent: "#2563eb" }}
      fontFamily='Archivo, Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'
      serifFamily='Inter, ui-sans-serif, system-ui, sans-serif'
      height="680px"
    />
  );
}
