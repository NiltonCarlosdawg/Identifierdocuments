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

export type Document = {
  id: string;
  tenantId: string;
  identifierId: string;
  filename: string;
  mimeType: string;
  filePath: string;
  fileSize: number;
  extractedText: string | null;
  uploadedBy: string | null;
  uploadSource: "manual" | "scanner" | "sync";
  createdAt: string;
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
