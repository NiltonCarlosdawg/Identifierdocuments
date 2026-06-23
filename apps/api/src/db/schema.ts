import { pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  identifierPrefix: text("identifier_prefix").notNull().default("VL"),
  plan: text("plan").notNull().default("starter"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sectors = pgTable("sectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  code: text("code").notNull(),
  supervisorId: uuid("supervisor_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sectors_tenant_code_idx").on(t.tenantId, t.code),
  index("sectors_tenant_idx").on(t.tenantId),
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => organizations.id),
  sectorId: uuid("sector_id").references(() => sectors.id),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email),
]);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => organizations.id),
  name: text("name").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("roles_tenant_name_idx").on(t.tenantId, t.name),
]);

export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
}, (t) => [
  uniqueIndex("role_perm_unique_idx").on(t.roleId, t.resource, t.action),
]);

export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  sectorId: uuid("sector_id").references(() => sectors.id),
  grantedBy: uuid("granted_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_role_unique_idx").on(t.userId, t.roleId),
]);

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  group: text("group").notNull(),
  prefix: text("prefix").notNull().unique(),
  defaultVisibility: text("default_visibility", { enum: ["public", "sector_only"] }).notNull().default("public"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const identifiers = pgTable("identifiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => organizations.id),
  sectorId: uuid("sector_id").notNull().references(() => sectors.id),
  categoryId: text("category_id").notNull().references(() => categories.id),
  identifier: text("identifier").notNull(),
  sequence: integer("sequence").notNull(),
  issuedTo: text("issued_to"),
  description: text("description"),
  visibility: text("visibility", { enum: ["public", "sector_only"] }).notNull().default("public"),
  status: text("status", { enum: ["draft", "active", "attached", "cancelled"] }).notNull().default("draft"),
  origin: text("origin", { enum: ["digital", "physical"] }).notNull().default("digital"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("identifiers_tenant_idx").on(t.tenantId),
  index("identifiers_status_idx").on(t.status),
  index("identifiers_created_idx").on(t.createdAt),
  uniqueIndex("identifiers_tenant_identifier_idx").on(t.tenantId, t.identifier),
]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => organizations.id),
  identifierId: uuid("identifier_id").notNull().unique().references(() => identifiers.id),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").notNull(),
  extractedText: text("extracted_text"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  uploadSource: text("upload_source", { enum: ["manual", "scanner", "sync"] }).notNull().default("manual"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("documents_tenant_idx").on(t.tenantId),
]);

export const documentShares = pgTable("document_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id),
  sharedBy: uuid("shared_by").notNull().references(() => users.id),
  sharedWithSectorId: uuid("shared_with_sector_id").references(() => sectors.id),
  sharedWithUserId: uuid("shared_with_user_id").references(() => users.id),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => organizations.id),
  documentId: uuid("document_id").notNull().references(() => documents.id),
  sectorId: uuid("sector_id").notNull().references(() => sectors.id),
  supervisorId: uuid("supervisor_id").references(() => users.id),
  requesterId: uuid("requester_id").references(() => users.id),
  type: text("type", { enum: ["cross_sector", "access_request"] }).notNull().default("cross_sector"),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  notes: text("notes"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => [
  index("approvals_tenant_idx").on(t.tenantId),
  index("approvals_status_idx").on(t.status),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resource_id"),
  metadata: text("metadata"),
  ip: text("ip"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("audit_tenant_idx").on(t.tenantId),
  index("audit_created_idx").on(t.createdAt),
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("notifications_user_idx").on(t.userId),
  index("notifications_read_idx").on(t.isRead),
]);

export const organizationRelations = relations(organizations, ({ many }) => ({
  sectors: many(sectors),
  users: many(users),
  identifiers: many(identifiers),
  documents: many(documents),
  approvals: many(approvals),
  auditLogs: many(auditLogs),
}));

export const sectorRelations = relations(sectors, ({ one, many }) => ({
  organization: one(organizations, { fields: [sectors.tenantId], references: [organizations.id] }),
  supervisor: one(users, { fields: [sectors.supervisorId], references: [users.id] }),
  members: many(users),
  identifiers: many(identifiers),
}));

export const userRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, { fields: [users.tenantId], references: [organizations.id] }),
  sector: one(sectors, { fields: [users.sectorId], references: [sectors.id] }),
  userRoles: many(userRoles),
  createdIdentifiers: many(identifiers, { relationName: "createdByIdentifiers" }),
  uploadedDocuments: many(documents),
  sharedDocuments: many(documentShares, { relationName: "sharedByShares" }),
  approvals: many(approvals),
}));

export const roleRelations = relations(roles, ({ one, many }) => ({
  organization: one(organizations, { fields: [roles.tenantId], references: [organizations.id] }),
  permissions: many(rolePermissions),
  userRoles: many(userRoles),
}));

export const rolePermissionRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
}));

export const userRoleRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
  sector: one(sectors, { fields: [userRoles.sectorId], references: [sectors.id] }),
}));

export const identifierRelations = relations(identifiers, ({ one }) => ({
  organization: one(organizations, { fields: [identifiers.tenantId], references: [organizations.id] }),
  sector: one(sectors, { fields: [identifiers.sectorId], references: [sectors.id] }),
  category: one(categories, { fields: [identifiers.categoryId], references: [categories.id] }),
  createdByUser: one(users, { fields: [identifiers.createdBy], references: [users.id], relationName: "createdByIdentifiers" }),
  document: one(documents, { fields: [identifiers.id], references: [documents.identifierId] }),
}));

export const documentRelations = relations(documents, ({ one, many }) => ({
  organization: one(organizations, { fields: [documents.tenantId], references: [organizations.id] }),
  identifier: one(identifiers, { fields: [documents.identifierId], references: [identifiers.id] }),
  uploader: one(users, { fields: [documents.uploadedBy], references: [users.id] }),
  shares: many(documentShares),
  approvals: many(approvals),
}));

export const documentShareRelations = relations(documentShares, ({ one }) => ({
  document: one(documents, { fields: [documentShares.documentId], references: [documents.id] }),
  sharer: one(users, { fields: [documentShares.sharedBy], references: [users.id], relationName: "sharedByShares" }),
  sector: one(sectors, { fields: [documentShares.sharedWithSectorId], references: [sectors.id] }),
  user: one(users, { fields: [documentShares.sharedWithUserId], references: [users.id] }),
}));

export const approvalRelations = relations(approvals, ({ one }) => ({
  organization: one(organizations, { fields: [approvals.tenantId], references: [organizations.id] }),
  document: one(documents, { fields: [approvals.documentId], references: [documents.id] }),
  sector: one(sectors, { fields: [approvals.sectorId], references: [sectors.id] }),
  supervisor: one(users, { fields: [approvals.supervisorId], references: [users.id] }),
}));
