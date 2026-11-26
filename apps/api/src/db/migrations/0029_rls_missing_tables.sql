-- 0029_rls_missing_tables.sql
-- document_shares, user_roles e role_permissions tinham FORCE ROW LEVEL SECURITY
-- (0017) mas nunca ENABLE: sem ENABLE o FORCE não faz nada e estas tabelas ficavam
-- sem isolamento ao nível da base de dados. Não têm tenant_id próprio, por isso a
-- policy segue a tabela pai (que já tem RLS por tenant).
-- Usa NULLIF desde o início (ver 0024) e aceita o pool de lookup (app.auth_lookup).

ALTER TABLE document_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_shares FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_document_shares ON document_shares;
CREATE POLICY tenant_isolation_document_shares ON document_shares
  USING (
    current_setting('app.auth_lookup', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = document_shares.document_id
        AND d.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    )
  );

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_user_roles ON user_roles;
CREATE POLICY tenant_isolation_user_roles ON user_roles
  USING (
    current_setting('app.auth_lookup', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = user_roles.user_id
        AND u.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    )
  );

-- Roles de sistema têm tenant_id NULL e são partilhadas por todas as organizações.
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_role_permissions ON role_permissions;
CREATE POLICY tenant_isolation_role_permissions ON role_permissions
  USING (
    current_setting('app.auth_lookup', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND (r.tenant_id IS NULL
             OR r.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    )
  );
