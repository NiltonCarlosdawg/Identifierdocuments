import { useAuthStore } from "../stores/auth";
import { useAppConfigStore } from "../stores/config";

function getBaseUrl(): string {
  return useAppConfigStore.getState().apiBaseUrl || "http://localhost:3000";
}

async function refreshCurrentToken(): Promise<boolean> {
  const currentToken = useAuthStore.getState().token;
  if (!currentToken) return false;
  try {
      const res = await fetch(`${getBaseUrl()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: currentToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.data?.token) {
      useAuthStore.getState().login(data.data.token, data.data.user);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
  }

  const res = await fetch(`${getBaseUrl()}${path}`, { ...options, headers });

  if (res.status === 401 && path !== "/auth/refresh") {
    const refreshed = await refreshCurrentToken();
    if (refreshed) {
      const newToken = useAuthStore.getState().token;
      headers["Authorization"] = `Bearer ${newToken}`;
      const retryRes = await fetch(`${getBaseUrl()}${path}`, { ...options, headers });
      if (!retryRes.ok) {
        const body = await retryRes.json().catch(() => ({}));
        const message = body.message || body.error?.message || `Erro ${retryRes.status}`;
        throw new Error(message);
      }
      const ct = retryRes.headers.get("content-type");
      if (ct?.includes("application/json")) return retryRes.json();
      return retryRes as unknown as T;
    }
    useAuthStore.getState().logout();
    throw new Error("Sessão expirada");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.message || body.error?.message || `Erro ${res.status}`;
    throw new Error(message);
  }

  const contentType = res.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return res.json();
  }
  return res as unknown as T;
}

async function requestBlob(path: string): Promise<Blob | null> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res = await fetch(`${getBaseUrl()}${path}`, { headers });

  if (res.status === 401) {
    const refreshed = await refreshCurrentToken();
    if (!refreshed) {
      useAuthStore.getState().logout();
      throw new Error("Sessão expirada");
    }
    const newToken = useAuthStore.getState().token;
    headers["Authorization"] = `Bearer ${newToken}`;
    res = await fetch(`${getBaseUrl()}${path}`, { headers });
  }

  // 204 = pedido válido mas sem conteúdo ainda (ex.: thumbnail não gerada). Distinto
  // de um erro real — o chamador deve tratar isto como "sem imagem", não como falha.
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  return res.blob();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  // CORREÇÃO: novo método dedicado para recursos binários protegidos (ex.: thumbnails,
  // downloads de ficheiros). Antes, componentes como <img src={doc.thumbnailUrl}>
  // pediam estes recursos directamente do browser/webview, sem passar pelo cliente
  // `api` — logo sem Authorization e sem o fluxo de refresh de token, resultando em
  // 401 permanente e pré-visualizações que nunca carregavam. Centralizado aqui em vez
  // de duplicado nos componentes, para manter uma única fonte de verdade sobre como
  // autenticar pedidos.
  getBlob: (path: string) => requestBlob(path),
};

export async function getMe() {
  return request<{ data: {
    id: string; email: string; fullName: string; isActive: boolean;
    tenantId: string; sectorId: string | null; sectorName: string | null;
    organizationName: string | null; roles: string[]; createdAt: string;
  } | null }>("/auth/me");
}