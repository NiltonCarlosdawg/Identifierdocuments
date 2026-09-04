-- Migration 0013: devices table — rename user_id, add new columns, change status enum
-- Ordem crítica: DROP CONSTRAINT antes do UPDATE, ADD CONSTRAINT depois.
-- NOTA (2026-07-26): bookkeeping desta migration foi inserido manualmente em
-- drizzle.__drizzle_migrations porque a BD foi alterada via psql -f antes do registo.
-- O hash da 0012 na BD (a938f9e6...) tambem nao coincide com sha256 do ficheiro actual
-- (70f7e4...), sugerindo intervencao manual anterior ao fluxo normal do drizzle-kit.
-- Confirma sempre o estado de drizzle.__drizzle_migrations antes de debug de migrations.

--> statement-breakpoint

-- 1. Add new columns
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "sector_id" uuid;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "deactivated_at" timestamp;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "deactivated_by" uuid;

--> statement-breakpoint

-- 2. Rename user_id -> registered_by_user_id (preserva dados existentes)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'user_id') THEN
    ALTER TABLE devices RENAME COLUMN "user_id" TO "registered_by_user_id";
  END IF;
END $$;

--> statement-breakpoint

-- 3. Drop old CHECK constraint ANTES do UPDATE (senão o UPDATE viola a constraint)
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_status_check;

--> statement-breakpoint

-- 4. Migrar dados: force_released -> inactive (agora permitido porque o CHECK antigo já não existe)
UPDATE devices SET status = 'inactive' WHERE status = 'force_released';

--> statement-breakpoint

-- 5. Add novo CHECK constraint (seguro porque todas as linhas são active ou inactive)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_status_check') THEN
    ALTER TABLE devices ADD CONSTRAINT devices_status_check CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

--> statement-breakpoint

-- 6. Trocar índices: remover user_idx, adicionar sector_idx e status_idx
DROP INDEX IF EXISTS devices_user_idx;
CREATE INDEX IF NOT EXISTS devices_sector_idx ON devices (sector_id);
CREATE INDEX IF NOT EXISTS devices_status_idx ON devices (status);

--> statement-breakpoint

-- 7. Adicionar FK constraints para as novas colunas
DO $$ BEGIN
 ALTER TABLE "devices" ADD CONSTRAINT "devices_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "devices" ADD CONSTRAINT "devices_deactivated_by_users_id_fk" FOREIGN KEY ("deactivated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
