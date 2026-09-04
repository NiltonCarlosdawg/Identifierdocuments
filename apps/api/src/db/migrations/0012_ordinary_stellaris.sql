CREATE TABLE IF NOT EXISTS "document_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_records" (
	"tenant_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_tenant_id_idempotency_key_pk" PRIMARY KEY("tenant_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "document_shares" ADD COLUMN IF NOT EXISTS "source_request_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_access_requests" ADD CONSTRAINT "document_access_requests_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_access_requests" ADD CONSTRAINT "document_access_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_access_requests" ADD CONSTRAINT "document_access_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_access_requests" ADD CONSTRAINT "document_access_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dar_tenant_idx" ON "document_access_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dar_document_idx" ON "document_access_requests" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dar_requester_idx" ON "document_access_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dar_status_idx" ON "document_access_requests" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_source_request_id_document_access_requests_id_fk" FOREIGN KEY ("source_request_id") REFERENCES "public"."document_access_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_shares_source_request_idx" ON "document_shares" USING btree ("source_request_id");