CREATE TABLE IF NOT EXISTS "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer NOT NULL,
	"extracted_text" text,
	"uploaded_by" uuid,
	"upload_source" text DEFAULT 'manual' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'primary' NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "label" text;
--> statement-breakpoint
INSERT INTO "document_versions" (
	"tenant_id", "document_id", "version", "filename", "mime_type", "file_path",
	"file_size", "extracted_text", "uploaded_by", "upload_source", "is_current", "created_at"
)
SELECT
	d."tenant_id", d."id", 1, d."filename", d."mime_type", d."file_path",
	d."file_size", d."extracted_text", d."uploaded_by", COALESCE(d."upload_source", 'manual'), true, d."created_at"
FROM "documents" d
WHERE NOT EXISTS (
	SELECT 1 FROM "document_versions" v WHERE v."document_id" = d."id"
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_identifier_id_unique";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "filename";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "mime_type";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "file_path";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "file_size";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "extracted_text";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "upload_source";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_identifier_idx" ON "documents" USING btree ("identifier_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_one_primary_per_identifier_idx" ON "documents" USING btree ("identifier_id") WHERE kind = 'primary';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_tenant_idx" ON "document_versions" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_document_idx" ON "document_versions" USING btree ("document_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_versions_doc_version_uidx" ON "document_versions" USING btree ("document_id","version");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_versions_one_current_idx" ON "document_versions" USING btree ("document_id") WHERE is_current = true;
--> statement-breakpoint
ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_document_versions ON document_versions;
--> statement-breakpoint
CREATE POLICY tenant_isolation_document_versions ON document_versions
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
