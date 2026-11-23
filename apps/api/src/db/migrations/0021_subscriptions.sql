CREATE TABLE IF NOT EXISTS "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"payment_method" text NOT NULL,
	"phone" text,
	"contact_email" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"checkout_jti" text NOT NULL,
	"decided_at" timestamp,
	"decided_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"max_users" integer NOT NULL,
	"monthly_online_identifiers" integer NOT NULL,
	"offline_budget_per_machine" integer NOT NULL,
	"is_free" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "subscription_status" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "subscription_expires_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_decided_by_provider_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."provider_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX "orders_tenant_idx" ON "orders" ("tenant_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_checkout_jti_uidx" ON "orders" ("checkout_jti");--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "identifier_lease_batch_size";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "plan";--> statement-breakpoint
INSERT INTO plans (name, price, max_users, monthly_online_identifiers, offline_budget_per_machine, is_free, active, created_at)
SELECT 'Free', 0, 1, 10, 10, true, true, now()
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE is_free = true);

UPDATE organizations SET plan_id = (SELECT id FROM plans WHERE is_free = true LIMIT 1)
WHERE plan_id IS NULL;

ALTER TABLE organizations ALTER COLUMN plan_id SET NOT NULL;
-- removidos: identifier_lease_batch_size, plan (drizzle já gera o DROP se as colunas saíram do schema)
