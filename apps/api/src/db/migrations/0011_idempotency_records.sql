-- M11: Desacoplar idempotência de identifiers para uma tabela dedicada
-- Remove a coluna e índice de identifiers, cria idempotency_records com PK (tenant_id, idempotency_key)

DROP INDEX IF EXISTS identifiers_tenant_idempotency_idx;
ALTER TABLE identifiers DROP COLUMN IF EXISTS idempotency_key;

CREATE TABLE IF NOT EXISTS idempotency_records (
  tenant_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);
