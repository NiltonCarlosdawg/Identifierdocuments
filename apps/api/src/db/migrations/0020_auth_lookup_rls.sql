-- 0020_auth_lookup_rls.sql
-- As funções SECURITY DEFINER de autenticação são donas pelo role da app, que
-- está sujeito a RLS (FORCE) e não tem BYPASSRLS. Sem contexto de tenant, as
-- policies devolvem zero linhas — o login falhava com 401 mesmo com a password
-- correcta. Estas funções passam a ligar um GUC exclusivo, validado por uma
-- policy adicional, apenas dentro da transação da própria função.

DROP POLICY IF EXISTS auth_lookup ON users;
CREATE POLICY auth_lookup ON users
  USING (current_setting('app.auth_lookup', true) = 'on');

DROP POLICY IF EXISTS auth_lookup ON organizations;
CREATE POLICY auth_lookup ON organizations
  USING (current_setting('app.auth_lookup', true) = 'on');

CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
RETURNS SETOF users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.auth_lookup', 'on', true);
  RETURN QUERY SELECT * FROM users WHERE email = p_email;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user_by_email(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION auth_find_org_by_slug(p_slug text)
RETURNS SETOF organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.auth_lookup', 'on', true);
  RETURN QUERY SELECT * FROM organizations WHERE slug = p_slug;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_org_by_slug(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION auth_find_reset_token_by_hash(p_hash text)
RETURNS TABLE(id uuid, user_id uuid, tenant_id uuid, expires_at timestamptz, used_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.auth_lookup', 'on', true);
  RETURN QUERY
    SELECT t.id, t.user_id, u.tenant_id, t.expires_at, t.used_at
      FROM password_reset_tokens t
      JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = p_hash
       AND t.used_at IS NULL
       AND t.expires_at > now()
     LIMIT 1;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_reset_token_by_hash(text) FROM PUBLIC;
