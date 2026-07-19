CREATE TABLE IF NOT EXISTS "classifier_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid,
	"suggested_category_id" text NOT NULL,
	"chosen_category_id" text NOT NULL,
	"accepted" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "classifier_feedback" ADD CONSTRAINT "classifier_feedback_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "classifier_feedback" ADD CONSTRAINT "classifier_feedback_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classifier_feedback_tenant_idx" ON "classifier_feedback" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classifier_feedback_document_idx" ON "classifier_feedback" USING btree ("document_id");