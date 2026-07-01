ALTER TABLE "approvals" ADD COLUMN "share_id" uuid;--> statement-breakpoint
ALTER TABLE "document_shares" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_share_id_document_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."document_shares"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sectors" ADD CONSTRAINT "sectors_supervisor_id_users_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_document_idx" ON "approvals" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_shares_document_idx" ON "document_shares" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_shares_user_idx" ON "document_shares" USING btree ("shared_with_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_shares_sector_idx" ON "document_shares" USING btree ("shared_with_sector_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_shares_status_idx" ON "document_shares" USING btree ("status");