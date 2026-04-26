import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORIAS DE DOCUMENTOS
// Abrange todos os tipos de documentos que uma empresa emite,
// mais acordos e contratos.
// ─────────────────────────────────────────────────────────────────────────────

export const documentCategories = sqliteTable("document_categories", {
  id:          text("id").primaryKey(),          // ex: "PROP"
  name:        text("name").notNull(),            // ex: "Proposta Comercial"
  group:       text("group").notNull(),           // ex: "Comercial"
  description: text("description"),
  prefix:      text("prefix").notNull().unique(), // ex: "PROP" usado no ID gerado
  createdAt:   text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────────────────────────────────────
// IDENTIFICADORES GERADOS
// ─────────────────────────────────────────────────────────────────────────────

export const documentIdentifiers = sqliteTable("document_identifiers", {
  id:           text("id").primaryKey(),           // chave interna (nanoid)
  identifier:   text("identifier").notNull().unique(), // ex: VL-PROP-2026-0424-001
  categoryId:   text("category_id").notNull().references(() => documentCategories.id),
  status:       text("status", {
    enum: ["pending", "attached", "cancelled"]
  }).notNull().default("pending"),
  issuedTo:     text("issued_to"),                 // nome do cliente / destinatário
  description:  text("description"),               // breve descrição opcional
  sequence:     integer("sequence").notNull(),      // nº sequencial por categoria/ano
  year:         integer("year").notNull(),
  month:        integer("month").notNull(),
  day:          integer("day").notNull(),
  createdAt:    text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt:    text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  cancelledAt:  text("cancelled_at"),
  cancelReason: text("cancel_reason"),
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTOS ASSOCIADOS
// Um identificador pode ter exactamente 1 documento associado.
// Antes de guardar, o conteúdo do ficheiro é verificado para confirmar
// que contém o identificador.
// ─────────────────────────────────────────────────────────────────────────────

export const attachedDocuments = sqliteTable("attached_documents", {
  id:             text("id").primaryKey(),
  identifierId:   text("identifier_id").notNull().unique()
                    .references(() => documentIdentifiers.id),
  originalName:   text("original_name").notNull(),
  mimeType:       text("mime_type").notNull(),
  filePath:       text("file_path").notNull(),           // caminho no servidor
  fileSizeBytes:  integer("file_size_bytes").notNull(),
  identifierFound: integer("identifier_found", { mode: "boolean" }).notNull(),
  verifiedAt:     text("verified_at").notNull(),
  uploadedAt:     text("uploaded_at").notNull().$defaultFn(() => new Date().toISOString()),
  uploadedBy:     text("uploaded_by"),
});

// ─────────────────────────────────────────────────────────────────────────────
// LOG DE AUDITORIA
// ─────────────────────────────────────────────────────────────────────────────

export const auditLog = sqliteTable("audit_log", {
  id:           text("id").primaryKey(),
  action:       text("action").notNull(),  // "GENERATE" | "ATTACH" | "CANCEL" | "QUERY"
  identifierId: text("identifier_id"),
  detail:       text("detail"),
  performedBy:  text("performed_by"),
  createdAt:    text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─────────────────────────────────────────────────────────────────────────────
// RELAÇÕES
// ─────────────────────────────────────────────────────────────────────────────

export const categoryRelations = relations(documentCategories, ({ many }) => ({
  identifiers: many(documentIdentifiers),
}));

export const identifierRelations = relations(documentIdentifiers, ({ one }) => ({
  category: one(documentCategories, {
    fields: [documentIdentifiers.categoryId],
    references: [documentCategories.id],
  }),
  document: one(attachedDocuments, {
    fields: [documentIdentifiers.id],
    references: [attachedDocuments.identifierId],
  }),
}));

export const documentRelations = relations(attachedDocuments, ({ one }) => ({
  identifier: one(documentIdentifiers, {
    fields: [attachedDocuments.identifierId],
    references: [documentIdentifiers.id],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS EXPORTADOS
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentCategory   = typeof documentCategories.$inferSelect;
export type DocumentIdentifier = typeof documentIdentifiers.$inferSelect;
export type AttachedDocument   = typeof attachedDocuments.$inferSelect;
export type AuditLog           = typeof auditLog.$inferSelect;
