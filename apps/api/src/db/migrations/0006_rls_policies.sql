-- Enable RLS on all tenant-scoped tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'organizations' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON organizations
      FOR ALL
      USING (id = current_setting('app.current_tenant')::uuid);
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sectors' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON sectors
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON users
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'roles' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON roles
      FOR ALL
      USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'role_permissions' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON role_permissions
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM roles
          WHERE roles.id = role_id
            AND (roles.tenant_id IS NULL OR roles.tenant_id = current_setting('app.current_tenant')::uuid)
        )
      );
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_roles' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON user_roles
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = user_id
            AND users.tenant_id = current_setting('app.current_tenant')::uuid
        )
      );
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'identifiers' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON identifiers
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'documents' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON documents
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'document_shares' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON document_shares
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM documents
          WHERE documents.id = document_id
            AND documents.tenant_id = current_setting('app.current_tenant')::uuid
        )
      );
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'approvals' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON approvals
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON audit_logs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON notifications
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END $$;
