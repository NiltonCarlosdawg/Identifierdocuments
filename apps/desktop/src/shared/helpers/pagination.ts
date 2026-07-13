export interface PaginationParams { page?: number; limit?: number; sort?: string; order?: "asc" | "desc"; }

export function buildQueryString(params: PaginationParams): string {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.limit) search.set("limit", String(params.limit));
  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);
  return search.toString();
}
