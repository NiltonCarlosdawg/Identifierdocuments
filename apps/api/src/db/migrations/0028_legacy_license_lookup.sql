-- 0028_legacy_license_lookup.sql
-- Instalações que já tinham licenças antes da enforcement usam o número da
-- tabela licenses (formato antigo). Permite à API da plataforma encontrá-las
-- também por esse número, sem alterar números já emitidos.
-- A tabela licenses só tinha a policy de tenant; o lookup controlado da
-- plataforma precisa da mesma policy usada por organizations/users.
DROP POLICY IF EXISTS auth_lookup_licenses ON licenses;
CREATE POLICY auth_lookup_licenses ON licenses FOR SELECT
  USING (current_setting('app.auth_lookup', true) = 'on');

CREATE OR REPLACE FUNCTION platform_find_org_by_legacy_license(p_license text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE found_id uuid;
BEGIN
  -- FORCE RLS também se aplica ao owner: usar a policy de lookup controlada.
  PERFORM set_config('app.auth_lookup', 'on', true);
  SELECT tenant_id INTO found_id FROM licenses WHERE license_number = p_license;
  PERFORM set_config('app.auth_lookup', 'off', true);
  RETURN found_id;
END;
$$;
REVOKE ALL ON FUNCTION platform_find_org_by_legacy_license(text) FROM PUBLIC;
