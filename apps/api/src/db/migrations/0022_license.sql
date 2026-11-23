-- 0022_license.sql
-- A licença passa a ser a fonte única do direito de uso. Tenants existentes
-- recebem licença sem prazo e sem limite para não bloquear clientes actuais.

CREATE TABLE IF NOT EXISTS licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  license_number text NOT NULL UNIQUE,
  plan_id uuid REFERENCES plans(id),
  max_users integer,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','expired','suspended')),
  valid_until timestamptz,
  issued_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES provider_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS licenses_status_idx ON licenses(status);
--> statement-breakpoint
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE licenses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON licenses;
CREATE POLICY tenant_isolation ON licenses
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
--> statement-breakpoint
INSERT INTO licenses (tenant_id, license_number, plan_id, max_users, status, valid_until)
SELECT o.id,
       'DOCID-' || EXTRACT(YEAR FROM now())::text || '-' ||
         upper(substring(md5(o.id::text) from 1 for 4)) || '-' ||
         upper(substring(md5(o.id::text) from 5 for 4)) || '-' ||
         upper(substring(md5(o.id::text) from 9 for 4)),
       o.plan_id,
       NULL,
       'active',
       NULL
  FROM organizations o
  LEFT JOIN licenses l ON l.tenant_id = o.id
 WHERE l.id IS NULL;
