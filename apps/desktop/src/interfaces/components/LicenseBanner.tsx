import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "../../infrastructure/di/container";

type LicenseInfo = {
  licenseNumber: string | null;
  state: "trial" | "active" | "grace" | "read_only" | "suspended" | "none";
  status: string | null;
  planName: string | null;
  maxUsers: number | null;
  validUntil: string | null;
};

const DAY = 86_400_000;

function message(info: LicenseInfo): string | null {
  const days = info.validUntil ? Math.ceil((new Date(info.validUntil).getTime() - Date.now()) / DAY) : null;
  if (info.state === "suspended") return "Licença suspensa. A aplicação está em modo só consulta.";
  if (info.state === "read_only") return "Licença expirada. A aplicação está em modo só consulta até renovar.";
  if (info.state === "grace") return `Licença expirada. Tem mais ${Math.max(0, days ?? 0)} dias de tolerância antes de passar a só consulta.`;
  if (info.state === "trial" && days != null && days <= 7) return `Período de teste termina em ${Math.max(0, days)} dia(s). Renove para não perder o acesso.`;
  return null;
}

export default function LicenseBanner() {
  const [info, setInfo] = useState<LicenseInfo | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get<{ data: LicenseInfo }>("/tenants/me/license");
        if (alive) setInfo(res.data);
      } catch { /* aviso não bloqueia a aplicação */ }
    };
    void load();
    const timer = setInterval(load, 15 * 60 * 1000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const text = info ? message(info) : null;
  if (!text) return null;

  return (
    <div data-testid="license-banner" className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-300">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{text}</span>
      {info?.licenseNumber && <span className="ml-auto font-mono text-[10px] text-amber-300/70">{info.licenseNumber}</span>}
    </div>
  );
}
