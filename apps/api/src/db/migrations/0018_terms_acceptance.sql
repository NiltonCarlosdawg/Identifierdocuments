ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "terms_accepted" boolean DEFAULT false NOT NULL;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp;