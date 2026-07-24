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

## Idempotência (tabela dedicada idempotency_records)

### Estado actual (implementado)

| Cenário | Mecanismo actual | Protecção |
|---|---|---|
| Fiscal (`POST /register-offline`) | `pg_advisory_xact_lock` + `idempotency_records` PK | `ON CONFLICT DO NOTHING` garante que o primeiro vencedor é devolvido em replays |
| Não-fiscal (`POST /register-offline-loose`) | `pg_advisory_xact_lock` + `idempotency_records` PK | Idêntico ao fiscal, usando `generateIdentifier()` |

### Tabela

```sql
CREATE TABLE idempotency_records (
    tenant_id      uuid NOT NULL REFERENCES organizations(id),
    idempotency_key text NOT NULL,
    result         jsonb NOT NULL,
    created_at     timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, idempotency_key)
);
```

### Fluxo (ambos os endpoints)

1. Receber `idempotencyKey` opcional no body.
2. Dentro da transacção com `pg_advisory_xact_lock`:
   a. `SELECT` por `(tenant_id, idempotency_key)` → se existir, devolver `result`.
   b. Processar normalmente (gerar identificador, registar batch).
   c. `INSERT INTO idempotency_records ... ON CONFLICT DO NOTHING RETURNING *`.
   d. Se `RETURNING` vazio → outro chamador concorrente já registou a mesma key.
      - Inserir `audit_logs` com `action = 'IDEMPOTENCY_DISCARDED'` com:
        - `resourceId` = identificador órfão (o que acabámos de criar e vamos descartar)
        - `metadata` contém o `idempotencyKey`, `orphanIdentifier` (nosso), `winnerIdentifier` (do vencedor)
      - Devolver o `result` do registo existente (vencedor), ignorando o nosso.
3. Sem key fornecida → comportamento inalterado (sem idempotência).

### Desperdício de sequência no cenário de corrida (cross-category)

**Decisão: aceitável, desde que auditável.**

Uma corrida com a mesma `idempotencyKey` mas categorias diferentes (ex:
Call A para categoria X, Call B para categoria Y com a mesma key) pode
produzir o seguinte cenário:

1. Call A adquire lock X, gera identificador X-001, insere `idempotency_records`.
2. Call B adquire lock Y (lock diferente), gera identificador Y-001, tenta
   inserir `idempotency_records` → `ON CONFLICT DO NOTHING`.
3. Call B detecta `RETURNING` vazio, sabe que perdeu a corrida.
4. Call B insere `audit_logs` com `IDEMPOTENCY_DISCARDED` (identificador Y-001 órfão).
5. Call B devolve o resultado de Call A (X-001) ao chamador.

Neste momento o identificador Y-001 existe na BD mas ninguém o reivindica.

**Porque é aceitável:**

- O precedente com `identifier_release_pool` já estabelece que números
  de sequência podem ser permanentemente queimados quando um lease é
  libertado antes de consumir todo o intervalo.
- O desperdício é um subproduto inevitável de locks independentes por
  categoria. Para partilhar um lock global por tenant (e serializar
  todas as gerações independentemente da categoria) perder-se-ia
  demasiada concorrência.
- Cada desperdício fica registado em `audit_logs` com
  `action = 'IDEMPOTENCY_DISCARDED'`, o que significa que é sempre
  auditável e pode ser detectado por jobs de reconciliação futuros.
- A janela de ocorrência é extremamente reduzida: requer que dois
  chamadores usem a mesma `idempotencyKey` UUID v4 simultaneamente em
  categorias diferentes, o que é improvável na prática.

### Porque é bloqueante para a Parte 2

O ciclo de sincronização (Parte 2) vai re-enviar registos de
`local_pending_identifiers` para o backend. Sem idempotência:

- **Fiscal**: um re-envio legítimo (ex: timeout falso) é rejeitado como
  "fora de ordem" e o pending fica como `conflict` permanentemente.
- **Não-fiscal**: cada re-envio gera um identificador novo no servidor,
  corrompendo a sequência.

A implementação da idempotência é **pré-requisito obrigatório** antes de
iniciar o ciclo de sincronização.
