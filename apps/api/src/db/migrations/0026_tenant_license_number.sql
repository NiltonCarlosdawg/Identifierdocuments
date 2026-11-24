-- 0026_tenant_license_number.sql
-- Número de licença único para cada organização (tenant).
--
-- Formato: DOCID-AAAA-XXXX-XXXX-XXXX
--   AAAA  = ano de emissão
--   XXXX… = 11 caracteres aleatórios + 1 carácter de controlo
-- Alfabeto Crockford base32 (0-9 A-Z sem I, L, O, U): sem caracteres que se confundem
-- ao ler ou ditar (I/1, O/0). O carácter de controlo usa Luhn mod 32, que detecta
-- qualquer carácter trocado e a maioria das trocas de caracteres vizinhos.
-- A mesma regra está em apps/api/src/lib/license.ts (validação no código).

CREATE OR REPLACE FUNCTION docid_license_check_char(p_payload text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  factor int := 2;
  total int := 0;
  addend int;
  code int;
  i int;
BEGIN
  FOR i IN REVERSE length(p_payload)..1 LOOP
    code := strpos(alphabet, substr(p_payload, i, 1)) - 1;
    IF code < 0 THEN
      RAISE EXCEPTION 'Carácter inválido no número de licença: %', substr(p_payload, i, 1);
    END IF;
    addend := factor * code;
    factor := CASE WHEN factor = 2 THEN 1 ELSE 2 END;
    total := total + (addend / 32) + (addend % 32);
  END LOOP;
  RETURN substr(alphabet, ((32 - (total % 32)) % 32) + 1, 1);
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION docid_new_license_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  -- gen_random_uuid() (v4): bytes 0-5 e 9-15 são totalmente aleatórios (6 e 8 têm bits fixos).
  raw bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  positions constant int[] := ARRAY[0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13];
  year text := to_char(now(), 'YYYY');
  body text := '';
  pos int;
  full_code text;
BEGIN
  FOREACH pos IN ARRAY positions LOOP
    body := body || substr(alphabet, (get_byte(raw, pos) % 32) + 1, 1);
  END LOOP;
  full_code := body || docid_license_check_char(year || body);
  RETURN 'DOCID-' || year || '-' || substr(full_code, 1, 4) || '-' || substr(full_code, 5, 4) || '-' || substr(full_code, 9, 4);
END;
$$;
--> statement-breakpoint

-- O default volátil é avaliado linha a linha: cada organização existente recebe o seu número.
-- (DDL não passa pelo RLS, por isso funciona mesmo com FORCE ROW LEVEL SECURITY.)
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "license_number" text NOT NULL DEFAULT docid_new_license_number();
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "license_issued_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_license_number_idx" ON "organizations" ("license_number");
--> statement-breakpoint

-- O número de licença nunca muda depois de emitido.
CREATE OR REPLACE FUNCTION docid_license_number_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.license_number IS DISTINCT FROM OLD.license_number
     OR NEW.license_issued_at IS DISTINCT FROM OLD.license_issued_at THEN
    RAISE EXCEPTION 'O número de licença de uma organização não pode ser alterado.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "organizations_license_immutable" ON "organizations";
--> statement-breakpoint
CREATE TRIGGER "organizations_license_immutable"
  BEFORE UPDATE OF "license_number", "license_issued_at" ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION docid_license_number_immutable();
