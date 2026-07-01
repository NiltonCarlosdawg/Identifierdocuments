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

-- Organizations: each org sees only itself
CREATE POLICY tenant_isolation ON organizations
  FOR ALL
  USING (id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Sectors: filtered by tenant_id
CREATE POLICY tenant_isolation ON sectors
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Users: filtered by tenant_id
CREATE POLICY tenant_isolation ON users
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Roles: filtered by tenant_id (system roles have null tenant_id and are visible to all)
CREATE POLICY tenant_isolation ON roles
  FOR ALL
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Role permissions: filtered through roles
CREATE POLICY tenant_isolation ON role_permissions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM roles
      WHERE roles.id = role_id
        AND (roles.tenant_id IS NULL OR roles.tenant_id = current_setting('app.current_tenant')::uuid)
    )
  );
--> statement-breakpoint

-- User roles: filtered through users
CREATE POLICY tenant_isolation ON user_roles
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = user_id
        AND users.tenant_id = current_setting('app.current_tenant')::uuid
    )
  );
--> statement-breakpoint

-- Identifiers: filtered by tenant_id
CREATE POLICY tenant_isolation ON identifiers
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Documents: filtered by tenant_id
CREATE POLICY tenant_isolation ON documents
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Document shares: filtered through documents
CREATE POLICY tenant_isolation ON document_shares
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_id
        AND documents.tenant_id = current_setting('app.current_tenant')::uuid
    )
  );
--> statement-breakpoint

-- Approvals: filtered by tenant_id
CREATE POLICY tenant_isolation ON approvals
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Audit logs: filtered by tenant_id
CREATE POLICY tenant_isolation ON audit_logs
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Notifications: filtered by tenant_id
CREATE POLICY tenant_isolation ON notifications
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
