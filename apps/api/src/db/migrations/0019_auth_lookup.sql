-- 0019_auth_lookup.sql
-- Corrije dois problemas descobertos no deploy em produção:
--
-- (a) As policies RLS criadas em 0006/rls usam current_setting('app.current_tenant')
--     SEM missing_ok — quando a GUC não está definida, o Postgres rebenta com
--     "unrecognized configuration parameter" em vez de devolver zero linhas.
--     Reescrevemos todas as policies públicas para degradarem para zero-linhas
--     (equivalente seguro: nunca revela dados de outro tenant, nunca rebenta).
--
-- (b) O login (e os fluxos de recuperação de password/onboarding) consulta as tabelas
--     ANTES de existir contexto de tenant — o RLS não os authoriza. Criamos
--     SECURITY DEFINER para os lookups estritamente necessários à autenticação.
--     Continuam a ser as ÚNICAS portas "unscoped": todas as outras queries do
--     módulo de auth passam a withTenant(tenantId).

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    IF position('app.current_tenant' in pol.qual) > 0
       AND position(', true' in pol.qual) = 0 THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I USING (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        replace(pol.qual,
                'current_setting(''app.current_tenant''::text)',
                'current_setting(''app.current_tenant''::text, true)'));
    END IF;
    IF pol.with_check IS NOT NULL
       AND position('app.current_tenant' in pol.with_check) > 0
       AND position(', true' in pol.with_check) = 0 THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        replace(pol.with_check,
                'current_setting(''app.current_tenant''::text)',
                'current_setting(''app.current_tenant''::text, true)'));
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
RETURNS SETOF users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM users WHERE email = p_email;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_find_user_by_email(text) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_find_org_by_slug(p_slug text)
RETURNS SETOF organizations
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM organizations WHERE slug = p_slug;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_find_org_by_slug(text) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_find_reset_token_by_hash(p_hash text)
RETURNS TABLE(id uuid, user_id uuid, tenant_id uuid, expires_at timestamptz, used_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.user_id, u.tenant_id, t.expires_at, t.used_at
    FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
   WHERE t.token_hash = p_hash
     AND t.used_at IS NULL
     AND t.expires_at > now()
   LIMIT 1;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_find_reset_token_by_hash(text) FROM PUBLIC;
