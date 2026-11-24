-- 0025_email_notifications.sql
-- Notificações por e-mail por tenant.
--
-- tenant_email_settings: remetente e credenciais de envio de cada organização.
--   O segredo (password SMTP ou chave de API) fica encriptado com AES-256-GCM
--   e o tenant_id é usado como dado autenticado: um segredo copiado para a linha
--   de outro tenant deixa de desencriptar.
--
-- email_logs: histórico de envios E fila de saída (padrão "transactional outbox").
--   Os e-mails são inseridos na mesma transação que a aprovação/partilha, por isso
--   nunca há e-mail de um evento que fez rollback nem evento sem e-mail.
--   Um worker reclama linhas com FOR UPDATE SKIP LOCKED (seguro com várias instâncias).

CREATE TABLE IF NOT EXISTS "tenant_email_settings" (
  "tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "provider" text NOT NULL CHECK ("provider" IN ('smtp', 'resend', 'sendgrid')),
  "from_email" text NOT NULL,
  "from_name" text,
  "reply_to" text,
  "smtp_host" text,
  "smtp_port" integer,
  "smtp_security" text CHECK ("smtp_security" IN ('ssl', 'starttls', 'none')),
  "smtp_user" text,
  "secret_encrypted" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "verified_at" timestamp with time zone,
  "last_test_at" timestamp with time zone,
  "last_test_error" text,
  "updated_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_email_settings_smtp_fields" CHECK (
    "provider" <> 'smtp' OR ("smtp_host" IS NOT NULL AND "smtp_port" IS NOT NULL AND "smtp_security" IS NOT NULL)
  )
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "email_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "event_type" text NOT NULL CHECK ("event_type" IN ('document_approved', 'document_shared', 'test')),
  "recipient_email" text NOT NULL,
  "recipient_user_id" uuid REFERENCES "users"("id"),
  "document_id" uuid REFERENCES "documents"("id"),
  "subject" text NOT NULL,
  "template_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "locked_until" timestamp with time zone,
  "provider" text,
  "sender" text,
  "message_id" text,
  "last_error" text,
  "dedupe_key" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at" timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "email_logs_tenant_created_idx" ON "email_logs" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_logs_pending_idx" ON "email_logs" ("next_attempt_at") WHERE "status" IN ('queued', 'sending');
--> statement-breakpoint
-- Impede e-mails duplicados para o mesmo evento/destinatário (ex.: pedido repetido).
CREATE UNIQUE INDEX IF NOT EXISTS "email_logs_dedupe_idx" ON "email_logs" ("tenant_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "tenant_email_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_email_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "tenant_isolation_tenant_email_settings" ON "tenant_email_settings";
--> statement-breakpoint
CREATE POLICY "tenant_isolation_tenant_email_settings" ON "tenant_email_settings"
  FOR ALL USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_email_logs" ON "email_logs";
--> statement-breakpoint
CREATE POLICY "tenant_isolation_email_logs" ON "email_logs"
  FOR ALL USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
--> statement-breakpoint

-- O worker precisa de ver a fila de todos os tenants, mas SÓ para a reclamar:
-- a função liga um GUC exclusivo, reclama as linhas e volta a desligá-lo.
-- O processamento de cada linha acontece depois dentro de withTenant(tenant_id),
-- onde só as policies normais se aplicam.
DROP POLICY IF EXISTS "email_worker_claim" ON "email_logs";
--> statement-breakpoint
CREATE POLICY "email_worker_claim" ON "email_logs"
  FOR ALL USING (current_setting('app.email_worker', true) = 'on');
--> statement-breakpoint

CREATE OR REPLACE FUNCTION email_outbox_claim(p_limit integer, p_lease_seconds integer)
RETURNS TABLE(id uuid, tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.email_worker', 'on', true);
  RETURN QUERY
    UPDATE email_logs e
       SET status = 'sending',
           attempts = e.attempts + 1,
           locked_until = now() + make_interval(secs => p_lease_seconds),
           updated_at = now()
     WHERE e.id IN (
       SELECT c.id FROM email_logs c
        WHERE c.next_attempt_at <= now()
          AND (c.status = 'queued' OR (c.status = 'sending' AND c.locked_until < now()))
          AND c.attempts < c.max_attempts
        ORDER BY c.next_attempt_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
     )
    RETURNING e.id, e.tenant_id;
  PERFORM set_config('app.email_worker', 'off', true);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION email_outbox_claim(integer, integer) FROM PUBLIC;
--> statement-breakpoint

-- Linhas presas em 'sending' que já esgotaram as tentativas (ex.: crash do processo
-- no último envio) passam a 'failed' para não ficarem eternamente pendentes.
CREATE OR REPLACE FUNCTION email_outbox_expire_stuck()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('app.email_worker', 'on', true);
  UPDATE email_logs
     SET status = 'failed', last_error = coalesce(last_error, 'Envio interrompido'), updated_at = now()
   WHERE status = 'sending' AND locked_until < now() AND attempts >= max_attempts;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.email_worker', 'off', true);
  RETURN n;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION email_outbox_expire_stuck() FROM PUBLIC;
