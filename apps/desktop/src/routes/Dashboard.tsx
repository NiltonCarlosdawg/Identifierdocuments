import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { AlertTriangle, Ban, Check, Download, FileText, Fingerprint, Plus, X } from "lucide-react";
import { MetricCard, PageHeader, StatusChip } from "../components/docid-ui";

function tone(status: string) {
  if (status === "processed") return "success" as const;
  if (status === "pending") return "warning" as const;
  if (status === "rejected") return "error" as const;
  if (status === "attached") return "success" as const;
  if (status === "active") return "neutral" as const;
  if (status === "cancelled") return "error" as const;
  return "neutral" as const;
}

function formatStatus(status: string) {
  const map: Record<string, string> = {
    processed: "Processado",
    pending: "Pendente",
    rejected: "Rejeitado",
    attached: "Anexado",
    active: "Activo",
    cancelled: "Cancelado",
  };
  return map[status] ?? status;
}

function formatFileSize(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocCard({ doc }: { doc: any }) {
  const [imgError, setImgError] = useState(false);
  const ext = doc.mimeType?.split("/")[1] || "ficheiro";

  return (
    <div className="docid-panel-low overflow-hidden rounded-xl border border-docid-border">
      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-docid-surface-lowest">
        {imgError ? (
          <div className="flex flex-col items-center justify-center text-docid-outline" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", width: "100%", gap: "0.5rem" }}>
            <svg className="h-12 w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10,9 9,9 8,9"/>
            </svg>
            <span style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--docid-outline)" }}>{ext}</span>
          </div>
        ) : (
          <img
            src={doc.thumbnailUrl}
            alt={doc.filename}
            className="h-full w-full object-contain"
            onError={() => setImgError(true)}
          />
        )}
        <div className="absolute right-2 top-2">
          <StatusChip tone={tone(doc.status)}>{formatStatus(doc.status)}</StatusChip>
        </div>
      </div>
      <div className="p-3">
        <p className="truncate font-mono text-sm font-semibold text-docid-primary-soft">
          {doc.identifier?.identifier ?? "—"}
        </p>
        <p className="mt-0.5 truncate text-xs text-docid-muted">
          {doc.filename ?? "Documento sem nome"}
        </p>
        <div className="mt-2 flex items-center justify-between text-xs text-docid-muted">
          <span>{formatFileSize(doc.fileSize)}</span>
          <span>{doc.createdAt ? new Date(doc.createdAt).toLocaleDateString("pt-AO") : "—"}</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [recentDocs, setRecentDocs] = useState<any[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<any>("/stats").catch(() => null),
      api.get<any>("/documents?limit=5&order=desc").catch(() => null),
      api.get<any>("/approvals?status=pending").catch(() => null),
    ]).then(([statsRes, docsRes, apprRes]) => {
      setStats(statsRes?.data ?? null);
      setRecentDocs(docsRes?.data ?? []);
      setPendingApprovals(apprRes?.data ?? []);
      setLoading(false);
    });
  }, []);

  const totalDocs = stats?.documents?.total ?? "0";
  const totalIdentifiers = stats?.identifiers?.total ?? "0";
  const cancelled = stats?.identifiers?.byStatus?.cancelled ?? "0";
  const failures = stats?.documents?.verificationFailures ?? "0";

  return (
    <div>
      <PageHeader
        title="Visão Geral"
        description="Métricas em tempo real e painel de controlo."
        actions={(
          <>
            <button className="docid-button-secondary"><Download className="h-4 w-4" /> Exportar</button>
            <button className="docid-button-primary" onClick={() => navigate("/identificadores")}><Plus className="h-4 w-4" /> Criar ID</button>
          </>
        )}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Documentos" value={loading ? "—" : totalDocs} icon={FileText} badge="hoje" accent="text-docid-primary-soft" />
        <MetricCard label="Pendentes" value={loading ? "—" : pendingApprovals.length.toString()} icon={AlertTriangle} badge="acções" accent="text-docid-tertiary" />
        <MetricCard label="Gerados" value={loading ? "—" : totalIdentifiers} icon={Fingerprint} badge="total" accent="text-docid-secondary" />
        <MetricCard label="Cancelados" value={loading ? "—" : cancelled} icon={Ban} badge="total" accent="text-docid-error" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="docid-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-docid-border px-5 py-4">
            <h2 className="font-semibold text-docid-text">Actividade Recente</h2>
            <button className="text-sm text-docid-primary-soft hover:underline" onClick={() => navigate("/documentos")}>Ver Todos</button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-docid-muted">A carregar...</div>
          ) : recentDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-docid-muted">
              <FileText className="mb-2 h-8 w-8 opacity-40" />
              <p className="text-sm">Nenhum documento ainda.</p>
            </div>
          ) : (
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {recentDocs.map((doc: any) => <DocCard key={doc.id} doc={doc} />)}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="docid-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Aprovações Pendentes</h2>
              <StatusChip tone="warning">{pendingApprovals.length} AÇÕES</StatusChip>
            </div>
            {loading ? (
              <p className="text-sm text-docid-muted">A carregar...</p>
            ) : pendingApprovals.length === 0 ? (
              <p className="text-sm text-docid-muted">Nenhuma aprovação pendente.</p>
            ) : (
              <div className="space-y-3">
                {pendingApprovals.slice(0, 3).map((appr: any) => (
                  <div key={appr.id} className="rounded-lg border border-docid-border bg-docid-surface-lowest p-3">
                    <p className="font-mono text-sm text-docid-primary-soft">{appr.document?.identifier?.identifier ?? "—"}</p>
                    <p className="mt-1 text-xs text-docid-muted">{appr.sector?.name ?? "Sector"}</p>
                    <div className="mt-3 flex gap-2">
                      <button className="flex-1 rounded bg-docid-secondary-container px-2 py-1.5 text-xs font-semibold text-white"><Check className="mr-1 inline h-3 w-3" />Aprovar</button>
                      <button className="flex-1 rounded border border-docid-border px-2 py-1.5 text-xs font-semibold text-docid-muted hover:border-docid-error hover:text-docid-error"><X className="mr-1 inline h-3 w-3" />Rejeitar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="docid-panel p-5">
            <h2 className="mb-4 font-semibold">Actividade do Sistema</h2>
            <div className="space-y-3 text-sm text-docid-muted">
              <p className="border-l border-docid-border pl-3">Sistema operacional.</p>
            </div>
          </section>
        </div>
      </div>

      {stats?.identifiers?.byCategory && stats.identifiers.byCategory.length > 0 && (
        <section className="docid-panel mt-6 p-5">
          <h2 className="mb-4 font-semibold">Por Categoria</h2>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            {stats.identifiers.byCategory.map((c: any) => (
              <div key={c.category} className="flex items-center justify-between rounded-lg bg-docid-surface-lowest px-3 py-2 text-sm">
                <span className="text-docid-muted">{c.category}</span>
                <span className="font-semibold">{c.cnt}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
