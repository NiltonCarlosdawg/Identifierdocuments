-- 0031_attention_emails.sql
-- Novos e-mails de acções que pedem atenção dentro da organização (ver docs/NOTIFICACOES_EMAIL.md):
-- pedidos de aprovação e de acesso, recusas, mudança de password, novas funções, novos
-- dispositivos e identificadores anulados. Só alarga a lista de tipos aceites em email_logs.

DO $$
DECLARE c record;
BEGIN
  -- O CHECK original (0025) foi criado inline, com nome gerado: procurá-lo pela definição.
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'email_logs'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE email_logs DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE email_logs ADD CONSTRAINT email_logs_event_type_check CHECK ("event_type" IN (
  'document_approved', 'document_shared', 'test',
  'approval_requested', 'access_requested', 'document_rejected',
  'password_changed', 'role_granted', 'device_registered', 'identifier_cancelled'
));
