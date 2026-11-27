export interface DocIdentifier {
  id: string;
  identifier: string;
  categoryId: string;
  categoryName: string;
  visibility?: string;
  sectorId?: string;
}

export interface DocRow {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  status: string;
  createdAt: string;
  fileUrl: string;
  thumbnailUrl: string;
  kind?: "primary" | "attachment";
  label?: string | null;
  tags?: string[];
  identifier: DocIdentifier | null;
  uploadedBy: string | null;
  uploadedById?: string | null;
  sharedWithMe?: boolean;
}

export interface DocVersionMeta {
  id: string;
  version: number;
  filename: string;
  fileSize: number;
  mimeType: string;
  isCurrent: boolean;
  createdAt: string;
  uploadedBy: string | null;
}

export interface DocAttachmentMeta {
  id: string;
  kind: string;
  label: string | null;
  filename: string | null;
  fileSize: number | null;
  mimeType: string | null;
  createdAt: string;
}

export interface DocDetail extends DocRow {
  versions?: DocVersionMeta[];
  attachments?: DocAttachmentMeta[];
  primaryDocumentId?: string | null;
  restricted?: boolean;
}

export interface CategoryFacet { id: string; name: string; count: number }

export interface DocListMeta {
  total: number;
  page: number;
  limit: number;
  categories?: CategoryFacet[];
}

export type DocScope = "all" | "mine" | "shared";

export interface DocFilters {
  q: string;
  scope: DocScope;
  categoryId: string;
  status: string;
  from: string;
  to: string;
  page: number;
}

export const EMPTY_FILTERS: DocFilters = { q: "", scope: "all", categoryId: "", status: "", from: "", to: "", page: 1 };

/** Filtros ↔ query string da API (só os preenchidos). */
export function filtersToQuery(f: DocFilters, limit: number): string {
  const p = new URLSearchParams({ page: String(f.page), limit: String(limit) });
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.scope !== "all") p.set("scope", f.scope);
  if (f.categoryId) p.set("categoryId", f.categoryId);
  if (f.status) p.set("status", f.status);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p.toString();
}

export function activeFilterCount(f: DocFilters): number {
  return [f.categoryId, f.status, f.from || f.to].filter(Boolean).length;
}

export function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "Hoje 14:05", "Ontem", "12/11/2026". */
export function friendlyDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `Hoje ${d.toLocaleTimeString("pt-AO", { hour: "2-digit", minute: "2-digit" })}`;
  if (diff === 1) return "Ontem";
  return d.toLocaleDateString("pt-AO");
}

export const DOCUMENT_PRESET_TAGS = ["urgente", "renovação pendente", "assinado", "rascunho", "arquivado"] as const;
