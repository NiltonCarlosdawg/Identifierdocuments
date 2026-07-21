# Offline Persistence Invariants

Este documento consolida as regras arquiteturais da persistência offline do IdentifierDocuments.

## Invariantes

1. `local_identifier_lease` é a projeção mínima necessária do lease remoto. O cliente não inventa estado fiscal.
2. `local_pending_identifiers` é a unidade autocontida de sincronização. Cada registo contém tudo que o backend precisa.
3. O sincronizador não depende de memória, cache temporária, variáveis globais ou estado do processo para reconstruir operações pendentes.
4. Leases revogados pelo servidor bloqueiam novas gerações assim que o cliente descobre o `force-release`.
5. `PRAGMA foreign_keys = ON` é obrigatório antes de qualquer operação no SQLite.
6. Toda geração local de identificadores precisa ocorrer dentro de transação SQLite.
7. Categorias fiscais (`requires_sequential = true`) só podem consumir sequências de leases locais com `status = 'active'`.
8. Categorias não fiscais (`requires_sequential = false`) usam `local_loose_counters` como fonte local de verdade.
9. O backend continua a ser a autoridade final durante a sincronização.

## Force-Release

Quando o sync detecta que um lease foi forçado no servidor:

1. O lease local passa para `remote_released`.
2. Todos os identificadores pendentes desse lease passam para `status = 'conflict'`.
3. O `conflict_reason` deve ser `LEASE_FORCE_RELEASED`.
4. `generate_offline_identifier()` passa a falhar com:

```text
Lease revogado. Reconecte para obter um novo lease.
```

## Idempotency Gap (bloqueador para Parte 2 — ciclo de sincronização)

O lado Rust gera e persiste `idempotency_key` (UUID v4) em cada registo
de `local_pending_identifiers`. O backend **não** verifica esta chave.

### Estado actual do backend

| Cenário | Mecanismo actual | Risco |
|---|---|---|
| Fiscal (`POST /register-offline`) | `pg_advisory_xact_lock` + `usedUpTo` | Rejeita replay com "fora de ordem". Não silencia, não duplica. |
| Não-fiscal (`POST /register-offline-loose`) | Reusa `generateIdentifier()` → `MAX(sequence)+1` | **Replay gera novo identificador** com sequência diferente. Sem protecção. |

### O que falta

Uma tabela `idempotency_keys` no PostgreSQL e verificação em ambos os
endpoints:

```sql
CREATE TABLE idempotency_keys (
    id             TEXT PRIMARY KEY,          -- = idempotency_key do cliente
    tenant_id      TEXT NOT NULL,
    response       JSONB NOT NULL,            -- Resultado original (serializado)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Limpeza por TTL (ex: 7 dias)
    expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX idx_idempotency_keys_expires ON idempotency_keys(expires_at);
```

Fluxo esperado para ambos os endpoints:

1. Receber `idempotency_key` no body (campo obrigatório).
2. `SELECT response FROM idempotency_keys WHERE id = ?1`.
   - Se existir → devolver `response` sem processar (idempotência garantida).
3. Processar normalmente.
4. `INSERT INTO idempotency_keys (id, tenant_id, response) VALUES (...)`.
5. Job de limpeza (ou `ON CONFLICT DO NOTHING` + TTL).

### Porque é bloqueante para a Parte 2

O ciclo de sincronização (Parte 2) vai re-enviar registos de
`local_pending_identifiers` para o backend. Sem idempotência:

- **Fiscal**: um re-envio legítimo (ex: timeout falso) é rejeitado como
  "fora de ordem" e o pending fica como `conflict` permanentemente.
- **Não-fiscal**: cada re-envio gera um identificador novo no servidor,
  corrompendo a sequência.

A implementação da tabela `idempotency_keys` no backend é
**pré-requisito obrigatório** antes de iniciar o ciclo de sincronização.
Não pode ser adiada para depois da Parte 2 nem tratada como trabalho
independente em paralelo.
