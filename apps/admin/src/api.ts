const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://127.0.0.1:3002";
const TOKEN_KEY = "docid-provider-token";

export type Plan = {
  id: string; name: string; price: number; maxUsers: number;
  monthlyOnlineIdentifiers: number; offlineBudgetPerMachine: number;
  isFree: boolean; active: boolean;
};

export type Order = {
  id: string; tenantId: string; planId: string; paymentMethod: string;
  phone: string | null; contactEmail: string | null; status: "pending" | "approved" | "rejected";
  rejectReason: string | null; createdAt: string; tenantName: string; planName: string;
};

export type Tenant = {
  id: string; name: string; slug: string; planName: string;
  expiresAt: string | null; userCount: number; status: string;
};

export type License = {
  tenantId: string; tenantName: string; licenseNumber: string | null;
  state: string; status: string | null; maxUsers: number | null;
  validUntil: string | null; planName: string | null; activeUsers: number;
};

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) clearToken();
    throw new Error(body?.error?.message || `Erro ${res.status}`);
  }
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string }>("/provider/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  plans: () => request<{ plans: Plan[] }>("/provider/plans"),
  savePlan: (plan: Partial<Plan> & { name: string; price: number; maxUsers: number; monthlyOnlineIdentifiers: number; offlineBudgetPerMachine: number }) =>
    request<Plan>(plan.id ? `/provider/plans/${plan.id}` : "/provider/plans", {
      method: plan.id ? "PUT" : "POST",
      body: JSON.stringify(plan),
    }),
  orders: () => request<Order[]>("/provider/orders"),
  approveOrder: (id: string) => request<{ orderId: string }>(`/provider/orders/${id}/approve`, { method: "POST" }),
  rejectOrder: (id: string, reason: string) => request<{ orderId: string }>(`/provider/orders/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  tenants: () => request<Tenant[]>("/provider/tenants"),
  setTenantStatus: (id: string, action: "suspend" | "reactivate") =>
    request<{ id: string; status: string }>(`/provider/tenants/${id}/${action}`, { method: "POST" }),
  licenses: () => request<License[]>("/provider/licenses"),
  updateLicense: (number: string, patch: Record<string, unknown>) =>
    request<{ updated: boolean }>(`/provider/licenses/${encodeURIComponent(number)}`, { method: "PATCH", body: JSON.stringify(patch) }),
};
