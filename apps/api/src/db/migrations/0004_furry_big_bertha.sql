ALTER TABLE "approvals" ADD COLUMN "requester_id" uuid;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "type" text DEFAULT 'cross_sector' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "default_visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "identifiers" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
