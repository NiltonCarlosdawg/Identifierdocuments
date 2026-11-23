# License Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer da licença a fonte única do direito de uso, mantendo checkout self-service com aprovação manual da provedora.

**Architecture:** `plans` é catálogo, `orders` é pedido, `licenses` é estado comercial. `getSubscriptionContext` passa a derivar estado/limites da licença. Painel provider gere licenças; onboarding cria trial.

**Tech Stack:** TypeScript, Bun, Elysia, Drizzle, Postgres, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-23-license-checkout-design.md`

## Global Constraints

- Commits pequenos em inglês; resposta em português.
- Sem segredos, dados reais, produção, contas ou credenciais reais.
- Não portar nesta ronda: e-mails transaccionais, CORS/IP/sessões/keyring/RLS vazio do patch dos Vídeos.
- Migração nova é `0022_license.sql` (`0021_subscriptions` já existe). Nunca editar migrações aplicadas.
- Dados sintéticos; testes com Postgres/Redis descartáveis.

---

### Task 1: Modelo de licença

**Files:** modify `apps/api/src/db/schema.ts`; create `apps/api/src/db/migrations/0022_license.sql`; modify `apps/api/src/db/migrations/meta/_journal.json`; create `apps/api/src/lib/license.ts`; create `apps/api/src/__tests__/license.test.ts`.

- [ ] **Step 1:** testar `licenseState(license, now)` e `formatLicenseNumber(year, seed)`:
  - trial dentro do prazo → `trial`; expirado até 7 dias → `grace`; expirado além → `read_only`; `suspended` → `suspended`.
  - `formatLicenseNumber(2026, "A3TBTE432ZPX")` → `DOCID-2026-A3TB-TE43-2ZPX`.
- [ ] **Step 2:** correr `bun test src/__tests__/license.test.ts` → FAIL.
- [ ] **Step 3:** implementar as funções puras em `lib/license.ts` (sem imports de BD).
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5:** criar tabela `licenses` no schema (tenantId único, licenseNumber único, planId, maxUsers, status, validUntil, issuedAt, updatedBy) e migração `0022_license.sql` com RLS `FORCE`, policy por tenant e backfill: tenants existentes → licença sem prazo/limite (`status = 'active'`, `validUntil = NULL`, `maxUsers = NULL`); tenants novos tratados no código.
- [ ] **Step 6:** atualizar `_journal.json` com idx 22.
- [ ] **Step 7:** validar migração do zero e com dados locais; commit.

### Task 2: Serviço de licenças e limites

**Files:** create `apps/api/src/services/license.service.ts`; modify `apps/api/src/services/subscription.service.ts`; create `apps/api/src/__tests__/license.service.test.ts`.

- [ ] **Step 1:** testar `getLicenseContext` com `fake DB` devolvendo: licença suspensa → `read_only`; `maxUsers` da licença prevalece sobre o plano.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3:** implementar `getLicenseContext(tenantId, executor?)` e `issueLicense(...)`; Mudanças em `getSubscriptionContext`: se existir licença, `status`/`plan`/`maxUsers` vêm dela.
- [ ] **Step 4:** correr → PASS; `bunx tsc --noEmit`.
- [ ] **Step 5:** commit.

### Task 3: Integração checkout, onboarding e painel

**Files:** modify `apps/api/src/services/order.service.ts`, `apps/api/src/modules/tenants.module.ts`, `apps/api/src/modules/provider.module.ts`, `apps/api/src/modules/plans.module.ts` ou `tenants.module.ts` para-get own license; create `apps/api/src/__tests__/license-flow.test.ts`.

- [ ] **Step 1:** testar que `approveOrder` grava uma licença com `validUntil` +365 dias e `maxUsers` do plano.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3:** ligar aprovação a `issueLicense`; onboarding cria licença trial; endpoints provider `GET /provider/licenses`, `PATCH /provider/licenses/:number`; admin `GET /tenants/me/license`.
- [ ] **Step 4:** correr → PASS; commit.

### Task 4: Validação final

- [ ] Rodar suite completa com Postgres/Redis descartáveis (migrações do zero + seed).
- [ ] `bunx tsc --noEmit`.
- [ ] Atualizar spec com estado final; relatório com evidência.
