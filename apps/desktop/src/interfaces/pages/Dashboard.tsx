import { useEffect, useState } from "react";
import { Fingerprint, FileText, AlertTriangle, CheckCircle, XCircle, Clock, Hash, CloudOff, Upload, Inbox, FolderOpen, ArrowRight } from "lucide-react";
import { api } from "../../infrastructure/di/container";
import { useAuthStore } from "../stores/authStore";
import { useOfflineCache } from "../hooks/useOfflineCache";
import { pendingCount, useQueueStore } from "../stores/queueStore";
import { PageHeader, MetricCard, EmptyState, OfflineNotice } from "../components/docid-ui";

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
  activity?: { date: string; identifiers: number; documents: number }[];
}

interface ApprovalRow {
  id: string;
  type: string;
  status: string;
  requestedAt: string;
  sector: { id: string; name: string } | null;
  supervisor: { id: string; fullName: string } | null;
  document: { id: string; identifier: { identifier: string } | null } | null;
}

interface DocRow {
  id: string;
  filename: string;
  status: string;
  createdAt: string;
  uploadedBy: string | null;
  identifier: { id: string; identifier: string } | null;
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
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [recentDocs, setRecentDocs] = useState<DocRow[]>([]);

  const queueItems = useQueueStore(s => s.items);
  const queueOnline = useQueueStore(s => s.online);
  const queueRefresh = useQueueStore(s => s.refresh);
  const setQueuePanelOpen = useQueueStore(s => s.setPanelOpen);
  const queuePending = pendingCount(queueItems);

  useEffect(() => { queueRefresh().catch(() => {}); }, [queueRefresh]);

  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<StatsData>({
    endpoint: "/stats",
    fetcher: async () => {
      const res = await api.get<{ data: StatsData }>("/stats");
      return res.data;
    },
    onData: data => setStats(data),
  });

  useOfflineCache<ApprovalRow[]>({
    endpoint: "/approvals",
    params: "status=pending",
    fetcher: async () => {
      const res = await api.get<{ data: ApprovalRow[] }>("/approvals?status=pending");
      return res.data || [];
    },
    onData: setApprovals,
  });

  useOfflineCache<DocRow[]>({
    endpoint: "/documents",
    params: "limit=5",
    fetcher: async () => {
      const res = await api.get<{ data: DocRow[]; meta: { total: number; page: number; limit: number } }>("/documents?page=1&limit=5");
      return res.data || [];
    },
    onData: setRecentDocs,
  });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Bem-vindo, ${user?.fullName || "utilizador"}.`}
      />

      {error && (
        <div className="mb-6 rounded-lg border border-docid-error/30 bg-docid-error/10 px-4 py-3 text-sm text-docid-error">
          {error}
          <button onClick={refresh} className="ml-2 underline">Tentar novamente</button>
        </div>
      )}

      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}

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

          <div className="mt-6 docid-panel p-5">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-docid-muted">Actividade (últimos 14 dias)</h2>
            <p className="mb-4 text-xs text-docid-muted">Identificadores gerados e documentos associados por dia.</p>
            <ActivityChart data={stats.activity || []} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="docid-panel p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-docid-muted">
                <CloudOff className="h-4 w-4" /> Fila Offline
              </h2>              <button
                onClick={() => setQueuePanelOpen(true)}
                className="flex w-full items-center justify-between rounded-lg border border-docid-border bg-docid-surface-low px-4 py-3 text-left hover:bg-docid-surface-high"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-docid-surface-highest text-docid-text">
                    {queueOnline ? <Upload className="h-4 w-4" /> : <CloudOff className="h-4 w-4 text-orange-500" />}
                  </span>
                  <span>
                    <span className="block text-lg font-semibold text-docid-text">{queuePending}</span>
                    <span className="block text-xs text-docid-muted">{queuePending === 1 ? "ficheiro pendente" : "ficheiros pendentes"}</span>
                  </span>
                </span>
                <span className="flex items-center gap-1 text-xs text-docid-muted">Ver fila <ArrowRight className="h-3.5 w-3.5" /></span>
              </button>
              {!queueOnline && <p className="mt-3 text-xs text-docid-muted">Sem ligação — os envios ficam em fila e serão sincronizados automaticamente.</p>}
            </div>

            <div className="docid-panel p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-docid-muted">
                <Inbox className="h-4 w-4" /> Aprovações Pendentes
              </h2>
              {approvals.length === 0 ? (
                <p className="text-sm text-docid-muted">Nenhuma aprovação pendente.</p>
              ) : (
                <ul className="space-y-2">
                  {approvals.slice(0, 4).map(a => (
                    <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-docid-surface-low px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-docid-text">
                        {a.document?.identifier?.identifier || a.document?.id?.slice(0, 8) || a.id.slice(0, 8)}
                      </span>
                      <span className="shrink-0 text-xs text-docid-muted">
                        {a.supervisor?.fullName || a.sector?.name || "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-center gap-1 text-xs text-docid-secondary">
                {approvals.length > 4 && <span>{approvals.length} no total</span>}
              </div>
            </div>

            <div className="docid-panel p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-docid-muted">
                <FolderOpen className="h-4 w-4" /> Documentos Recentes
              </h2>
              {recentDocs.length === 0 ? (
                <p className="text-sm text-docid-muted">Nenhum documento recente.</p>
              ) : (
                <ul className="space-y-2">
                  {recentDocs.slice(0, 4).map(d => (
                    <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-docid-surface-low px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-docid-text">{d.filename}</span>
                      <span className="shrink-0 text-xs text-docid-muted">{new Date(d.createdAt).toLocaleDateString("pt-AO")}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-center gap-1 text-xs text-docid-secondary">
                {recentDocs.length > 4 && <span>{recentDocs.length} no total</span>}
              </div>
            </div>
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

interface ActivityPoint { date: string; identifiers: number; documents: number; }

const CHART_HEIGHT = 140;

function ActivityChart({ data }: { data: ActivityPoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-docid-muted">Sem dados de actividade.</p>;
  }

  const max = Math.max(1, ...data.map(d => Math.max(d.identifiers, d.documents)));
  const step = CHART_HEIGHT / (max || 1);
  const labelEvery = Math.ceil(data.length / 7);

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT }}>
        {data.map(d => {
          const idH = Math.max(1, Math.round(d.identifiers * step));
          const docH = Math.max(1, Math.round(d.documents * step));
          const h = Math.max(idH, docH);
          const key = d.date.slice(5);
          return (
            <div key={d.date} className="group relative flex flex-1 items-end justify-center gap-[2px]">
              <div className="flex items-end gap-[2px]">
                <div className="w-[4px] rounded-sm bg-docid-secondary/80 transition-all group-hover:bg-docid-secondary" style={{ height: `${idH}px` }} title={`${key}: ${d.identifiers} identificador(es)`} />
                <div className="w-[4px] rounded-sm bg-docid-primary-soft/80 transition-all group-hover:bg-docid-primary-soft" style={{ height: `${docH}px` }} title={`${key}: ${d.documents} documento(s)`} />
              </div>
              {d.identifiers + d.documents > 0 && (
                <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-docid-surface-highest px-1.5 py-0.5 text-[10px] text-docid-text opacity-0 shadow transition-opacity group-hover:opacity-100">
                  {d.identifiers + d.documents}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {data.map((d, i) => (
          <div key={d.date} className="flex-1 text-center">
            {i % labelEvery === 0 ? <span className="text-[10px] text-docid-muted">{d.date.slice(5)}</span> : null}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-docid-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-docid-secondary/80" /> Identificadores</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-docid-primary-soft/80" /> Documentos</span>
      </div>
    </div>
  );
}
