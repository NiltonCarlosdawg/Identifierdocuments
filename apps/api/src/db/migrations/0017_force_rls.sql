-- Harden RLS: FORCE even for table owners; add policies for tables created after 0006.
-- IMPORTANT: use a non-superuser app role WITHOUT BYPASSRLS in production for this to matter.

ALTER TABLE IF EXISTS organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sectors FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS roles FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS identifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS documents FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS document_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS document_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS document_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS document_access_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS classifier_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS classifier_feedback FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS devices FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS identifier_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS identifier_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS identifier_release_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS identifier_release_pool FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS idempotency_records FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'document_versions' AND policyname LIKE 'tenant_isolation%'
  ) THEN
    CREATE POLICY tenant_isolation_document_versions ON document_versions
      FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'document_access_requests' AND policyname LIKE 'tenant_isolation%'
  ) THEN
    CREATE POLICY tenant_isolation_document_access_requests ON document_access_requests
      FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'classifier_feedback' AND policyname LIKE 'tenant_isolation%'
  ) THEN
    CREATE POLICY tenant_isolation_classifier_feedback ON classifier_feedback
      FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'devices' AND policyname LIKE 'tenant_isolation%'
  ) THEN
    CREATE POLICY tenant_isolation_devices ON devices
      FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'identifier_leases' AND policyname LIKE 'tenant_isolation%'
  ) THEN
    CREATE POLICY tenant_isolation_identifier_leases ON identifier_leases
      FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'identifier_release_pool' AND policyname LIKE 'tenant_isolation%'
  ) THEN
    CREATE POLICY tenant_isolation_identifier_release_pool ON identifier_release_pool
      FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'idempotency_records' AND policyname LIKE 'tenant_isolation%'
  ) THEN
    CREATE POLICY tenant_isolation_idempotency_records ON idempotency_records
      FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END $$;
