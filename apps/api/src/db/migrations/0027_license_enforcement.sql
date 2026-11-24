-- 0027_license_enforcement.sql
-- Controlo de acesso pela licença de cada organização.
--
-- organizations:
--   plan                 (já existia)  — 'trial' para organizações novas em período de teste
--   license_valid_until  — fim da licença (NULL = sem prazo). Organizações já existentes
--                          ficam sem prazo para não bloquear clientes actuais.
--   license_max_users    — utilizadores activos permitidos (NULL = sem limite)
--   license_status       — 'active' ou 'suspended' (suspensão manual pela plataforma)
--
-- Regras na base de dados (valem para qualquer caminho do código):
--   * campos de licença só mudam com app.license_admin = 'on' (endpoints da plataforma);
--   * o limite de utilizadores é verificado em cada INSERT/activação, com lock na
--     organização para dois pedidos simultâneos não passarem ambos o limite.
-- A validade (só consulta depois de expirar + tolerância) é aplicada na API.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "license_valid_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "license_max_users" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "license_status" text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "license_updated_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_license_status_chk" CHECK ("license_status" IN ('active', 'suspended'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_license_max_users_chk" CHECK ("license_max_users" IS NULL OR "license_max_users" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Só a plataforma altera a licença (o ORG_ADMIN do tenant não se pode auto-renovar).
CREATE OR REPLACE FUNCTION docid_license_fields_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.license_valid_until IS DISTINCT FROM OLD.license_valid_until
      OR NEW.license_max_users IS DISTINCT FROM OLD.license_max_users
      OR NEW.license_status IS DISTINCT FROM OLD.license_status)
     AND coalesce(current_setting('app.license_admin', true), '') <> 'on' THEN
    RAISE EXCEPTION 'A licença só pode ser alterada pela plataforma DocID.' USING ERRCODE = 'LIC02';
  END IF;
  IF NEW.license_valid_until IS DISTINCT FROM OLD.license_valid_until
     OR NEW.license_max_users IS DISTINCT FROM OLD.license_max_users
     OR NEW.license_status IS DISTINCT FROM OLD.license_status THEN
    NEW.license_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "organizations_license_fields_guard" ON "organizations";
--> statement-breakpoint
CREATE TRIGGER "organizations_license_fields_guard"
  BEFORE UPDATE OF "license_valid_until", "license_max_users", "license_status" ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION docid_license_fields_guard();
--> statement-breakpoint

-- Limite de utilizadores activos.
CREATE OR REPLACE FUNCTION docid_license_user_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lim integer;
  active_count integer;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_active AND OLD.tenant_id = NEW.tenant_id THEN
    RETURN NEW; -- já contava para o limite
  END IF;
  -- FOR UPDATE: serializa criações simultâneas na mesma organização.
  SELECT license_max_users INTO lim FROM organizations WHERE id = NEW.tenant_id FOR UPDATE;
  IF lim IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO active_count FROM users
   WHERE tenant_id = NEW.tenant_id AND is_active AND id <> NEW.id;
  IF active_count >= lim THEN
    RAISE EXCEPTION 'Limite de utilizadores da licença atingido (% activos de %). Desactive um utilizador ou peça o aumento da licença.', active_count, lim
      USING ERRCODE = 'LIC01';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "users_license_user_limit" ON "users";
--> statement-breakpoint
CREATE TRIGGER "users_license_user_limit"
  BEFORE INSERT OR UPDATE OF "is_active", "tenant_id" ON "users"
  FOR EACH ROW EXECUTE FUNCTION docid_license_user_limit();
--> statement-breakpoint

-- Leitura entre tenants SÓ para os endpoints da plataforma (mesmo padrão de 0020):
-- as funções ligam o GUC, consultam e voltam a desligá-lo.
DROP POLICY IF EXISTS "platform_admin_read" ON "organizations";
--> statement-breakpoint
CREATE POLICY "platform_admin_read" ON "organizations" FOR SELECT
  USING (current_setting('app.platform_admin', true) = 'on');
--> statement-breakpoint
DROP POLICY IF EXISTS "platform_admin_read" ON "users";
--> statement-breakpoint
CREATE POLICY "platform_admin_read" ON "users" FOR SELECT
  USING (current_setting('app.platform_admin', true) = 'on');
--> statement-breakpoint

CREATE OR REPLACE FUNCTION platform_list_licenses()
RETURNS TABLE(
  id uuid, name text, slug text, license_number text, license_issued_at timestamptz, plan text,
  license_valid_until timestamptz, license_max_users integer, license_status text,
  active_users integer, created_at timestamp
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.platform_admin', 'on', true);
  RETURN QUERY
    SELECT o.id, o.name, o.slug, o.license_number, o.license_issued_at, p.name AS plan,
           o.license_valid_until, o.license_max_users, o.license_status,
           (SELECT count(*)::int FROM users u WHERE u.tenant_id = o.id AND u.is_active),
           o.created_at
      FROM organizations o
     LEFT JOIN plans p ON p.id = o.plan_id
     ORDER BY o.created_at DESC;
  PERFORM set_config('app.platform_admin', 'off', true);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_list_licenses() FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION platform_find_org_by_license(p_license text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE found_id uuid;
BEGIN
  PERFORM set_config('app.platform_admin', 'on', true);
  SELECT o.id INTO found_id FROM organizations o WHERE o.license_number = p_license;
  PERFORM set_config('app.platform_admin', 'off', true);
  RETURN found_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_find_org_by_license(text) FROM PUBLIC;
