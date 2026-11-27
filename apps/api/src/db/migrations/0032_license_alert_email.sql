-- 0032_license_alert_email.sql
-- Aviso por e-mail aos administradores quando a licença está a terminar, entra em
-- tolerância ou passa a "só consulta" (verificação diária, jobs/license-alerts.ts).

ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_event_type_check;
ALTER TABLE email_logs ADD CONSTRAINT email_logs_event_type_check CHECK ("event_type" IN (
  'document_approved', 'document_shared', 'test',
  'approval_requested', 'access_requested', 'document_rejected',
  'password_changed', 'role_granted', 'device_registered', 'identifier_cancelled',
  'license_alert'
));
