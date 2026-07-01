import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { AlertTriangle, Ban, Check, Download, FileSpreadsheet, FileText, Fingerprint, Plus, Presentation, X } from "lucide-react";
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

/**
 * CORREÇÃO — causa raiz da pré-visualização não funcionar:
 *
 * `doc.thumbnailUrl` aponta para uma rota protegida por requireAuth() no backend
 * (GET /documents/:id/thumbnail). Uma tag <img src="..."> faz um pedido GET puro do
 * browser/webview, sem cabeçalho Authorization — ao contrário de `api.get(...)`, que
 * injecta o token guardado em useAuthStore. Sem token, o backend devolve 401, a
 * imagem falha a carregar, o onError dispara e cai sempre no ícone de fallback.
 *
 * Correcção final (após confirmar api.ts, config.ts e auth.ts):
 * 1. Usa `api.getBlob()` — novo método em services/api.ts que reutiliza exactamente o
 *    mesmo token (useAuthStore) e o mesmo fluxo de refresh-e-retry em 401 que o resto
 *    da app já usa, em vez de duplicar essa lógica aqui (a minha tentativa anterior
 *    assumiu incorrectamente localStorage — o token vive num store Zustand com
 *    storage seguro, daí continuar a falhar).
 * 2. Ignora por completo o host embutido em `doc.thumbnailUrl` (construído no
 *    servidor a partir de process.env.API_BASE_URL) e constrói o pedido a partir de
 *    `doc.id` + o `apiBaseUrl` configurado no cliente (useAppConfigStore, via
 *    getBaseUrl() dentro de api.ts). Este é um desktop app com apiBaseUrl
 *    configurável pelo utilizador (ex.: apontar para um domínio em cPanel) — se o
 *    API_BASE_URL do servidor não estiver correctamente definido, o URL absoluto que
 *    ele devolve pode nunca corresponder ao host que o cliente deve realmente usar.
 *    Usar sempre o path relativo elimina essa fonte de discrepância.
 */
function useThumbnail(docId: string | undefined) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  // "loading" | "ready" | "empty" (sem thumbnail gerada, ex. 204) | "error" (falha real)
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    if (!docId) { setState("empty"); return; }

    let cancelled = false;
    let currentObjectUrl: string | null = null;
    setState("loading");

    api.getBlob(`/documents/${docId}/thumbnail`)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) { setState("empty"); return; }
        currentObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(currentObjectUrl);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        // CORREÇÃO: antes "sem thumbnail" (204, normal) e "falhou a buscar" (erro real,
        // ex. rede, 500) resultavam exactamente no mesmo ícone de fallback, sem
        // distinção nenhuma — impossível perceber, olhando para o ecrã, se é preciso
        // investigar o backend ou se é apenas um documento que ainda não gerou
        // thumbnail. Agora o erro fica registado na consola do browser com o docId,
        // e o estado "error" é visualmente distinto (ver DocRow).
        console.error(`[thumbnail] Falha ao buscar pré-visualização para documento ${docId}:`, err);
        setState("error");
      });

    return () => {
      cancelled = true;
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [docId]);

  return { objectUrl, state };
}

// CORREÇÃO (menor, à parte do bug de auth): `doc.mimeType.split("/")[1]` para tipos
// Office devolve strings como "vnd.openxmlformats-officedocument.wordprocessingml.document"
// — exactamente o que aparecia ilegível no ecrã de fallback. Preferimos a extensão do
// nome do ficheiro (mais curta e já familiar ao utilizador); só caímos no mimeType
// como último recurso, e nesse caso mostramos um rótulo curto conhecido em vez do
// mimeType inteiro.
const MIME_LABELS: Record<string, string> = {
  "vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "msword": "doc",
  "vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "vnd.ms-excel": "xls",
  "vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "vnd.ms-powerpoint": "ppt",
  pdf: "pdf",
  plain: "txt",
};

function fileExtLabel(doc: any): string {
  const fromName = doc.filename?.split(".").pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  const mimeSub = doc.mimeType?.split("/")[1];
  return (mimeSub && MIME_LABELS[mimeSub]) || "ficheiro";
}

// Ícone + cor por tipo de ficheiro, ao estilo Word/Excel/PowerPoint — usado como
// fallback quando ainda não há thumbnail real gerada (ou como ícone único, já que o
// formato de lista pedido pelo utilizador usa sempre um ícone de tipo, não uma
// pré-visualização de conteúdo — só a vista em cartões grandes do Word mostra
// conteúdo real; a lista mostra sempre o ícone do tipo).
const FILE_TYPE_META: Record<string, { Icon: typeof FileText; bg: string }> = {
  docx: { Icon: FileText, bg: "#2B579A" },
  doc: { Icon: FileText, bg: "#2B579A" },
  xlsx: { Icon: FileSpreadsheet, bg: "#217346" },
  xls: { Icon: FileSpreadsheet, bg: "#217346" },
  pptx: { Icon: Presentation, bg: "#B7472A" },
  ppt: { Icon: Presentation, bg: "#B7472A" },
  pdf: { Icon: FileText, bg: "#DC3B27" },
};
const DEFAULT_FILE_TYPE_META = { Icon: FileText, bg: "var(--docid-surface-lowest)" };

function fileTypeMeta(doc: any) {
  return FILE_TYPE_META[fileExtLabel(doc)] || DEFAULT_FILE_TYPE_META;
}

// Formata a data ao estilo do Word Online: relativo nas últimas 24h ("Há 9 h"),
// dia+mês abreviado depois disso ("8 de mai."). Usa createdAt (data de anexação),
// já que a API não regista "última abertura" — se isso vier a existir, é só trocar
// o campo de origem aqui.
function formatOpened(dateStr: string | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const diffMin = (Date.now() - date.getTime()) / 60000;
  if (diffMin < 1) return "Agora mesmo";
  if (diffMin < 60) return `Há ${Math.round(diffMin)} m`;
  const diffH = diffMin / 60;
  if (diffH < 24) return `Há ${Math.round(diffH)} h`;
  const diffDays = diffH / 24;
  if (diffDays < 7) return `Há ${Math.round(diffDays)} d`;
  return date.toLocaleDateString("pt-AO", { day: "numeric", month: "short" });
}

function DocRow({ doc }: { doc: any }) {
  const { Icon, bg } = fileTypeMeta(doc);
  const { objectUrl, state } = useThumbnail(doc.id);
  const hasThumbnail = state === "ready" && !!objectUrl;

  return (
    <div className="flex items-center gap-4 border-b border-docid-border px-5 py-3 last:border-b-0 hover:bg-docid-surface-lowest/60 transition-colors">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded"
        style={{ backgroundColor: hasThumbnail ? "transparent" : bg }}
      >
        {hasThumbnail ? (
          <img src={objectUrl!} alt={doc.filename} className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-5 w-5 text-white" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-docid-text">
          {doc.filename ?? "Documento sem nome"}
        </p>
        <p className="truncate font-mono text-xs text-docid-muted">
          {doc.identifier?.identifier ?? "—"}
        </p>
      </div>

      <div className="hidden w-28 shrink-0 sm:block">
        <StatusChip tone={tone(doc.status)}>{formatStatus(doc.status)}</StatusChip>
      </div>

      <div className="w-20 shrink-0 text-right text-xs text-docid-muted sm:w-24 sm:text-left">
        {formatOpened(doc.createdAt)}
      </div>

      <div className="hidden w-32 shrink-0 truncate text-xs text-docid-muted md:block">
        {doc.uploadedBy ?? "—"}
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
            <div>
              <div className="hidden items-center gap-4 border-b border-docid-border px-5 py-2 text-xs font-medium uppercase tracking-wide text-docid-muted sm:flex">
                <div className="h-10 w-10 shrink-0" />
                <div className="min-w-0 flex-1">Nome</div>
                <div className="hidden w-28 shrink-0 sm:block">Estado</div>
                <div className="w-20 shrink-0 sm:w-24">Aberto</div>
                <div className="hidden w-32 shrink-0 md:block">Proprietário</div>
              </div>
              {recentDocs.map((doc: any) => <DocRow key={doc.id} doc={doc} />)}
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