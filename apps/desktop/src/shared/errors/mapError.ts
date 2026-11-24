export const NETWORK_ERROR_MESSAGE = "Sem ligação ao servidor. Verifique a ligação e tente novamente.";
export const DEFAULT_ERROR_MESSAGE = "Não foi possível concluir a operação. Tente novamente.";

const NETWORK_PATTERNS = /network|failed to fetch|sem ligação ao servidor|sem resposta do servidor|erro de rede|error sending request|timed out|operation timed out|dns error|tls handshake|connection reset|connection refused|reqwest/i;

// Mensagens do servidor que são detalhes técnicos e não devem chegar a quem usa a aplicação.
const TECHNICAL_MESSAGE = /Erro\s*\d{3}|\b\d{3}\b|\b(?:ORG_ADMIN|SECTOR_SUPERVISOR|MEMBER|SMTP|HTTP|HTTPS|API|JSON|CSV|UUID|URL|Tauri|WebView|WebKit|Resend|SendGrid|PATCH|POST|PUT|DELETE|lease)\b|[a-z]+_[a-z_]+|\[object Object\]/i;
const UPPERCASE_CODE = /[A-Z][A-Z0-9_]{3,}/;

const STATUS_MESSAGES: Record<number, string> = {
  400: "Verifique os dados e tente novamente.",
  401: "A sua sessão terminou. Entre novamente.",
  403: "Não tem permissão para continuar.",
  404: "Não encontrámos o que procurava.",
  409: "Este registo já existe.",
  422: "Alguns dados não são válidos. Verifique e tente novamente.",
  429: "Demasiados pedidos. Aguarde um pouco e tente novamente.",
  500: "O servidor não conseguiu responder. Tente novamente.",
  502: "O servidor não conseguiu responder. Tente novamente.",
  503: "O servidor está temporariamente indisponível. Tente novamente.",
  504: "O servidor demorou a responder. Tente novamente.",
};

const ROLE_LABELS: Record<string, string> = {
  ORG_ADMIN: "Administrador",
  MEMBER: "Membro",
  SECTOR_SUPERVISOR: "Supervisor de sector",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho", active: "Activo", attached: "Anexado", cancelled: "Cancelado",
  pending: "Pendente", approved: "Aprovado", rejected: "Rejeitado", denied: "Negado",
  applying: "A aplicar", applied: "Aplicado", done: "Concluído", failed: "Falhado",
  conflict: "Conflito", queued: "Na fila", uploading: "A enviar", uploaded: "Enviado",
  synced: "Sincronizado", exhausted: "Esgotado", remote_released: "Libertado",
};

const LICENSE_STATE_LABELS: Record<string, string> = {
  active: "Activa", grace: "Em tolerância", expired: "Expirada", suspended: "Suspensa", trial: "Teste",
};

const SUBSCRIPTION_LABELS: Record<string, string> = {
  free: "Teste", trial: "Teste", paid: "Activa", expired: "Expirada", suspended: "Suspensa", active: "Activa",
};

export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg === "Failed to fetch" || msg === "NetworkError when attempting to fetch resource." || NETWORK_PATTERNS.test(msg);
}

export function friendlyMessage(message: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  const text = (message instanceof Error ? message.message : String(message ?? "")).trim();
  if (!text || TECHNICAL_MESSAGE.test(text) || UPPERCASE_CODE.test(text)) return fallback;
  return text;
}

export function statusMessage(status: number): string {
  return STATUS_MESSAGES[status] ?? DEFAULT_ERROR_MESSAGE;
}

export function mapError(err: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (isNetworkError(err)) return NETWORK_ERROR_MESSAGE;
  return friendlyMessage(err, fallback);
}

export function friendlyRole(name: string | null | undefined): string {
  if (!name) return "—";
  if (ROLE_LABELS[name]) return ROLE_LABELS[name];
  return /^[A-Z][A-Z0-9_]*_[A-Z0-9_]+$/.test(name) ? "Função de acesso" : name;
}

export function friendlyStatus(value: string | null | undefined): string {
  if (!value) return "—";
  return STATUS_LABELS[value] ?? "Por confirmar";
}

export function friendlyMime(mime: string | null | undefined): string {
  if (!mime) return "Ficheiro";
  if (/pdf/i.test(mime)) return "PDF";
  if (/png/i.test(mime)) return "PNG";
  if (/jpe?g/i.test(mime)) return "JPG";
  return "Ficheiro";
}

export function friendlyLicenseState(state: string | null | undefined): string {
  if (!state) return "—";
  return LICENSE_STATE_LABELS[state] ?? "Por confirmar";
}

export function friendlySubscription(status: string | null | undefined): string {
  if (!status) return "—";
  return SUBSCRIPTION_LABELS[status] ?? "Por confirmar";
}

export function friendlyPlan(plan: string | null | undefined): string {
  if (!plan) return "—";
  return plan === "free" || plan === "trial" ? "Teste" : plan;
}
