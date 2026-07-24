import { useCallback, useEffect, useState } from "react";
import { Fingerprint, FileText, AlertTriangle, CheckCircle, XCircle, Clock, Hash } from "lucide-react";
import { api } from "../../infrastructure/di/container";
import { useAuthStore } from "../stores/authStore";
import { PageHeader, MetricCard, EmptyState } from "../components/docid-ui";

interface StatsData {
  identifiers: {
    total: number;
    byStatus: Record<string, number>;
    byCategory: { category: string; cnt: number }[];
  };
  documents: {
    total: number;
    verificationFailures: number;
  };
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  active: "Activo",
  attached: "Anexado",
  cancelled: "Cancelado",
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  draft: Clock,
  active: CheckCircle,
  attached: CheckCircle,
  cancelled: XCircle,
};

const STATUS_TONES: Record<string, string> = {
  draft: "text-docid-muted",
  active: "text-docid-secondary",
  attached: "text-docid-primary-soft",
  cancelled: "text-docid-error",
};

export default function Dashboard() {
  const user = useAuthStore(s => s.user);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ data: StatsData }>("/stats");
      setStats(res.data);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar estatísticas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Bem-vindo, ${user?.fullName || "utilizador"}.`}
      />

      {error && (
        <div className="mb-6 rounded-lg border border-docid-error/30 bg-docid-error/10 px-4 py-3 text-sm text-docid-error">
          {error}
          <button onClick={load} className="ml-2 underline">Tentar novamente</button>
        </div>
      )}

      {loading && !stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="docid-panel p-5">
              <div className="mb-4 h-5 w-5 animate-pulse rounded bg-docid-surface-high" />
              <div className="mb-2 h-3 w-20 animate-pulse rounded bg-docid-surface-high" />
              <div className="h-8 w-16 animate-pulse rounded bg-docid-surface-high" />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && !stats && (
        <EmptyState>Nenhum dado disponível.</EmptyState>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total de Identificadores"
              value={stats.identifiers.total}
              icon={Fingerprint}
              accent="text-docid-primary-soft"
            />
            <MetricCard
              label="Total de Documentos"
              value={stats.documents.total}
              icon={FileText}
              accent="text-docid-secondary"
            />
            <MetricCard
              label="Falhas de Verificação"
              value={stats.documents.verificationFailures}
              icon={AlertTriangle}
              accent={stats.documents.verificationFailures > 0 ? "text-docid-error" : "text-docid-muted"}
              badge={stats.documents.verificationFailures > 0 ? "Atenção" : "OK"}
            />
            <MetricCard
              label="Identificadores Activos"
              value={stats.identifiers.byStatus?.active ?? 0}
              icon={CheckCircle}
              accent="text-docid-secondary"
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="docid-panel p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-docid-muted">Estado dos Identificadores</h2>
              <div className="space-y-3">
                {Object.entries(stats.identifiers.byStatus || {}).length === 0 ? (
                  <p className="text-sm text-docid-muted">Nenhum identificador registado.</p>
                ) : (
                  Object.entries(stats.identifiers.byStatus).map(([status, count]) => {
                    const Icon = STATUS_ICONS[status] || Hash;
                    const total = stats.identifiers.total || 1;
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={status}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2 text-docid-text">
                            <Icon className={`h-4 w-4 ${STATUS_TONES[status] || "text-docid-muted"}`} />
                            {STATUS_LABELS[status] || status}
                          </span>
                          <span className="font-semibold text-docid-text">{count}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-docid-surface-high">
                          <div
                            className={`h-full rounded-full transition-all ${STATUS_TONES[status] || "bg-docid-muted"}`}
                            style={{ width: `${pct}%`, backgroundColor: "currentColor" }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="docid-panel p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-docid-muted">
                Top Categorias
                {stats.identifiers.byCategory.length > 0 && (
                  <span className="ml-2 font-normal text-docid-muted">({stats.identifiers.byCategory.length})</span>
                )}
              </h2>
              {stats.identifiers.byCategory.length === 0 ? (
                <p className="text-sm text-docid-muted">Nenhuma categoria registada.</p>
              ) : (
                <div className="space-y-2">
                  {stats.identifiers.byCategory.map((cat) => {
                    const total = stats.identifiers.total || 1;
                    const pct = Math.round((cat.cnt / total) * 100);
                    return (
                      <div key={cat.category} className="flex items-center gap-3">
                        <span className="w-1/3 truncate text-sm text-docid-text">{cat.category}</span>
                        <div className="flex-1">
                          <div className="h-2 overflow-hidden rounded-full bg-docid-surface-high">
                            <div
                              className="h-full rounded-full bg-docid-primary-soft"
                              style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                          </div>
                        </div>
                        <span className="w-12 text-right text-sm font-semibold text-docid-text">{cat.cnt}</span>
                        <span className="w-10 text-right text-xs text-docid-muted">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
