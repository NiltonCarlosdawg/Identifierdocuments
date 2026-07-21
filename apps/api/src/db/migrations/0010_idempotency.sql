-- M10: Idempotency key for offline identifier registration
-- Nota: O índice é NÃO único porque um batch (register-offline) pode criar várias linhas com a mesma chave.
--       A garantia de idempotência vem do advisory lock + lógica aplicacional dentro da transacção.

ALTER TABLE identifiers ADD COLUMN IF NOT EXISTS "idempotency_key" text;
DROP INDEX IF EXISTS identifiers_tenant_idempotency_idx;
CREATE INDEX identifiers_tenant_idempotency_idx ON identifiers(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
