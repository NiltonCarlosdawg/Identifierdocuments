# Subscrições e Licenças — Plano 1: API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar na API o modelo de planos, a imposição de todos os limites (utilizadores, identificadores online, uploads, orçamento offline), o fluxo de pedidos com aprovação manual e o poder da provedora (planos, tenants, suspensão), com emails e lembretes de renovação.

**Architecture:** Três tabelas novas (`plans`, `orders`, `provider_users`) globais (sem RLS/tenant), colunas de subscrição em `organizations`, um serviço partilhado `subscription.service` com funções de verificação que devolvem `{code,message}|null`, e dois módulos novos: `subscriptions.module` (público: planos + checkout + pedidos) e `provider.module` (auth própria, escopo `provider`). A imposição faz-se nos módulos/serviços existentes (users, identifiers, documents, lease).

**Tech Stack:** Bun + Elysia 1.1 + Drizzle 0.31 + TypeBox + jose + BullMQ + nodemailer + `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-23-licensing-subscriptions-design.md`

## Global Constraints

- Idioma de mensagens de erro, emails e conteúdo: **português**.
- Moeda: **AOA (kwanzas), inteiro** — campo `price` é `integer`.
- Plano free (fixo, seed): `maxUsers=1`, `monthlyOnlineIdentifiers=10`, `offlineBudgetPerMachine=10`, `isFree=true`, `price=0`. Não editável no painel.
- Renovação/upgrade aprovado: plano substituído de imediato, `subscriptionExpiresAt = data_da_aprovação + 365 dias` (não soma ao período restante).
- Expirado/suspensão manual: 1 upload/dia por utilizador; criação de identificadores só ORG_ADMIN; sem novas reservas de lease; leases existentes consumíveis; fila pré-expiração sobe normalmente (não há retenção).
- Exceção do limite diário: uploads vindos da fila offline (`uploadSource === "sync"`) **não contam** e nunca são bloqueados — só `manual`/`scanner` contam para os 1/dia (spec §7).
- Orçamento offline: free = 10 **totais por máquina, uma vez, só ORG_ADMIN, nunca repõe**; pago = repõe **mensalmente**, qualquer utilizador.
- Lotes de lease: cada reserva reserva `min(50, orçamento_restante)` — constante `DEFAULT_LEASE_BATCH_SIZE = 50` (o `identifierLeaseBatchSize` da organização desaparece).
- Verificação pós-aprovação: em runtime confirma só a transição free→pago; o teste de dev cobre também geração de identificador sem bloqueio.
- Migração: todos os tenants existentes → plano free; tenants acima do limite mantêm utilizadores (só não adicionam mais).
- Sem branding "Verano Labs" em nada visível.
- Formato de erro nos módulos: `set.status = <4xx>; return { error: { code, message } }` (o desktop lê `body.message || body.error.message`).
- Env novas: `PROVIDER_NOTIFY_EMAIL`, `LANDING_URL`. Sem SMTP configurado, o mailer cai para log (padrão existente).

## Review Focus

1. **RLS nas tabelas globais** — `0017_force_rls.sql` pode ter dado FORCE RLS a tabelas; `plans`/`orders`/`provider_users` são globais e têm de ser lidas sem contexto de tenant. *Testo:* todos os testes de orders/plans/login correm **sem** `withTenant` e têm de passar (tasks 9–11).
2. **Registo de tenant novo com `plan_id NOT NULL`** — o insert em `tenants.module.ts:49` falharia se não levar plano. *Testo:* task 7 cria um tenant via handler/fixture e afirma que fica com plano free.
3. **Desktop a enviar `identifierLeaseBatchSize` depois do drop da coluna** — o PATCH não pode rebentar até o Plano 3 limpar o UI. *Testo:* task 7 faz `PATCH /tenants/me` com o campo extra e espera 200.
4. **Expiração lazy** — o job diário pode ainda não ter corrido quando o tenant expira a meio do dia. *Testo:* task 2 cria org `paid` com `expiresAt` ontem e afirma que os checks a tratam como `expired`.
5. **Migração over-limit** — tenant com 8 utilizadores e `maxUsers=1` não pode convidar mais, sem apagar ninguém. *Testo:* task 3 cria org com 3 utilizadores, `maxUsers=1`, e afirma que `checkUserLimit` bloqueia.

---

### Task 1: Schema, migração e seed do plano free

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/migrations/00XX_subscriptions.sql` (gerado + editado)
- Modify: `apps/api/src/db/seed.ts`
- Test: `apps/api/src/__tests__/subscription-schema.test.ts`

**Interfaces:**
- Produces (tabelas/colunas usadas por todas as tasks seguintes):
  - `plans(id, name, price, maxUsers, monthlyOnlineIdentifiers, offlineBudgetPerMachine, isFree, active, createdAt)` — export `plans`
  - `orders(id, tenantId, planId, paymentMethod["multicaixa"|"transfer"|"send_order"], phone, contactEmail, status["pending"|"approved"|"rejected"], rejectReason, checkoutJti(unique), decidedAt, decidedBy→provider_users, createdAt)` — export `orders`
  - `providerUsers(id, email(unique), passwordHash, name, isActive, createdAt)` — export `providerUsers`
  - `organizations`: + `planId`(uuid, FK plans, NOT NULL), + `subscriptionStatus["free"|"paid"|"expired"|"suspended"]`(default `"free"`), + `subscriptionExpiresAt`(timestamp tz, nullable); **removidos** `identifierLeaseBatchSize` e `plan`

- [ ] **Step 1: Escrever o teste falhante**

```ts
// apps/api/src/__tests__/subscription-schema.test.ts
import { describe, test, expect, afterAll } from "bun:test";
import { db } from "../db";
import { plans, organizations } from "../db/schema";
import { eq, isNull } from "drizzle-orm";

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.name, "schema-test-org"));
  await db.delete(plans).where(eq(plans.name, "schema-test-plan"));
});

describe("schema de subscrições", () => {
  test("seed cria exatamente um plano free com os limites do spec", async () => {
    const free = await db.select().from(plans).where(eq(plans.isFree, true));
    expect(free.length).toBe(1);
    expect(free[0]).toMatchObject({
      price: 0, maxUsers: 1, monthlyOnlineIdentifiers: 10,
      offlineBudgetPerMachine: 10, active: true,
    });
  });
  test("plano pago inserido manualmente guarda os campos", async () => {
    const [p] = await db.insert(plans).values({
      name: "schema-test-plan", price: 250000, maxUsers: 10,
      monthlyOnlineIdentifiers: 500, offlineBudgetPerMachine: 1000,
    }).returning();
    expect(p.id).toBeTruthy();
  });
  test("organização sem plano é impossível (coluna NOT NULL)", async () => {
    const free = (await db.select().from(plans).where(eq(plans.isFree, true)))[0];
    const [org] = await db.insert(organizations).values({
      name: "schema-test-org", slug: `schema-test-${Date.now()}`, planId: free.id,
    }).returning();
    expect(org.subscriptionStatus).toBe("free");
    expect(org.subscriptionExpiresAt).toBeNull();
  });
});
```

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/subscription-schema.test.ts`
Expected: FAIL (tabela `plans` inexistente / coluna desconhecida)

- [ ] **Step 3: Alterar `src/db/schema.ts`**

Adicionar as três tabelas no estilo existente (`text("col", { enum: [...] })`, `timestamp("created_at").notNull().defaultNow()`), com `index`/`uniqueIndex` onde indicado. Em `organizations`: remover `identifierLeaseBatchSize` e `plan`, adicionar:

```ts
planId: uuid("plan_id").notNull().references(() => plans.id),
subscriptionStatus: text("subscription_status", { enum: ["free","paid","expired","suspended"] }).notNull().default("free"),
subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
```

`orders`: índices `orders_tenant_idx`, `orders_status_idx`, `uniqueIndex("orders_checkout_jti_uidx").on(t.checkoutJti)`.

- [ ] **Step 4: Gerar e editar a migração**

Run: `cd apps/api && bun run db:generate`
Edutar o ficheiro gerado (provável `00XX_subscriptions.sql`):
1. `ADD COLUMN plan_id` → nullable (sem NOT NULL) para não rebentar com linhas existentes.
2. No fim, acrescentar o backfill:

```sql
INSERT INTO plans (name, price, max_users, monthly_online_identifiers, offline_budget_per_machine, is_free, active, created_at)
SELECT 'Free', 0, 1, 10, 10, true, true, now()
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE is_free = true);

UPDATE organizations SET plan_id = (SELECT id FROM plans WHERE is_free = true LIMIT 1)
WHERE plan_id IS NULL;

ALTER TABLE organizations ALTER COLUMN plan_id SET NOT NULL;
-- removidos: identifier_lease_batch_size, plan (drizzle já gera o DROP se as colunas saíram do schema)
```

Nota: **não há dados a migrar para os 10 offline do admin free** — o orçamento é calculado por máquina (task 6), pelo que qualquer dispositivo de tenant free fica com 10 números totais automaticamente.

- [ ] **Step 5: Correr a migração e o seed**

Run: `cd apps/api && bun run db:migrate && bun run db:seed`
Expected: sem erros; `SELECT count(*) FROM plans WHERE is_free` → 1

- [ ] **Step 6: Correr o teste e verificar passa**

Run: `cd apps/api && bun test src/__tests__/subscription-schema.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations apps/api/src/db/seed.ts apps/api/src/__tests__/subscription-schema.test.ts
git commit -m "feat(api): schema de planos, pedidos e provedora + migração para plano free"
```

---

### Task 2: `subscription.service` — contexto e verificações

**Files:**
- Create: `apps/api/src/services/subscription.service.ts`
- Test: `apps/api/src/__tests__/subscription-checks.test.ts`

**Interfaces:**
- Consumes: tabelas da Task 1; `isTenantAdmin` de `src/services/access-decision.service.ts` (ler assinatura antes de usar); tipo de executor = o parâmetro `tx` usado em `leaseIdentifiers` (mesmo padrão de `withTenant`).
- Produces (usado pelas tasks 3–7, 11):
  - `type LimitError = { code: string; message: string }`
  - `class SubscriptionError extends Error { constructor(public code: string, message: string) }`
  - `getSubscriptionContext(tenantId: string, executor?): Promise<{ org; plan; status: "free"|"paid"|"expired"|"suspended" }>` — derivação **lazy**: `status === "paid" && subscriptionExpiresAt < now` ⇒ `"expired"` (o job da task 13 é só para emails/display)
  - `getFreePlan(executor?): Promise<typeof plans.$inferSelect>`
  - `checkUserLimit(tenantId, executor?): Promise<LimitError | null>` — `count(users) > plan.maxUsers` ⇒ `{ code: "SUBSCRIPTION_USER_LIMIT", message: "O limite de utilizadores do seu plano foi atingido. Faça upgrade para convidar mais." }`
  - `checkIdentifierQuota(tenantId, executor?): Promise<LimitError | null>` — `status "expired"|"suspended"` ⇒ `SUBSCRIPTION_RESTRICTED` (o caller distingue admin antes de chamar — ver Step 3); senão `count(identifiers criados este mês) >= plan.monthlyOnlineIdentifiers` ⇒ `IDENTIFIER_QUOTA_EXCEEDED`
  - `checkUploadLimit(tenantId, userId, executor?): Promise<LimitError | null>` — só ativo se `status "expired"|"suspended"`; conta `documents + document_versions` com `uploadedBy = userId` e `createdAt >= date_trunc('day', now())` (dia UTC — nota no comentário) `>= 1` ⇒ `{ code: "UPLOAD_LIMIT_REACHED", message: "Subscrição expirada: limite de 1 upload por dia." }`
  - `getTenantContactEmail(tenantId, executor?): Promise<string | null>` — email do utilizador **mais antigo** do tenant (`ORDER BY created_at ASC LIMIT 1`) = criador

- [ ] **Step 1: Escrever o teste falhante**

```ts
// apps/api/src/__tests__/subscription-checks.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db, withTenant } from "../db";
import { plans, organizations, users, identifiers, documents, sectors } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import {
  getSubscriptionContext, checkUserLimit, checkIdentifierQuota,
  checkUploadLimit, getFreePlan,
} from "../services/subscription.service";

const tag = `chk-${Date.now()}`;
let freePlan: any, paidPlan: any;
const orgs: string[] = [];

async function mkOrg(name: string, overrides: any = {}) {
  const id = crypto.randomUUID();
  orgs.push(id);
  await db.insert(organizations).values({
    id, name: `${name}-${tag}`, slug: `${name}-${tag}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    planId: overrides.planId ?? freePlan.id,
    subscriptionStatus: overrides.status ?? "free",
    subscriptionExpiresAt: overrides.expiresAt,
  });
  return id;
}

beforeAll(async () => {
  freePlan = await getFreePlan();
  const [p] = await db.insert(plans).values({
    name: `paid-${tag}`, price: 100000, maxUsers: 2,
    monthlyOnlineIdentifiers: 2, offlineBudgetPerMachine: 100,
  }).returning();
  paidPlan = p;
});

afterAll(async () => {
  for (const id of orgs) {
    await withTenant(id, async (tx) => {
      await tx.delete(documents).where(eq(documents.tenantId, id));
      await tx.delete(identifiers).where(eq(identifiers.tenantId, id));
      await tx.delete(sectors).where(eq(sectors.tenantId, id));
      await tx.delete(users).where(eq(users.tenantId, id));
      await tx.delete(organizations).where(eq(organizations.id, id));
    });
  }
  await db.delete(plans).where(eq(plans.name, `paid-${tag}`));
});

describe("subscription.service", () => {
  test("expiração lazy: paid com data de ontem é tratado como expired", async () => {
    const id = await mkOrg("lazy", { planId: paidPlan.id, status: "paid",
      expiresAt: new Date(Date.now() - 86400000) });
    const ctx = await getSubscriptionContext(id);
    expect(ctx.status).toBe("expired");
    expect(await checkUploadLimit(id, crypto.randomUUID())).toMatchObject({ code: "UPLOAD_LIMIT_REACHED" });
  });

  test("checkUserLimit bloqueia acima do limite sem apagar utilizadores (migração over-limit)", async () => {
    const id = await mkOrg("over", { planId: paidPlan.id }); // maxUsers: 2
    await withTenant(id, async (tx) => {
      const [sec] = await tx.insert(sectors).values({ tenantId: id, name: "S", code: "SO" }).returning();
      for (let i = 0; i < 3; i++) await tx.insert(users).values({
        tenantId: id, sectorId: sec.id, email: `u${i}-${tag}@t.io`, passwordHash: "x", fullName: `U${i}`,
      });
      expect(await checkUserLimit(id, tx)).toMatchObject({ code: "SUBSCRIPTION_USER_LIMIT" });
      const n = await tx.select().from(users).where(eq(users.tenantId, id));
      expect(n.length).toBe(3); // nada foi apagado
    });
  });

  test("checkUserLimit permite abaixo do limite", async () => {
    const id = await mkOrg("under", { planId: paidPlan.id }); // 1 user de 2
    await withTenant(id, async (tx) => {
      const [sec] = await tx.insert(sectors).values({ tenantId: id, name: "S", code: "SU" }).returning();
      await tx.insert(users).values({ tenantId: id, sectorId: sec.id, email: `only-${tag}@t.io`, passwordHash: "x", fullName: "Only" });
      expect(await checkUserLimit(id, tx)).toBeNull();
    });
  });

  test("quota mensal de identificadores", async () => {
    const id = await mkOrg("quota", { planId: paidPlan.id }); // monthlyOnlineIdentifiers: 2
    await withTenant(id, async (tx) => {
      expect(await checkIdentifierQuota(id, tx)).toBeNull();
      // fixture mínima: sector + 2 identifiers; espelhar os campos obrigatórios
      // usados em critical-flow.test.ts (categoria do seed, ex. "PROP")
      const [sec] = await tx.insert(sectors).values({ tenantId: id, name: "S", code: "SQ" }).returning();
      for (let i = 0; i < 2; i++) await tx.insert(identifiers).values({
        tenantId: id, sectorId: sec.id, categoryId: "PROP", createdBy: null,
      } as any);
      expect(await checkIdentifierQuota(id, tx)).toMatchObject({ code: "IDENTIFIER_QUOTA_EXCEEDED" });
    });
  });

  test("upload: 0 hoje permite, 1 hoje bloqueia (só em expired/suspended)", async () => {
    const uid = crypto.randomUUID();
    const active = await mkOrg("up", { planId: paidPlan.id, status: "paid",
      expiresAt: new Date(Date.now() + 86400000) });
    expect(await checkUploadLimit(active, uid)).toBeNull(); // ativo não limita

    const suspended = await mkOrg("up2", { planId: paidPlan.id, status: "suspended" });
    expect(await checkUploadLimit(suspended, uid)).toBeNull(); // sem uploads hoje → pode

    await withTenant(suspended, async (tx) => {
      const [sec] = await tx.insert(sectors).values({ tenantId: suspended, name: "S", code: "SU2" }).returning();
      const [ident] = await tx.insert(identifiers).values({
        tenantId: suspended, sectorId: sec.id, categoryId: "PROP", createdBy: null,
      } as any).returning();
      await tx.insert(documents).values({ tenantId: suspended, identifierId: ident.id, uploadedBy: uid });
    });
    expect(await checkUploadLimit(suspended, uid)).toMatchObject({ code: "UPLOAD_LIMIT_REACHED" });
    expect(await checkUploadLimit(suspended, crypto.randomUUID())).toBeNull(); // outro user não é afetado
  });
});
```

Nota: se `identifiers.categoryId` for FK para `categories`, inserir primeiro uma categoria fixture ou usar uma categoria existente do seed (`PROP`) — o implementador ajusta o fixture mantendo as asserções.

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/subscription-checks.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `src/services/subscription.service.ts`**

Regras fixas do spec na implementação:
- `getSubscriptionContext` carrega `organizations` + `plans` (join por `planId`); deriva `expired` lazy (ver Interfaces). `suspended` tem precedência sobre a data.
- Admin (usado nos callers, não aqui): `isTenantAdmin` de `access-decision.service`.
- `checkIdentifierQuota` **não** distingue admin — o caller (task 4) só a chama para não-admins em estado expirado; para admin em expirado aplica-se o teto mensal normal.
- Contagem mensal: `identifiers.created_at >= date_trunc('month', now())`.
- Dia de upload: UTC, `date_trunc('day', now())` — comentário `// dia UTC: aproximação aceite para o limite de 1/dia`.

- [ ] **Step 4: Correr o teste e verificar passa**

Run: `cd apps/api && bun test src/__tests__/subscription-checks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/subscription.service.ts apps/api/src/__tests__/subscription-checks.test.ts
git commit -m "feat(api): subscription.service com contexto e verificações de limites"
```

---

### Task 3: Limite de utilizadores nos 3 endpoints

**Files:**
- Modify: `apps/api/src/modules/users.module.ts` (invite ~L188-195 após gate de roles; create ~L114-119; import ~L415)
- Test: cobertura na task 2 (checks) + verificação de wiring: `apps/api/src/__tests__/subscription-wiring.test.ts`

**Interfaces:**
- Consumes: `checkUserLimit(tenantId, executor)` da task 2.
- Produces: comportamento — qualquer tentativa de adicionar utilizadores acima de `plan.maxUsers` responde `403 { error: { code: "SUBSCRIPTION_USER_LIMIT", message } }`.

- [ ] **Step 1: Escrever o teste de wiring falhante**

Teste HTTP (padrão `phase3-4.integration.test.ts`: servidor em `API_TEST_PORT`, helper `api(path, { token })`): criar tenant com `maxUsers` cumprido (ou usar fixture), autenticar como ORG_ADMIN, `POST /users/invite` → esperar **403** e `error.code === "SUBSCRIPTION_USER_LIMIT"`; `GET /users/` continua a listar os existentes (nada foi apagado).

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/subscription-wiring.test.ts`
Expected: FAIL (hoje o invite cria o utilizador → 200)

- [ ] **Step 3: Implementar nos 3 sites de `users.module.ts`**

Após o gate de roles de cada handler, dentro do `withTenant(tx)`:

```ts
const limit = await checkUserLimit(tenantId, tx);
if (limit) { set.status = 403; return { error: limit }; }
```

- [ ] **Step 4: Correr o teste e verificar passa**

Run: `cd apps/api && bun test src/__tests__/subscription-wiring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/users.module.ts apps/api/src/__tests__/subscription-wiring.test.ts
git commit -m "feat(api): impõe limite de utilizadores do plano em invite/create/import"
```

---

### Task 4: Quota de identificadores online

**Files:**
- Modify: `apps/api/src/modules/identifiers.module.ts` (handler `POST /generate`, L179-220)
- Modify: `apps/api/src/services/subscription.service.ts` (se precisar de variante admin)
- Test: `apps/api/src/__tests__/subscription-wiring.test.ts` (acrescentar casos)

**Interfaces:**
- Consumes: `checkIdentifierQuota`, `getSubscriptionContext`, `isTenantAdmin` (`access-decision.service`).
- Produces: regra —
  - `expired|suspended` **e não-admin** ⇒ `403 SUBSCRIPTION_RESTRICTED` ("Subscrição expirada. Contacte o administrador.")
  - `expired|suspended` **admin** ⇒ continua, sujeito ao teto mensal
  - ativo (free/paid) ⇒ teto mensal do plano para todos

- [ ] **Step 1: Acrescentar testes falhantes**

Na suite wiring: tenant `paid` com 2/2 identificadores no mês ⇒ `POST /identifiers/generate` → 403 `IDENTIFIER_QUOTA_EXCEEDED`; tenant `expired` com utilizador MEMBER ⇒ 403 `SUBSCRIPTION_RESTRICTED`; mesmo tenant, ORG_ADMIN ⇒ 200.

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/subscription-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar no handler `POST /identifiers/generate`**

Antes de chamar `generateIdentifier`: carregar contexto; se `status` expirado/suspensão → `isTenantAdmin`; não-admin retorna 403 `SUBSCRIPTION_RESTRICTED`; admin cai no `checkIdentifierQuota`. Em estado ativo, aplicar `checkIdentifierQuota` a todos.

- [ ] **Step 4: Correr e verificar passa**

Run: `cd apps/api && bun test src/__tests__/subscription-wiring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/identifiers.module.ts apps/api/src/services/subscription.service.ts apps/api/src/__tests__/subscription-wiring.test.ts
git commit -m "feat(api): quota mensal de identificadores e bloqueio na expiração (não-admin)"
```

---

### Task 5: Limite de 1 upload/dia na expiração

**Files:**
- Modify: `apps/api/src/modules/documents.module.ts` (handlers `POST /documents/attach` L43-69, `POST /documents/attachments` L71-99, `POST /documents/:param/versions` L299)
- Test: `apps/api/src/__tests__/subscription-wiring.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `checkUploadLimit(tenantId, userId, executor)`.
- Produces: nos 3 handlers, antes do service: se `status` é `expired|suspended` (contexto), `uploadSource !== "sync"` e `checkUploadLimit` devolver erro ⇒ `403 UPLOAD_LIMIT_REACHED`. **`uploadSource === "sync"` nunca é bloqueado** (itens enfileirados antes da expiração sobem normalmente — spec §7).

- [ ] **Step 1: Acrescentar teste falhante**

Tenant `suspended`, utilizador com 0 uploads hoje ⇒ `POST /documents/attach` → 200 (ou o código de sucesso do handler com fixture válida); repetir com `uploadSource: "manual"` ⇒ 403 `UPLOAD_LIMIT_REACHED`; repetir com `uploadSource: "sync"` ⇒ passa (fila pré-expiração). Tenant `paid` ativo ⇒ ilimitado (2 uploads seguidos ok).

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/subscription-wiring.test.ts`
Expected: FAIL no caso suspended

- [ ] **Step 3: Implementar nos 3 handlers**

Chamada única por handler, dentro do `withTenant`:

```ts
if (body.uploadSource !== "sync") { // itens da fila offline sobem sempre
  const limit = await checkUploadLimit(tenantId, auth!.userId, tx);
  if (limit) { set.status = 403; return { error: limit }; }
}
```

(`checkUploadLimit` já devolve `null` quando o estado não é expirado/suspenso — sem lógica extra no handler. O campo `uploadSource` já existe no body dos handlers.)

- [ ] **Step 4: Correr e verificar passa**

Run: `cd apps/api && bun test src/__tests__/subscription-wiring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/documents.module.ts apps/api/src/__tests__/subscription-wiring.test.ts
git commit -m "feat(api): 1 upload/dia por utilizador em subscrição expirada/suspensa"
```

---

### Task 6: Orçamento offline no lease (fonte única = plano)

**Files:**
- Modify: `apps/api/src/services/lease.service.ts` (L50-51 leem `org.identifierLeaseBatchSize` — substituir)
- Modify: `apps/api/src/modules/identifiers.module.ts` (catch do `/lease` → `SubscriptionError` ⇒ 403)
- Test: `apps/api/src/__tests__/lease-budget.test.ts`

**Interfaces:**
- Consumes: `getSubscriptionContext`, `SubscriptionError`, `isTenantAdmin`.
- Produces: `DEFAULT_LEASE_BATCH_SIZE = 50` em `lease.service.ts`; regras de `leaseIdentifiers` (mesma assinatura):
  1. `status expired|suspended` ⇒ `SubscriptionError("SUBSCRIPTION_RESTRICTED", …)` — sem novas reservas.
  2. `status free` **e não-admin** ⇒ `SubscriptionError("OFFLINE_ADMIN_ONLY", "Geração offline disponível apenas para o administrador no plano Free.")`
  3. `used` = free: `SUM(end_seq - start_seq + 1)` de **todos** os leases da máquina (todas as datas/estados — "esgotou não volta"); pago: o mesmo somatório com `created_at >= date_trunc('month', now())` (repõe mensalmente).
  4. `remaining = plan.offlineBudgetPerMachine - used`; `remaining <= 0` ⇒ `SubscriptionError("LEASE_BUDGET_EXCEEDED", …)`
  5. `batchSize = Math.min(DEFAULT_LEASE_BATCH_SIZE, remaining)` — substitui a leitura de `org.identifierLeaseBatchSize`.

- [ ] **Step 1: Escrever o teste falhante**

```ts
// apps/api/src/__tests__/lease-budget.test.ts — padrão offline-identifiers.test.ts (fixtures via withTenant)
// Casos:
// 1. free + ORG_ADMIN: 1º lease reserva 10 (min(50,10)); 2º lease no mesmo dispositivo → LEASE_BUDGET_EXCEEDED
// 2. free + MEMBER → OFFLINE_ADMIN_ONLY
// 3. paid (budget 100) com lease de 50 criado o mês passado (insert com createdAt anterior) → used=0 este mês → lease reserva 50
// 4. paid com used=100 este mês → LEASE_BUDGET_EXCEEDED
// 5. org paid com expiresAt ontem (lazy expired) → SUBSCRIPTION_RESTRICTED
// 6. paid (budget 100, used 80) → lease reserva min(50,20)=20
```

Cada caso: inserir plano fixture, org, utilizador com role, dispositivo, e chamar `leaseIdentifiers(tx, auth, …)` esperando `SubscriptionError` com o `code` ou sucesso com `endSeq - startSeq + 1` igual ao esperado.

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/lease-budget.test.ts`
Expected: FAIL (módulo/código não existe; hoje reserva sempre `min(50, …)` sem orçamento)

- [ ] **Step 3: Implementar em `lease.service.ts` e no catch do módulo**

Substituir L50-51 pela regra 3–5 acima (contagem por dispositivo = `identifierLeases.deviceId`); aplicar regras 1–2 antes do cálculo da faixa. No handler `/lease`, antes de `safeError`: `if (err instanceof SubscriptionError) { set.status = 403; return { error: { code: err.code, message: err.message } }; }`.

- [ ] **Step 4: Correr e verificar passa**

Run: `cd apps/api && bun test src/__tests__/lease-budget.test.ts`
Expected: PASS

- [ ] **Step 5: Correr a suíte inteira (regressão do lease antigo)**

Run: `cd apps/api && bun test`
Expected: PASS (os testes offline existentes usam default 50 — com orçamento free 10 podem precisar de fixture em plano pago; ajustar fixtures para `paid` onde reservam >10)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/lease.service.ts apps/api/src/modules/identifiers.module.ts apps/api/src/__tests__/lease-budget.test.ts
git commit -m "feat(api): orçamento offline por máquina vem do plano (free admin-only, repõe mensal em pago)"
```

---

### Task 7: Registo com plano free + `/tenants/me` com estado de subscrição

**Files:**
- Modify: `apps/api/src/modules/tenants.module.ts` (insert L49-56 + `planId`; GET L140 remove `identifierLeaseBatchSize`; PATCH L166/L182 remove campo; resposta ganha bloco `subscription`)
- Test: `apps/api/src/__tests__/subscription-wiring.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `getFreePlan`.
- Produces: `GET /tenants/me` devolve também:
  ```ts
  subscription: { status: "free"|"paid"|"expired"|"suspended", planName: string, price: number, expiresAt: string | null }
  ```
  (consumido pelo desktop no Plano 3). `PATCH /tenants/me` ignora `identifierLeaseBatchSize` se enviado (TypeBox não rejeita extras por omissão — confirmar; se rejeitar, manter o campo no schema e não escrever na BD).

- [ ] **Step 1: Acrescentar testes falhantes**

1. `POST /tenants/register` (padrão integration) → tenant criado tem plano free (`GET /tenants/me` → `subscription.status === "free"`, `planName === "Free"`).
2. `PATCH /tenants/me` com body contendo `identifierLeaseBatchSize: 50` (como o desktop atual envia) → **200**.

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/subscription-wiring.test.ts`
Expected: FAIL (registo rebenta por `plan_id` NOT NULL ou o PATCH falha)

- [ ] **Step 3: Implementar**

- Insert do registo: `planId: (await getFreePlan(tx)).id`.
- GET `/tenants/me`: remover `identifierLeaseBatchSize` (L140), acrescentar `subscription` (ler `subscriptionStatus` + `subscriptionExpiresAt` + nome/preço do plano via `getSubscriptionContext`).
- PATCH: remover L166 e L182; não escrever a coluna removida.

- [ ] **Step 4: Correr e verificar passa + suíte completa**

Run: `cd apps/api && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/tenants.module.ts apps/api/src/__tests__/subscription-wiring.test.ts
git commit -m "feat(api): registo cria tenant no plano free; /tenants/me expõe estado de subscrição"
```

---

### Task 8: Auth do painel (`provider_users` + login + guard)

**Files:**
- Modify: `apps/api/src/middleware/auth.ts` (adicionar `requireProvider()`)
- Create: `apps/api/src/modules/provider.module.ts` (prefixo `/provider`)
- Create: `apps/api/src/db/create-provider-user.ts`
- Modify: `apps/api/package.json` (script `provider:create`)
- Test: `apps/api/src/__tests__/provider-auth.test.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` de `src/lib/password`; jose (padrão de `authMiddleware`, issuer `docid-api`, audience **`docid-provider`**, claim `scope: "provider"`, exp 8h, secret `JWT_SECRET`).
- Produces:
  - `requireProvider()` — devolve derive com `ctx.provider: { id, email } | null`; 401 se inválido (padrão `requireAuth`).
  - `POST /provider/login` body `{ email, password }` → `{ token }`; credenciais erradas ⇒ 401 `PROVIDER_INVALID_CREDENTIALS`.
  - Script: `bun run provider:create -- <email> <password> [name]` — upsert por email com `hashPassword`.

- [ ] **Step 1: Escrever o teste falhante**

```ts
// provider-auth.test.ts
// 1. POST /provider/login com credenciais de um provider_users criado no beforeAll → { token }
// 2. login errado → 401 PROVIDER_INVALID_CREDENTIALS
// 3. GET /provider/orders sem token → 401; com token de utilizador normal (JWT desktop) → 401
// 4. com token provider → 200 (lista vazia ou com fixtures)
```

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/provider-auth.test.ts`
Expected: FAIL (rota/guard inexistentes)

- [ ] **Step 3: Implementar guard, login, script e registar o módulo no `src/index.ts`**

- `requireProvider()` em `auth.ts` espelhando `requireAuth` mas com audience `docid-provider` + verificação de `scope === "provider"`.
- `provider.module.ts` com `.use(requireProvider())` e placeholder `GET /provider/orders` (vazio, `[]`) — as rotas de verdade chegam nas tasks 9–12.
- `index.ts`: `.use(providerModule)`.

- [ ] **Step 4: Correr e verificar passa**

Run: `cd apps/api && bun test src/__tests__/provider-auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/modules/provider.module.ts apps/api/src/db/create-provider-user.ts apps/api/package.json apps/api/src/__tests__/provider-auth.test.ts apps/api/src/index.ts
git commit -m "feat(api): auth própria do painel (provider_users, JWT escopo provider)"
```

---

### Task 9: Planos — CRUD da provedora + endpoint público

**Files:**
- Modify: `apps/api/src/modules/provider.module.ts`
- Create: `apps/api/src/modules/plans.module.ts` (público, prefixo `GET /plans`)
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/src/__tests__/plans.test.ts`

**Interfaces:**
- Consumes: guard da task 8, tabela `plans`.
- Produces:
  - `GET /plans` (sem auth) → `{ plans: [{ id, name, price, maxUsers, monthlyOnlineIdentifiers, offlineBudgetPerMachine }] }` — só `active`.
  - `GET /provider/plans` → todas (inclui `isFree`, `active`).
  - `POST /provider/plans` body `{ name, price, maxUsers, monthlyOnlineIdentifiers, offlineBudgetPerMachine }`.
  - `PUT /provider/plans/:id` mesmo body; **plano free não editável** ⇒ 403 `FREE_PLAN_IMMUTABLE`; `active=false` no free ⇒ 403 (o free tem de existir sempre).

- [ ] **Step 1: Escrever o teste falhante**

```ts
// plans.test.ts — TABELA GLOBAL: correr SEM withTenant (valida Review Focus 1)
// 1. GET /plans sem auth → 200, inclui o free com os valores do spec
// 2. login provider → POST /provider/plans cria → GET /provider/plans mostra
// 3. PUT /provider/plans/:id do free → 403 FREE_PLAN_IMMUTABLE
// 4. PUT num plano pago altera preço/limites → 200 e refletido
// 5. GET /plans não lista planos inactive
```

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/plans.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar os dois módulos e registar `plansModule` no `index.ts`**

Validação TypeBox dos campos (preço ≥ 0, limites ≥ 1 — `monthlyOnlineIdentifiers` ≥ 1).

- [ ] **Step 4: Correr e verificar passa**

Run: `cd apps/api && bun test src/__tests__/plans.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/plans.module.ts apps/api/src/modules/provider.module.ts apps/api/src/index.ts apps/api/src/__tests__/plans.test.ts
git commit -m "feat(api): CRUD de planos no painel e GET /plans público"
```

---

### Task 10: Pedidos — token de checkout, criação e email à provedora

**Files:**
- Create: `apps/api/src/services/order.service.ts`
- Create: `apps/api/src/modules/subscriptions.module.ts`
- Modify: `apps/api/src/services/mailer.service.ts` (`sendOrderReceivedEmail(toProvider, order)`)
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/src/__tests__/orders.test.ts`

**Interfaces:**
- Consumes: `hashToken`/jose (padrão `authMiddleware`); `getFreePlan`; mailer (fallback log sem SMTP).
- Produces:
  - `POST /subscriptions/checkout-token` (requireAuth + ORG_ADMIN) body `{}` → `{ token, url }` — JWT `purpose: "checkout"`, audience `docid-checkout`, exp **48h**, `jti` random; `url = ${LANDING_URL}/checkout?pedido=${token}`.
  - `GET /subscriptions/checkout?token=` (público) → `{ tenantName }` ou 401 `INVALID_TOKEN`.
  - `POST /orders` (público, rate-limit por IP como `tenants.module` L35) body:
    `{ token? , tenantSlug? , tenantEmail? , planId, paymentMethod: "multicaixa"|"transfer"|"send_order", phone, contactEmail }` — exatamente **um** identificador do tenant (`token` OU `tenantSlug`/`tenantEmail`); `tenantEmail` valida que é email de utilizador existente. Plano tem de existir, `active` e não-free. → `{ orderId, status: "pending" }`.
  - Single-use: `orders.checkoutJti` unique — JWT do token é verificado (signature + exp) e o `jti` guardado; repetir ⇒ **409 `TOKEN_USED`**.
  - Criação dispara `sendOrderReceivedEmail(PROVIDER_NOTIFY_EMAIL, order)` (inline como `enqueueInviteEmail` faz; log se sem SMTP).
  - `order.service.ts`: `createOrder(input)` e `resolveCheckoutToken(token)` — testeáveis sem HTTP.

- [ ] **Step 1: Escrever o teste falhante**

```ts
// orders.test.ts — sem withTenant nas queries globais (Review Focus 1)
// 1. helper cria tenant+admin; POST /subscriptions/checkout-token com token do admin → { token, url }
// 2. GET /subscriptions/checkout?token → { tenantName } do tenant
// 3. POST /orders com token + planId pago → 200 orderId; orders row pending com checkoutJti = jti
// 4. POST /orders com o MESMO token → 409 TOKEN_USED
// 5. POST /orders sem token, com tenantSlug → 200 (fallback)
// 6. POST /orders com tenantEmail inexistente → 404 TENANT_NOT_FOUND
// 7. POST /orders com plano free/inexistente → 404 PLAN_NOT_FOUND
// 8. sem SMTP, createOrder não lança (devolve log)
```

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/orders.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `order.service.ts`, `subscriptions.module.ts`, template do email, registar no `index.ts`**

Mensagens PT no spec. Token: mesmo `JWT_SECRET`, issuer `docid-api`, audience `docid-checkout`.

- [ ] **Step 4: Correr e verificar passa**

Run: `cd apps/api && bun test src/__tests__/orders.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/order.service.ts apps/api/src/modules/subscriptions.module.ts apps/api/src/services/mailer.service.ts apps/api/src/index.ts apps/api/src/__tests__/orders.test.ts
git commit -m "feat(api): pedidos de subscrição com token single-use e fallback por slug/email"
```

---

### Task 11: Aprovar/Rejeitar pedidos (com verificação e emails)

**Files:**
- Modify: `apps/api/src/modules/provider.module.ts` (rotas de pedidos)
- Modify: `apps/api/src/services/order.service.ts` (`approveOrder`, `rejectOrder`)
- Modify: `apps/api/src/services/mailer.service.ts` (`sendSubscriptionActiveEmail`, `sendOrderRejectedEmail`)
- Test: `apps/api/src/__tests__/orders.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `getTenantContactEmail`, `getSubscriptionContext`, audit (`auditLogs` com `userId: null`, `action: "subscription.approve"|"subscription.reject"`, `metadata` JSON com `providerUserId` — dentro de `withTenant(tenantId)`).
- Produces:
  - `POST /provider/orders/:id/approve` → atualiza `orders` (`status approved`, `decidedAt`, `decidedBy`) **e** organização: `planId = order.planId`, `subscriptionStatus = "paid"`, `subscriptionExpiresAt = now + 365 dias`. **Verificação runtime:** re-ler a org; se `status !== "paid"` ou `planId !== order.planId` ⇒ 500 e não envia email. Sucesso ⇒ email `sendSubscriptionActiveEmail(getTenantContactEmail(tenantId), …)` ("Subscrição concluída") + auditoria. Tenant já `paid` (renovação/upgrade): substitui e recalcula da aprovação (mesmo código). `orders` não-pending ⇒ 404/409 `ORDER_NOT_PENDING`.
  - `POST /provider/orders/:id/reject` body `{ reason }` → `status rejected` + `rejectReason`; email para `order.contactEmail` com o motivo; auditoria. Tenant fica como estava.

- [ ] **Step 1: Acrescentar testes falhantes**

```ts
// 1. aprovar → org paid, planId = plano do pedido, expiresAt ≈ now+365d (asserção de data)
// 2. aprovar 2ª vez → ORDER_NOT_PENDING
// 3. rejeitar com motivo → order rejected + reason guardado
// 4. VERIFICAÇÃO DEV: após aprovar, generateIdentifier com ORG_ADMIN do tenant → funciona sem bloqueio
//    (é a etapa extra que em produção não existe — ver spec §8)
// 5. auditoria: row audit_logs com action "subscription.approve" naquele tenantId
// 6. renovação: org já paid com expiresAt antigo → approve → expiresAt = now+365d (não soma)
```

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/orders.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `approveOrder`/`rejectOrder` + rotas**

Transação: updates de `orders` + `organizations` + audit; verificação re-ler; email por último (padrão mailer, log sem SMTP).

- [ ] **Step 4: Correr e verificar passa + suíte**

Run: `cd apps/api && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/provider.module.ts apps/api/src/services/order.service.ts apps/api/src/services/mailer.service.ts apps/api/src/__tests__/orders.test.ts
git commit -m "feat(api): aprovação/rejeição de pedidos com verificação, auditoria e emails"
```

---

### Task 12: Suspender/Reativar tenants

**Files:**
- Modify: `apps/api/src/modules/provider.module.ts`
- Test: `apps/api/src/__tests__/orders.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `getSubscriptionContext` (reação), audit.
- Produces:
  - `GET /provider/tenants` → `[{ id, name, slug, status, planName, expiresAt, userCount }]` (contagem via subquery).
  - `POST /provider/tenants/:id/suspend` → `subscriptionStatus = "suspended"` + audit `tenant.suspend` (condições = expirado, por lazy-check já coberto).
  - `POST /provider/tenants/:id/reactivate` → se plano free ⇒ `free`; senão `expiresAt > now ? "paid" : "expired"` + audit `tenant.reactivate`.

- [ ] **Step 1: Acrescentar testes falhantes**

suspend → status `suspended` e `checkUploadLimit` ativo (1/dia); reactivate com expiresAt futuro → `paid`; reactivate com expiresAt passado → `expired`; reactivate tenant free → `free`; auditoria escrita.

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/orders.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar as 3 rotas**

- [ ] **Step 4: Correr e verificar passa**

Run: `cd apps/api && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/provider.module.ts apps/api/src/__tests__/orders.test.ts
git commit -m "feat(api): suspensão manual e reativação de tenants com auditoria"
```

---

### Task 13: Lembretes de renovação (30/14/2 dias) + job diário

**Files:**
- Create: `apps/api/src/jobs/subscription-reminders.ts`
- Modify: `apps/api/src/jobs/workers.ts` (novo worker `docid-subscription`, repeat diário — seguir padrão do `docid-thumbnail`; se `getBullConnection()` devolver `null`, não arranca)
- Modify: `apps/api/src/services/mailer.service.ts` (`sendRenewalReminderEmail`, `sendProviderExpiryAlertEmail`)
- Test: `apps/api/src/__tests__/reminders.test.ts`

**Interfaces:**
- Consumes: `getTenantContactEmail`; env `PROVIDER_NOTIFY_EMAIL` (sem valor ⇒ log, não falha).
- Produces (funções exportadas testáveis **sem** BullMQ):
  - `findExpiringTenants(now: Date): Promise<Array<{ tenantId, name, daysLeft, contactEmail }>>` — `subscriptionStatus = "paid"` e `date_trunc('day', subscriptionExpiresAt) - date_trunc('day', now)` ∈ {30, 14, 2}.
  - `flipExpiredTenants(now: Date): Promise<number>` — `UPDATE … SET subscription_status = 'expired' WHERE subscription_status = 'paid' AND subscription_expires_at < now` (devolve nº de linhas; também resolve a consistência para display).
  - `runRenewalSweep(now: Date): Promise<{ reminded: number, expired: number }>` — `flipExpiredTenants` + para cada expirante: email de renovação ao criador; **no próprio dia da expiração** (0 dias, após flip) alerta à provedora. Job diário às 08:00 UTC (`"0 8 * * *"`).
  - Emails PT: lembrete diz "renova a [data]", sem "Verano Labs".

- [ ] **Step 1: Escrever o teste falhante**

```ts
// reminders.test.ts
// 1. org paid com expiresAt = now+30d → findExpiringTenants devolve com daysLeft 30 e contactEmail do criador
// 2. org paid com expiresAt = now+14d e +2d → incluídos; +7d → NÃO incluído
// 3. flipExpiredTenants: paid com expiresAt ontem → vira expired e devolve 1
// 4. runRenewalSweep com SMTP desligado → não lança; contagens corretas
```

- [ ] **Step 2: Correr e verificar falha**

Run: `cd apps/api && bun test src/__tests__/reminders.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar o módulo de sweep, worker e templates**

- [ ] **Step 4: Correr e verificar passa + suíte completa**

Run: `cd apps/api && bun test`
Expected: PASS (tudo)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jobs/subscription-reminders.ts apps/api/src/jobs/workers.ts apps/api/src/services/mailer.service.ts apps/api/src/__tests__/reminders.test.ts
git commit -m "feat(api): sweep diário de expiração e lembretes de renovação 30/14/2 dias"
```

---

## Fim do Plano 1

Critério de conclusão: `cd apps/api && bun test` verde, migração aplicada, script `provider:create` documentado no README da API (uma linha). O Plano 2 (`apps/admin`) e o Plano 3 (landing checkout + desktop) consomem estes endpoints e não alteram este contrato.
