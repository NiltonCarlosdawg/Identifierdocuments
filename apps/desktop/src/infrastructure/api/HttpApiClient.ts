import type { IApiClient } from "../../application/ports/IApiClient";
import type { IAuthRepository } from "../../domain/repositories/IAuthRepository";
import type { ISyncService } from "../../application/ports/ISyncService";

export class HttpApiClient implements IApiClient {
  private defaultBaseUrl = "http://localhost:3000";
  constructor(
    private readonly authRepo: IAuthRepository,
    private readonly getBaseUrl?: () => string,
    private readonly sync?: ISyncService,
  ) {}
  private get baseUrl(): string { return this.getBaseUrl?.() ?? this.defaultBaseUrl; }

  private isMutationMethod(method: string): boolean {
    return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
  }

  private generateIdempotencyKey(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private resourceKeyFromPath(path: string): string | undefined {
    const segs = path.split("/").filter(Boolean);
    if (segs.length < 2) return undefined;
    const actionWords = new Set(["cancel", "share", "deactivate", "feedback"]);
    if (actionWords.has(segs[segs.length - 1])) segs.pop();
    return segs.join("/");
  }

  private async enqueueOfflineWrite(method: string, path: string, body: unknown): Promise<boolean> {
    if (!this.sync?.isAvailable()) return false;
    if (body instanceof FormData) return false;
    try {
      const bodyText = body != null ? JSON.stringify(body) : null;
      const idempotencyKey = `${method}:${path}:${this.generateIdempotencyKey()}`;
      await this.sync.enqueueWrite(method, path, bodyText, idempotencyKey, this.resourceKeyFromPath(path));
      return true;
    } catch { return false; }
  }

  private async refreshToken(): Promise<boolean> {
    const currentToken = this.authRepo.getToken();
    if (!currentToken) return false;
    try {
      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: currentToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.data?.token) { this.authRepo.setSession(data.data.token, data.data.user); return true; }
      return false;
    } catch { return false; }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = (options.method ?? "GET").toUpperCase();
    const token = this.authRepo.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (options.body instanceof FormData) delete headers["Content-Type"];

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    } catch {
      if (this.isMutationMethod(method)) {
        const queued = await this.enqueueOfflineWrite(method, path, options.body);
        if (queued) {
          throw new Error("Sem ligação. A alteração ficou pendente e será sincronizada automaticamente quando a ligação voltar.");
        }
      }
      throw new Error("Sem ligação ao servidor.");
    }
    if (res.status === 401 && path !== "/auth/refresh") {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        const newToken = this.authRepo.getToken();
        headers["Authorization"] = `Bearer ${newToken}`;
        res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
      } else { this.authRepo.clearSession(); throw new Error("Sessão expirada"); }
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || body.error?.message || `Erro ${res.status}`);
    }
    const ct = res.headers.get("content-type");
    if (ct?.includes("application/json")) return res.json();
    return res as unknown as T;
  }

  private async requestBlob(path: string): Promise<Blob | null> {
    const token = this.authRepo.getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    let res = await fetch(`${this.baseUrl}${path}`, { headers });
    if (res.status === 401) {
      const refreshed = await this.refreshToken();
      if (!refreshed) { this.authRepo.clearSession(); throw new Error("Sessão expirada"); }
      headers["Authorization"] = `Bearer ${this.authRepo.getToken()}`;
      res = await fetch(`${this.baseUrl}${path}`, { headers });
    }
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    return res.blob();
  }

  get = <T>(path: string) => this.request<T>(path);
  post = <T>(path: string, body?: unknown) => this.request<T>(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) });
  patch = <T>(path: string, body: unknown) => this.request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  delete = <T>(path: string) => this.request<T>(path, { method: "DELETE" });
  getBlob = (path: string) => this.requestBlob(path);
}
