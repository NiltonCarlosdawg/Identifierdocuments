-- M0: Geração Offline de Identificadores

ALTER TABLE categories ADD COLUMN IF NOT EXISTS "requires_sequential" boolean DEFAULT false NOT NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS "identifier_lease_batch_size" integer DEFAULT 50 NOT NULL;

CREATE TABLE IF NOT EXISTS "devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES organizations(id),
  "user_id" uuid REFERENCES users(id),
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'force_released')),
  "last_seen_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_tenant_idx ON devices(tenant_id);
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id);

CREATE TABLE IF NOT EXISTS "identifier_leases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES organizations(id),
  "category_id" text NOT NULL REFERENCES categories(id),
  "sector_id" uuid NOT NULL REFERENCES sectors(id),
  "device_id" uuid NOT NULL REFERENCES devices(id),
  "start_seq" integer NOT NULL,
  "end_seq" integer NOT NULL,
  "used_up_to" integer,
  "status" text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'force_released')),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "released_at" timestamp
);
CREATE INDEX IF NOT EXISTS leases_tenant_idx ON identifier_leases(tenant_id);
CREATE INDEX IF NOT EXISTS leases_tenant_category_idx ON identifier_leases(tenant_id, category_id);
CREATE INDEX IF NOT EXISTS leases_device_idx ON identifier_leases(device_id);
CREATE INDEX IF NOT EXISTS leases_status_idx ON identifier_leases(status);
CREATE UNIQUE INDEX IF NOT EXISTS leases_device_cat_active_idx ON identifier_leases(tenant_id, category_id, device_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS "identifier_release_pool" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES organizations(id),
  "category_id" text NOT NULL REFERENCES categories(id),
  "sector_id" uuid NOT NULL REFERENCES sectors(id),
  "range_start" integer NOT NULL,
  "range_end" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pool_tenant_idx ON identifier_release_pool(tenant_id);
CREATE INDEX IF NOT EXISTS pool_tenant_category_idx ON identifier_release_pool(tenant_id, category_id);

-- Marcar categorias com exigência legal de sequência
UPDATE categories SET requires_sequential = true WHERE id IN ('FAT', 'REC', 'NOT', 'NDB', 'GUE', 'ORD');
