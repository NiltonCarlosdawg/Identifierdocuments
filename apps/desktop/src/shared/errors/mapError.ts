export const NETWORK_ERROR_MESSAGE = "Sem ligação à API. Verifique a ligação e tente novamente.";

const NETWORK_PATTERNS = /network|failed to fetch|sem liga|sem resposta do servidor|erro de rede|error sending request|timed out|operation timed out|dns error|tls handshake|connection reset|connection refused|reqwest/i;

export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg === "Failed to fetch" || msg === "NetworkError when attempting to fetch resource." || NETWORK_PATTERNS.test(msg);
}

export function mapError(err: unknown, fallback = "Erro inesperado."): string {
  if (isNetworkError(err)) return NETWORK_ERROR_MESSAGE;
  const msg = err instanceof Error ? err.message : String(err);
  return msg || fallback;
}
