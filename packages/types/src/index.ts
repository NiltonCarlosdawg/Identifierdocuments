export type Organization = {
  id: string;
  name: string;
  slug: string;
  identifierPrefix: string;
  plan: "starter" | "business" | "enterprise";
  isActive: boolean;
  createdAt: string;
};

export type Sector = {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  supervisorId: string | null;
  createdAt: string;
};

export type User = {
  id: string;
  tenantId: string;
  sectorId: string | null;
  email: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
};

export type Role = {
  id: string;
  tenantId: string | null;
  name: string;
  isSystem: boolean;
  createdAt: string;
};

export type RolePermission = {
  id: string;
  roleId: string;
  resource: string;
  action: string;
};

export type UserRole = {
  id: string;
  userId: string;
  roleId: string;
  sectorId: string | null;
  grantedBy: string | null;
  createdAt: string;
};

export type Category = {
  id: string;
  name: string;
  group: string;
  prefix: string;
  defaultVisibility: "public" | "sector_only";
  createdAt: string;
};

export type Identifier = {
  id: string;
  tenantId: string;
  sectorId: string;
  categoryId: string;
  identifier: string;
  sequence: number;
  issuedTo: string | null;
  description: string | null;
  visibility: "public" | "sector_only";
  status: "draft" | "active" | "attached" | "cancelled";
  origin: "digital" | "physical";
  createdBy: string | null;
  createdAt: string;
};

export type DocumentKind = "primary" | "attachment";

export type DocumentVersion = {
  id: string;
  documentId: string;
  version: number;
  filename: string;
  mimeType: string;
  filePath: string;
  fileSize: number;
  extractedText: string | null;
  uploadedBy: string | null;
  uploadSource: "manual" | "scanner" | "sync";
  isCurrent: boolean;
  createdAt: string;
};

/** Categorias renderizadas como perfis (contratos; candidaturas futuras). */
export const PROFILE_CATEGORY_IDS = ["CPS", "CPF", "CTR", "CLA"] as const;
export type ProfileCategoryId = (typeof PROFILE_CATEGORY_IDS)[number];

export const DOCUMENT_PRESET_TAGS = [
  "urgente",
  "renovação pendente",
  "assinado",
  "rascunho",
  "arquivado",
] as const;
export type DocumentPresetTag = (typeof DOCUMENT_PRESET_TAGS)[number];

export type Document = {
  id: string;
  tenantId: string;
  identifierId: string;
  kind: DocumentKind;
  label: string | null;
  tags?: string[];
  uploadedBy: string | null;
  createdAt: string;
  /** Campos hidratados da versão current (API). */
  filename?: string | null;
  mimeType?: string | null;
  filePath?: string | null;
  fileSize?: number | null;
  extractedText?: string | null;
  uploadSource?: "manual" | "scanner" | "sync" | null;
  currentVersion?: number | null;
};

export type DocumentShare = {
  id: string;
  documentId: string;
  sharedBy: string;
  sharedWithSectorId: string | null;
  sharedWithUserId: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type Approval = {
  id: string;
  tenantId: string;
  documentId: string;
  sectorId: string;
  supervisorId: string | null;
  requesterId: string | null;
  type: "cross_sector" | "access_request";
  status: "pending" | "approved" | "rejected";
  notes: string | null;
  requestedAt: string;
  resolvedAt: string | null;
};

export type AuditLog = {
  id: string;
  tenantId: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: string | null;
  ip: string | null;
  createdAt: string;
};

export type ApiResponse<T> = {
  data?: T;
  meta?: { total: number; page: number; limit: number };
  error?: { code: string; message: string; details?: unknown };
};
