import { useState } from "react";
import { api } from "../../../infrastructure/di/container";
import { OfflineNotice } from "../docid-ui";
import { useOfflineCache } from "../../hooks/useOfflineCache";
import { friendlyDate, NO_PERSON, type HrProfile } from "./types";
import { Check, X, UserRound, Info } from "lucide-react";

/** Categorias de RH (grupo "RH" do catálogo), pela ordem em que aparecem no cartão. */
export const HR_CATEGORIES: Array<[string, string, string]> = [
  // [id, singular, plural]
  ["CTR", "Contrato de trabalho", "Contratos"],
  ["ADM", "Admissão", "Admissões"],
  ["FLC", "Recibo de vencimento", "Recibos"],
  ["DEC", "Declaração de vínculo", "Declarações"],
  ["MAP", "Mapa de férias", "Mapas de férias"],
  ["TER", "Termo de rescisão", "Rescisões"],
];
const REQUIRED = new Set(["CTR", "ADM"]);

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "?";
}

/** Grelha de perfis de RH: um cartão por colaborador, com o que tem e o que falta. */
export default function HrProfiles({ q, onOpen }: { q: string; onOpen: (person: string) => void }) {
  const [profiles, setProfiles] = useState<HrProfile[]>([]);
  const params = q.trim() ? `q=${encodeURIComponent(q.trim())}` : "";
  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<{ data: HrProfile[] }>({
    endpoint: "/documents/profiles",
    params,
    fetcher: () => api.get<{ data: HrProfile[] }>(`/documents/profiles${params ? `?${params}` : ""}`),
    onData: r => setProfiles(r.data || []),
  });

  const people = profiles.filter(p => p.key !== NO_PERSON);
  const unnamed = profiles.find(p => p.key === NO_PERSON);

  return (
    <div className="space-y-4 p-4" data-testid="hr-profiles">
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}
      {error && <p className="text-sm text-docid-error">{error}</p>}

      {loading && profiles.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5">
          {[...Array(6)].map((_, i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-docid-surface-high" />)}
        </div>
      ) : people.length === 0 && !unnamed ? (
        <div className="flex min-h-60 flex-col items-center justify-center gap-3 text-center" data-testid="hr-profiles-empty">
          <UserRound className="h-10 w-10 text-docid-outline" />
          <p className="text-sm text-docid-text">{q ? "Nenhum colaborador com esse nome." : "Ainda não há documentos de RH."}</p>
          {!q && <p className="max-w-md text-xs text-docid-muted">Gere identificadores das categorias de RH (contrato de trabalho, admissão, recibos...) e escreva o nome do colaborador em "Emitido para". Os perfis aparecem aqui sozinhos.</p>}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5">
          {people.map(p => (
            <button key={p.key} type="button" onClick={() => onOpen(p.name)} data-testid="hr-profile-card"
              className="flex flex-col gap-3 rounded-xl border border-docid-border bg-docid-surface-low p-4 text-left transition hover:border-docid-primary/50 hover:bg-docid-surface">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-docid-primary/15 text-sm font-semibold text-docid-primary-soft">{initials(p.name)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-docid-text">{p.name}</span>
                  <span className="block text-[11px] text-docid-muted">{p.total} {p.total === 1 ? "documento" : "documentos"} · {friendlyDate(p.lastDocumentAt)}</span>
                </span>
                {p.terminated && <span className="ml-auto shrink-0 rounded-full bg-docid-surface-high px-2 py-0.5 text-[10px] text-docid-muted">Rescindido</span>}
              </div>
              <ul className="space-y-1 text-xs">
                {HR_CATEGORIES.filter(([id]) => REQUIRED.has(id) || p.byCategory[id]).map(([id, one, many]) => {
                  const n = p.byCategory[id] ?? 0;
                  const missing = REQUIRED.has(id) && n === 0;
                  return (
                    <li key={id} className={`flex items-center gap-1.5 ${missing ? "text-docid-tertiary" : "text-docid-muted"}`}>
                      {REQUIRED.has(id) ? (missing ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-docid-secondary" />) : <span className="w-3.5 text-center">·</span>}
                      {missing ? `${one} em falta` : n === 1 ? one : `${n} ${many.toLowerCase()}`}
                    </li>
                  );
                })}
              </ul>
              {p.tags.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {p.tags.slice(0, 3).map(t => <span key={t} className="rounded-full bg-docid-surface-high px-1.5 py-px text-[10px] text-docid-muted">{t}</span>)}
                  {p.tags.length > 3 && <span className="text-[10px] text-docid-muted">+{p.tags.length - 3}</span>}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {unnamed && (
        <button type="button" onClick={() => onOpen(NO_PERSON)} data-testid="hr-profile-unnamed"
          className="flex w-full items-start gap-3 rounded-xl border border-dashed border-docid-tertiary/40 bg-docid-tertiary/5 p-4 text-left text-xs text-docid-muted transition hover:border-docid-tertiary/70">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-docid-tertiary" />
          <span>
            <span className="block text-sm font-medium text-docid-text">{unnamed.total} {unnamed.total === 1 ? "documento de RH sem colaborador" : "documentos de RH sem colaborador"}</span>
            Não aparecem em nenhum perfil porque o identificador não tem "Emitido para". Abra-os para ver quais são.
          </span>
        </button>
      )}
    </div>
  );
}
