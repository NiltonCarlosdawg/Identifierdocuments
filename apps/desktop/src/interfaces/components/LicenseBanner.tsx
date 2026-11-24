import { useEffect, useState } from "react";
import { api } from "../../infrastructure/di/container";

/** Estado da licença devolvido por GET /tenants/me (campo `license`). */
export interface LicenseInfo {
  licenseNumber: string;
  plan: string;
  state: "active" | "grace" | "expired" | "suspended";
  canWrite: boolean;
  validUntil: string | null;
  graceUntil: string | null;
  daysLeft: number | null;
  maxUsers: number | null;
  activeUsers: number;
}

const REFRESH_MS = 15 * 60 * 1000;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-PT") : "");

/** Texto e estilo do aviso, ou null quando não há nada a mostrar. Exportado para testes. */
export function licenseNotice(l: LicenseInfo | null): { tone: "info" | "warning" | "error"; text: string } | null {
  if (!l) return null;
  if (l.state === "suspended") {
    return { tone: "error", text: `A licença ${l.licenseNumber} está suspensa. Modo só consulta: pode ver e descarregar documentos, mas não criar, carregar ou partilhar.` };
  }
  if (l.state === "expired") {
    return { tone: "error", text: `A licença ${l.licenseNumber} expirou em ${fmt(l.validUntil)}. Modo só consulta: pode ver e descarregar documentos, mas não criar, carregar ou partilhar. Contacte o suporte para renovar.` };
  }
  if (l.state === "grace") {
    return { tone: "warning", text: `A licença ${l.licenseNumber} expirou em ${fmt(l.validUntil)}. Tudo continua a funcionar até ${fmt(l.graceUntil)}; depois a organização passa a só consulta. Renove para evitar a interrupção.` };
  }
  if (l.daysLeft !== null) {
    if (l.plan === "trial" && l.daysLeft <= 7) {
      const dias = l.daysLeft <= 1 ? "termina hoje" : `faltam ${l.daysLeft} dias`;
      return { tone: "info", text: `Período de teste: ${dias} (até ${fmt(l.validUntil)}). Número de licença ${l.licenseNumber}.` };
    }
    if (l.plan !== "trial" && l.daysLeft <= 15) {
      return { tone: "info", text: `A licença ${l.licenseNumber} termina em ${l.daysLeft} dia${l.daysLeft === 1 ? "" : "s"} (${fmt(l.validUntil)}).` };
    }
  }
  return null;
}

const TONE: Record<string, string> = {
  info: "border-docid-primary/30 bg-docid-primary/10 text-docid-text",
  warning: "border-docid-tertiary/40 bg-docid-tertiary/10 text-docid-text",
  error: "border-docid-error/30 bg-docid-error/10 text-docid-error",
};

/** Faixa no topo da app com o estado da licença da organização. */
export default function LicenseBanner() {
  const [license, setLicense] = useState<LicenseInfo | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.get<{ data?: { license?: LicenseInfo | null } }>("/tenants/me")
        .then((res) => { if (alive) setLicense(res?.data?.license ?? null); })
        .catch(() => { /* offline ou sem sessão: mantém o último estado conhecido */ });
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const notice = licenseNotice(license);
  if (!notice) return null;
  return (
    <div role={notice.tone === "error" ? "alert" : "status"} className={`mb-5 rounded-lg border px-4 py-3 text-sm ${TONE[notice.tone]}`}>
      {notice.text}
    </div>
  );
}
