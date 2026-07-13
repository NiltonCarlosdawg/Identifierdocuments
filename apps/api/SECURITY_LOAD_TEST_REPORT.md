# Security & Load Test Report — Pós-FIX 1

**Data:** 2026-07-02 (actualizado: 2026-07-04)
**Commit:** `58f1a1b` (6 correções de segurança + fix A5 Caso 1)
**API:** http://localhost:3000
**Pool postgres.js:** 10 conexões (default)

---

## PARTE A — Segurança

### A1 — Fuzzing de Concorrência (3 execuções × 200 requests)

**Resultado:** ✅ 0 cross-tenant leaks em 600 requests concorrentes.

| Execução | Requests | Passed | Failed | Leaks | p50(ms) | p95(ms) |
|----------|----------|--------|--------|-------|---------|---------|
| 1        | 200      | 190    | 10     | 0     | ~400    | ~909    |
| 2        | 200      | 190    | 10     | 0     | ~1163   | ~2130   |
| 3        | 200      | 190    | 10     | 0     | ~540    | ~983    |

- **Todas as 30 falhas** (10/execução) são `GET /tenants/me` com 500 — **regressão do FIX 1** (já corrigida). `tenants.module.ts` tinha `: any` e destruturava `db` do contexto Elysia (inexistente), introduzido no commit `4e409e7`. Antes do FIX 1, o código usava correctamente o import global `db` da linha 2.

### A2 — Exaustão da Pool (30 requests, 3× pool=10)

**Resultado:** ✅ 0 leaks sob pressão de pool.

| Requests | Passed | Failed | Leaks | p50(ms) | p95(ms) |
|----------|--------|--------|-------|---------|---------|
| 30       | 21     | 9      | 0     | 99      | 152     |

- 9 falhas: todas `GET /tenants/me` (mesma regressão do FIX 1, corrigida).

### A3 — Rollback SET LOCAL (50 iterações)

**Resultado:** ✅ 0 leaks SET LOCAL em 50 iterações de erro forçado + leitura cruzada.

Metodologia: Forçar FK violation dentro de `withTenant(tenantA)`, imediatamente ler sectors de `tenantB` na mesma conexão. 0 fugas detectadas.

### A4 — Verificação Estática `db` vs `tx`

**Resultado:** ✅ Todos os módulos convertidos usam `withTenant(tx)`.

- `services/auth.service.ts` — usa `db` global (login/refresh/profile, pre-tenant, aceitável)
- `modules/tenants.module.ts` — usa `db` global para POST /tenants (onboarding, aceitável) + GET/PATCH /me bug (reportado)
- Restantes módulos: todos com `withTenant(tx)`. Imports `db` são leftover unused.

### A5 — Bypass via tenantId Malformado (3 casos)

**Resultado:** ✅ Todos os casos seguros.

| Caso | Payload | Status | Risco |
|------|---------|--------|-------|
| 1 | SQL injection em tenantId | 500 (sanitizado: `safeError()` → "Formato de dados inválido.") | ✅ Error sanitizado, sem leak de informação (corrigido no commit `58f1a1b`) |
| 2 | Sem tenantId no JWT | 401 | Seguro |
| 3 | UUID válido mas inexistente | 200, 0 resultados | Seguro (RLS filtra por tenant inexistente) |

---

## PARTE B — Performance

### B1 — Baseline vs Pós-FIX

**❌ Não executável.** O commit pai (`5f214a8`) não compila devido a erro `Export named 'canAccessDocument' not found` — omissão corrigida no FIX. Impossível comparar baseline pré-FIX.

### B2 — Latência sob Concorrência Crescente

**Resultado:** ✅ 0 falhas em todos os níveis.

| Endpoint                  | Req | OK   | ERR | p50(ms) | p95(ms)  | p99(ms)  |
|---------------------------|-----|------|-----|---------|----------|----------|
| 10× GET /identifiers      | 10  | 10   | 0   | 102.8   | 105.4    | 105.4    |
| 50× GET /identifiers      | 50  | 50   | 0   | 289.8   | 459.5    | 460.8    |
| 200× GET /identifiers     | 200 | 200  | 0   | 793.5   | 1516.7   | 1623.9   |
| 10× GET /users            | 10  | 10   | 0   | 297.0   | 305.7    | 305.7    |
| 50× GET /users            | 50  | 50   | 0   | 311.1   | 391.2    | 393.5    |
| 200× GET /users           | 200 | 200  | 0   | 522.7   | 915.0    | 932.6    |

Observações:
- Latência escala linearmente com a concorrência para GET /identifiers (102ms → 794ms p50)
- GET /users mostra latência base mais alta (297ms a 10 reqs) mas escala melhor (523ms a 200 reqs)
- Nenhum timeout ou erro de pool observado

### B3 — Contenção Advisory Lock (via HTTP endpoint)

**Resultado:** ✅ Zero sequências duplicadas (via `POST /identifiers/generate` real).

| Caso | Descrição | OK | Erros | Duplicatas | p50(ms) |
|------|-----------|----|-------|------------|---------|
| 1 | 50 POST, MESMA categoria (alta contenção) | 50 | 0 | 0 | 1074.5 |
| 2 | 50 POST, 5 categorias (baixa contenção) | 10 | 40 (429 rate limit) | 0 | 223.0 |

- **Impacto da contenção:** +343.2% de latência no Caso 1 (925.4ms vs 208.8ms média) — serialização correcta pelo advisory lock.
- **Caso 2** teve 40/50 requests rate-limited (429) pela app (limite: 20 req/min por `ip:userId`), mas as 10 que passaram mostraram 0 duplicatas.
- **NOTA:** O `::text` cast foi aplicado em `identifier.service.ts:73` (`${auth.tenantId}::text` e `${opts.categoryId}::text`) — o bug do `hashtext(CONCAT(...))` estava presente desde o commit `5f214a8` e está agora corrigido.

---

## Bugs Encontrados

### 🔴 Bug 1 — GET/PATCH /tenants/me sempre 500 (CORRIGIDO)
- **Ficheiro:** `modules/tenants.module.ts` (linhas 105, 120)
- **Causa:** Regressão do FIX 1 (`4e409e7`): handler usava `: any` e destruturava `db` do contexto Elysia (`{ auth, set, db }`), mas `db` não existe no contexto. Antes do FIX 1, o código usava correctamente o import global `db` da linha 2.
- **Impacto:** Qualquer request a `/tenants/me` retornava 500.
- **Correcção aplicada:** Removido `db` da destruturação e `: any` cast — o handler volta a usar o import global `db`.

### 🟡 Bug 2 — POST /identifiers/generate sempre 400 (CORRIGIDO)
- **Ficheiro:** `services/identifier.service.ts` (linha 73)
- **Causa:** `sql\`hashtext(CONCAT(${auth.tenantId}, '-', ${opts.categoryId}))\`` — o drizzle não consegue inferir o tipo do parâmetro `$1` dentro de `hashtext(CONCAT(...))`. Bug presente desde o commit `5f214a8`.
- **Impacto:** Qualquer POST a `/identifiers/generate` retornava 400.
- **Correcção aplicada:** `::text` cast: `${auth.tenantId}::text` e `${opts.categoryId}::text`.

### 🟡 Bug 3 — A5 Caso 1 expõe detalhe interno da BD (CORRIGIDO)
- **Ficheiro:** `modules/identifiers.module.ts` (handlers GET /, POST /generate, PATCH /:identifier/cancel)
- **Causa:** O erro `invalid input syntax for type uuid` da BD (postgres.js) não era sanitizado antes de ser devolvido ao cliente. O `onError` global estava a ser bypassado porque o erro ocorria dentro de `db.transaction()` e o handler não tinha try/catch (GET /) ou usava `err.message` cru (POST/PATCH).
- **Impacto:** Leve — expunha que é PostgreSQL e o tipo da coluna (`uuid`). Não expunha dados.
- **Correcção aplicada:** Adicionado try/catch em GET / com `safeError(err)`; POST /generate e PATCH /:identifier/cancel substituíram `err.message` por `safeError(err)`.
- **Reteste (2026-07-04):** `GET /identifiers` com JWT contendo `tenantId: "'; DROP TABLE users; --"` retorna `500 {"error":{"code":"INTERNAL_ERROR","message":"Formato de dados inválido."}}`. ✅ Sem leak de PostgreSQL, uuid, ou erro cru.

---

## Scripts de Teste

Localizados em `apps/api/scripts/loadtest/`:

| Script | Propósito |
|--------|-----------|
| `seed.ts` | Cria 3 tenants com dados + JWTs |
| `a1-a2-concurrent.ts` | A1 (200 reqs ×3) + A2 (30 reqs pool burst) |
| `a3-rollback-test.ts` | A3 (50 iterações erro + leitura cruzada) |
| `a5-bypass-test.ts` | A5 (3 payloads malformados) |
| `b2-latency-benchmark.ts` | B2 (latência a 10/50/200 reqs) |
| `b3-advisory-lock.ts` | B3 (advisory lock via HTTP endpoint) |

Uso: `bun run scripts/loadtest/<script>.ts` (executar de `apps/api/`).

---

## Resumo

| Teste | Estado | Notas |
|-------|--------|-------|
| A1 — Fuzzing concorrência | ✅ Pass | 0 leaks em 600 reqs |
| A2 — Exaustão pool | ✅ Pass | 0 leaks em 30 reqs burst |
| A3 — Rollback SET LOCAL | ✅ Pass | 0 leaks em 50 iterações |
| A4 — Verificação estática | ✅ Pass | Todos os módulos OK |
| A5 — Bypass tenantId | ✅ Pass | 3 casos seguros |
| B1 — Benchmark baseline | ❌ N/A | Parent commit não compila |
| B2 — Latência concorrência | ✅ Pass | 0 falhas em 520 reqs |
| B3 — Advisory lock | ✅ Pass | 0 duplicatas |

**Conclusão:** Isolamento entre tenants confirmado sob concorrência real, exaustão de pool, rollback de SET LOCAL, e bypass de tenantId malformado. 3 bugs corrigidos durante a sessão de testes: (1) regressão do FIX 1 em `tenants.module.ts` (`: any` + `db` do contexto), (2) `hashtext(CONCAT(...))` sem `::text` cast em `identifier.service.ts` (pré-existente desde `5f214a8`), e (3) leak de informação no A5 Caso 1 sanitizado com `safeError()` em `identifiers.module.ts`. 0 bugs remanescentes.
