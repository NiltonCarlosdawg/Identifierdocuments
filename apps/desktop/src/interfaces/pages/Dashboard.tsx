import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Fingerprint,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Hash,
  CloudOff,
  Upload,
  Inbox,
  FolderOpen,
  ArrowRight,
  Plus,
  Scan,
} from "lucide-react";
import { api } from "../../infrastructure/di/container";
import { useAuthStore } from "../stores/authStore";
import { useOfflineCache } from "../hooks/useOfflineCache";
import { pendingCount, useQueueStore } from "../stores/queueStore";
import { PageHeader, MetricCard, StatusChip, EmptyState, OfflineNotice } from "../components/docid-ui";

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

function SkeletonLine({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-docid-surface-high ${className}`} />;
}

function SkeletonMetric() {
  return (
    <div className="docid-panel p-5">
      <div className="flex items-center justify-between mb-3">
        <SkeletonLine className="h-4 w-20" />
        <SkeletonLine className="h-5 w-5 rounded-full" />
      </div>
      <SkeletonLine className="h-3 w-32 mt-1" />
      <SkeletonLine className="h-10 w-24 mt-3" />
    </div>
  );
}

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

  const isAdmin = (user?.roles || []).includes("ORG_ADMIN");
  const statsEndpoint = isAdmin ? "/tenants/me/stats" : "/stats";
  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<StatsData>({
    endpoint: statsEndpoint,
    fetcher: async () => {
      const res = await api.get<{ data: StatsData }>(statsEndpoint);
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

  const totalIdentifiers = stats?.identifiers.total ?? 0;
  const activeIdentifiers = stats?.identifiers.byStatus?.active ?? 0;
  const totalDocs = stats?.documents.total ?? 0;
  const failDocs = stats?.documents.verificationFailures ?? 0;

  const quickActions = [
    { label: "Novo identificador", icon: Fingerprint, to: "/identificadores", tone: "primary" },
    { label: "Subir documento", icon: Upload, to: "/documentos", tone: "secondary" },
    { label: "Digitalizar", icon: Scan, to: "/digitalizar", tone: "tertiary" },
    { label: "Aprovações", icon: CheckCircle, to: "/aprovacoes", tone: "primary" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Dashboard"
        description={`Bem-vindo de volta, ${user?.fullName || "utilizador"}. ${user?.organization ? `Organização: ${user.organization}` : ""}`}
        actions={(
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-docid-border bg-docid-surface-low px-3 py-2 text-sm font-medium text-docid-text transition hover:bg-docid-surface-high disabled:opacity-50"
            >
              <Clock className="h-4 w-4" /> Atualizar
            </button>
            <button className="docid-button-primary text-sm">
              <Plus className="h-4 w-4" /> Novo
            </button>
          </div>
        )}
      />

      {/* Error / offline notices */}
      {error && (
        <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 px-4 py-3 text-sm text-docid-error">
          {error}
          <button onClick={refresh} className="mt-2 inline-flex items-center gap-1 underline underline-offset-4 hover:text-docid-text">
            Tentar novamente <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}

      {/* Loading state */}
      {loading && !stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, index) => <SkeletonMetric key={index} />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !stats && (
        <EmptyState>Nenhum dado disponível.</EmptyState>
      )}

      {/* Content */}
      {stats && (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Identificadores totais"
              value={totalIdentifiers}
              icon={Fingerprint}
              accent="text-docid-primary-soft"
            />
            <MetricCard
              label="Documentos"
              value={totalDocs}
              icon={FileText}
              accent="text-docid-secondary"
            />
            <MetricCard
              label="Identificadores activos"
              value={activeIdentifiers}
              icon={CheckCircle}
              accent={totalIdentifiers > 0 ? "text-docid-secondary" : "text-docid-muted"}
              badge={totalIdentifiers > 0 ? `${Math.round((activeIdentifiers / totalIdentifiers) * 100)}%` : "—"}
            />
            <MetricCard
              label="Falhas de verificação"
              value={failDocs}
              icon={AlertTriangle}
              accent={failDocs > 0 ? "text-docid-error" : "text-docid-secondary"}
              badge={failDocs > 0 ? "Atenção" : "OK"}
              />
          </div>

          {/* Quick actions */}
          <div className="docid-panel p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-docid-muted">Ações rápidas</h2>
                <p className="text-xs text-docid-muted">Atalhos para as tarefas mais frequentes.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {quickActions.map((action) => (
                <Link
                  key={action.label}
                  to={action.to}
                  className="flex items-center gap-3 rounded-lg border border-docid-border bg-docid-surface-low px-4 py-3 text-sm font-medium text-docid-text transition hover:bg-docid-surface-high hover:text-docid-primary"
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-docid-surface-high ${action.tone === "primary" ? "text-docid-primary" : action.tone === "secondary" ? "text-docid-secondary" : action.tone === "tertiary" ? "text-docid-tertiary" : "text-docid-muted"}`}>
                    <action.icon className="h-5 w-5" />
                  </div>
                  <span>{action.label}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-docid-outline shrink-0" />
                </Link>
              ))}
            </div>
          </div>

          {/* Activity + Identifier status */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 docid-panel p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-docid-muted">Actividade (últimos 14 dias)</h2>
                  <p className="text-xs text-docid-muted">Identificadores gerados e documentos associados por dia.</p>
                </div>
                <StatusChip tone={totalIdentifiers > 0 ? "success" : "neutral"}>
                  {totalIdentifiers} no total
                </StatusChip>
              </div>
              <ActivityChart data={stats.activity || []} />
            </div>

            <div className="docid-panel p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-docid-muted">Estado dos identificadores</h2>
              <div className="space-y-3">
                {Object.entries(stats.identifiers.byStatus || {}).length === 0 ? (
                  <p className="text-sm text-docid-muted">Nenhum identificador registado.</p>
                ) : (
                  <>
                    {Object.entries(stats.identifiers.byStatus).map(([status, count]) => {
                      const Icon = STATUS_ICONS[status] || Hash;
                      const pct = totalIdentifiers > 0 ? Math.round((count / totalIdentifiers) * 100) : 0;
                      return (
                        <div key={status} className="group">
                          <div className="mb-1.5 flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-docid-text">
                              <Icon className={`h-4 w-4 ${STATUS_TONES[status] || "text-docid-muted"}`} />
                              {STATUS_LABELS[status] || "Outro"}
                            </span>
                            <span className="font-semibold text-docid-text">{count}</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-docid-surface-high">
                            <div
                              className={`h-full rounded-full transition-all ${STATUS_TONES[status] || "bg-docid-muted"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-docid-muted">{pct}%</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Recent docs + Pending approvals */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 docid-panel p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-docid-muted">Documentos recentes</h2>
                  <p className="text-xs text-docid-muted">Últimos documentos enviados à organização.</p>
                </div>
                <Link
                  to="/documentos"
                  className="text-xs font-medium text-docid-primary hover:underline"
                >
                  Ver todos <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Link>
              </div>
              {recentDocs.length === 0 ? (
                <EmptyState>Nenhum documento recente.</EmptyState>
              ) : (
                <div className="space-y-2">
                  {recentDocs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-docid-border bg-docid-surface-low p-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-docid-text truncate">{d.filename}</p>
                        <p className="text-xs text-docid-muted truncate">
                          {d.uploadedBy ?? "—"} · {new Date(d.createdAt).toLocaleDateString("pt-AO")}
                        </p>
                      </div>
                      <StatusChip
                        tone={d.status === "active" ? "success" : d.status === "draft" ? "neutral" : "info"}
                      >
                        {d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                      </StatusChip>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="docid-panel p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-docid-muted">Aprovações pendentes</h2>
                  <p className="text-xs text-docid-muted">Documentos à espera da sua decisão.</p>
                </div>
                {approvals.length > 0 && (
                  <Link
                    to="/aprovacoes"
                    className="text-xs font-medium text-docid-primary hover:underline"
                  >
                    Ver todas <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Link>
                )}
              </div>
              {approvals.length === 0 ? (
                <p className="text-sm text-docid-muted">Nenhuma aprovação pendente.</p>
              ) : (
                <ul className="space-y-2">
                  {approvals.slice(0, 5).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-docid-border bg-docid-surface-low p-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-docid-text truncate">
                          {a.document?.identifier?.identifier || a.document?.id?.slice(0, 8) || a.id.slice(0, 8)}
                        </p>
                        <p className="text-xs text-docid-muted truncate">
                          {a.supervisor?.fullName || a.sector?.name || "—"}
                        </p>
                      </div>
                      <StatusChip tone="warning">{a.status.charAt(0).toUpperCase() + a.status.slice(1)}</StatusChip>
                    </li>
                  ))}
                </ul>
              )}
              {approvals.length > 5 && (
                <p className="mt-3 text-xs text-docid-muted">{approvals.length} no total.</p>
              )}
            </div>
          </div>

          {/* Top categories */}
          <div className="docid-panel p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-docid-muted">
                Top categorias {stats.identifiers.byCategory.length > 0 && `(${stats.identifiers.byCategory.length})`}
              </h2>
            </div>
            {stats.identifiers.byCategory.length === 0 ? (
              <p className="text-sm text-docid-muted">Nenhuma categoria registada.</p>
            ) : (
              <div className="space-y-2">
                {stats.identifiers.byCategory.map((cat) => {
                  const pct = totalIdentifiers > 0 ? Math.round((cat.cnt / totalIdentifiers) * 100) : 0;
                  return (
                    <div key={cat.category} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 truncate text-sm text-docid-text">{cat.category}</span>
                      <div className="flex-1 h-2 overflow-hidden rounded-full bg-docid-surface-high">
                        <div className="h-full rounded-full bg-docid-primary-soft" style={{ width: `${Math.max(pct, 2)}%` }} />
                      </div>
                      <span className="w-12 shrink-0 text-right text-sm font-semibold text-docid-text">{cat.cnt}</span>
                      <span className="w-10 shrink-0 text-right text-xs text-docid-muted">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Offline queue summary */}
          <div className="docid-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-docid-surface-highest ${queueOnline ? "text-docid-secondary" : "text-docid-error"}`}>
                  {queueOnline ? <Upload className="h-5 w-5" /> : <CloudOff className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-docid-text">Fila offline</p>
                  <p className="text-xs text-docid-muted">
                    {queueOnline ? "Sincronizado com o servidor" : "Sem ligação — envios em fila"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${queuePending === 0 ? "bg-docid-secondary/10 text-docid-secondary" : "bg-docid-error/10 text-docid-error"}`}>
                  {queuePending} pendente{queuePending !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={() => setQueuePanelOpen(true)}
                  className="text-xs font-medium text-docid-primary hover:underline"
                >
                  Ver fila <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </button>
              </div>
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
