-- 0024_rls_empty_tenant.sql
-- Corrige "invalid input syntax for type uuid: """ no login e no onboarding.
--
-- withTenant() faz set_config('app.current_tenant', <uuid>, true). Quando a transacção
-- termina, o PostgreSQL NÃO apaga o parâmetro nessa ligação: passa a devolver '' (string
-- vazia). A pool reutiliza a ligação, e a query seguinte sem withTenant (lookup do login,
-- onboarding) avalia as policies com ''::uuid, que rebenta em vez de devolver zero linhas.
-- Resultado: depois do primeiro pedido autenticado, login e onboarding falhavam em
-- ligações reutilizadas.
--
-- Correcção: tratar '' como "sem tenant" com NULLIF(..., ''). NULL::uuid nunca é igual a
-- nenhum tenant_id, por isso continua a não haver fuga de dados entre tenants.
-- Aplica-se a todas as policies públicas que usam app.current_tenant (idempotente).

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    IF pol.qual IS NOT NULL
       AND position('app.current_tenant' in pol.qual) > 0
       AND position('NULLIF' in upper(pol.qual)) = 0 THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I USING (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        replace(pol.qual,
                'current_setting(''app.current_tenant''::text, true)',
                'NULLIF(current_setting(''app.current_tenant''::text, true), ''''::text)'));
    END IF;
    IF pol.with_check IS NOT NULL
       AND position('app.current_tenant' in pol.with_check) > 0
       AND position('NULLIF' in upper(pol.with_check)) = 0 THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        replace(pol.with_check,
                'current_setting(''app.current_tenant''::text, true)',
                'NULLIF(current_setting(''app.current_tenant''::text, true), ''''::text)'));
    END IF;
  END LOOP;
END $$;
