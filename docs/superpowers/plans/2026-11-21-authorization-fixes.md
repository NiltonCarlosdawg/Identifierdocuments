# Authorization Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir quatro desvios de autorização no DocID: admin sem acesso total dentro do tenant, listagem de aprovações vazando pedidos alheios, decisões sem verificação de supervisor/auto-aprovação/auditoria, e os dois fluxos de pedido de acesso dessincronizados.

**Architecture:** Toda a decisão passa a viver num módulo puro (`access-decision.service.ts`) que recebe papéis frescos e dados simples; os handlers de Elysia e os serviços de anexos apenas buscam dados e aplicam a decisão. A sincronização entre `document_access_requests` e `approvals` acontece na mesma transação, sem migração de schema.

**Tech Stack:** TypeScript, Bun, Elysia, Drizzle ORM, Postgres, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-authorization-fixes-design.md`

## Global Constraints

- Responder em português; código, identificadores e commits em inglês (projeto usa nomes em inglês no código).
- Commits pequenos e convencionais: `fix:`, `test:`, `docs:`.
- Sem segredos, dados reais de tenants, produção, contas ou credenciais reais. Usar apenas dados sintéticos locais.
- `public` continua visível para todos; `public` continua a ser o default. Não alterar.
- Nenhuma mudança em RLS, migrações, schema, JWT, CORS, uploads ou dependências.
- Nenhuma proteção apenas na UI: toda a decisão fica no servidor.
- Testes unitários novos não abrem Postgres/Redis: usam objetos falsos (`fake tx`).
- Ao correr `bun test`, definir `JWT_SECRET=test-only-secret` porque `src/middleware/auth.ts:10-12` exige a variável no import. Este valor é sintético e apenas local.

## Review Focus

- **Admin cruzando tenant:** `ORG_ADMIN` vê tudo *dentro* do tenant; um documento de outro tenant nunca pode entrar na listagem. Teste em Task 1: `listDocumentsForApi` com `opts.tenantId` fixo e linhas fora desse tenant devem ser excluídas.
- **Papel fora de contexto:** `SECTOR_SUPERVISOR` não basta — é preciso ser o supervisor da aprovação. Teste em Task 2: `canSeeApproval(["SECTOR_SUPERVISOR"], "u1", { supervisorId: "u2", requesterId: "u3" })` é `false`.
- **Filtros combinados:** `?status=` e `?sectorId=` não podem alargar a visibilidade de um membro. Teste em Task 2: `canSeeApproval(["MEMBER"], "u1", { requesterId: "u2" })` é `false` mesmo com filtros.
- **Dupla decisão:** clicar em aprovar nos dois ecrãs não pode criar duas partilhas ativas. Teste em Task 4: `shouldCreateShare(existingShare)` é `false` quando já existe partilha ativa.
- **Rasto da decisão:** `PATCH /approvals/:id` tem de registar quem decidiu e o que foi decidido. Teste em Task 3: `approvalAuditEntry(...)` devolve `action`, `resource`, `resourceId` e `metadata` corretos.

---

## Estrutura de ficheiros

| Ficheiro | Responsabilidade |
|---|---|
| Create `apps/api/src/services/access-decision.service.ts` | Decisões puras de visibilidade/ permissão, mapeamento de estados, sincronização e auditoria |
| Create `apps/api/src/__tests__/access-decision.test.ts` | Testes unitários das decisões puras |
| Modify `apps/api/src/services/attachment.service.ts:468-507,632-660` | Aplicar admin bypass em `canAccessDocument` e `listDocumentsForApi` |
| Create `apps/api/src/__tests__/attachment-admin.test.ts` | Provas do admin com `fake tx` |
| Modify `apps/api/src/modules/approvals.module.ts:12-43,66-73,82-207` | Listagem/detalhe/decisão passam a usar o serviço puro; gravar auditoria |
| Modify `apps/api/src/modules/documents.module.ts:693-788` | Resolução do pedido usa o mesmo serviço; sincroniza a tabela gémea |
| Modify `apps/api/src/__tests__/phase3-4.integration.test.ts:421-428` | Atualizar a asserção antiga do admin |

---

### Task 1: Admin com poder total dentro do tenant

**Files:**
- Create: `apps/api/src/services/access-decision.service.ts`
- Create: `apps/api/src/__tests__/access-decision.test.ts`
- Modify: `apps/api/src/services/attachment.service.ts:468-507,632-660`
- Create: `apps/api/src/__tests__/attachment-admin.test.ts`
- Modify: `apps/api/src/__tests__/phase3-4.integration.test.ts:421-428`

**Interfaces:**
- Consumes: `getFreshRoles(userId, tenantId, executor?)` de `src/middleware/auth.ts:86-101` (já importado em `attachment.service.ts:10`).
- Produces:
  - `export function isTenantAdmin(roleNames: string[]): boolean`
  - `canAccessDocument(tx, auth, sectorId, visibility, docId, uploadedBy?, roleNames?)` — novo parâmetro opcional, por omissão obtém os papéis com `getFreshRoles(auth.userId, auth.tenantId, tx)`.
  - `listDocumentsForApi(tx, auth, opts)` — `opts` ganha campo opcional `roleNames?: string[]`.

- [ ] **Step 1: Escrever o teste que falha — decisão pura do admin**

Em `src/__tests__/access-decision.test.ts`, com `import { describe, expect, test } from "bun:test"`, criar:

```ts
describe("isTenantAdmin", () => {
  test("admin do tenant tem poder total", () => {
    expect(isTenantAdmin(["ORG_ADMIN"])).toBe(true);
    expect(isTenantAdmin(["MEMBER", "ORG_ADMIN"])).toBe(true);
  });
  test("member e supervisor não têm poder total", () => {
    expect(isTenantAdmin(["MEMBER"])).toBe(false);
    expect(isTenantAdmin(["SECTOR_SUPERVISOR"])).toBe(false);
  });
});
```

- [ ] **Step 2: Confirmar que falha**

Run: `cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/access-decision.test.ts`
Expected: FAIL com "isTenantAdmin is not a function".

- [ ] **Step 3: Implementar `isTenantAdmin`**

Em `src/services/access-decision.service.ts`, exportar `isTenantAdmin(roleNames: string[]): boolean` como `roleNames.includes("ORG_ADMIN")`. Sem imports de `db` a correr (usar apenas tipos se necessário).

- [ ] **Step 4: Confirmar que passa**

Run: `cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/access-decision.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Escrever os testes de integração do serviço de anexos**

Em `src/__tests__/attachment-admin.test.ts`, com `fakeTx` cujos métodos `query.*` lançam se chamados (para provar que o admin não precisa de consultar partilhas), e uma linha sintética `doc` com `visibility: "sector_only"`, `sectorId: "sector-b"`, `uploadedBy: "user-b"`, `tenantId: "tenant-a"`:

```ts
test("admin descarrega sector_only de outro sector", async () => {
  const result = await canAccessDocument(
    fakeTx as any,
    auth("admin-a", "tenant-a", "sector-a"),
    "sector-b", "sector_only", "doc-b", "user-b", ["ORG_ADMIN"],
  );
  expect(result).toEqual({ allowed: true, restricted: false });
});

test("listagem do admin inclui sector_only de outro sector e respeita tenant", async () => {
  const row = (id: string, tenantId: string) => ({
    id, tenantId, kind: "primary", tags: null, createdAt: new Date(),
    identifier: { visibility: "sector_only", sectorId: "sector-b", category: null },
    uploader: null, versions: [],
  });
  const rows = [row("doc-b", "tenant-a"), row("doc-c", "tenant-b")];
  // getSharedDocIds usa tx.select(...).from(...).where(...), não query.documentShares
  const selectChain = { from: () => ({ where: async () => [] }) };
  const fake = {
    query: { documents: { findMany: async () => rows.filter(r => r.tenantId === "tenant-a") } },
    select: () => selectChain,
  };
  const result = await listDocumentsForApi(fake as any, auth("admin-a", "tenant-a", "sector-a"), {
    tenantId: "tenant-a", page: 1, limit: 20, roleNames: ["ORG_ADMIN"],
  });
  expect(result.data.some((d: any) => d.id === "doc-b")).toBe(true);
  expect(result.data.some((d: any) => d.id === "doc-c")).toBe(false);
});
```

- [ ] **Step 6: Confirmar que falha**

Run: `cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/attachment-admin.test.ts`
Expected: FAIL — `fakeTx` é chamado (admin ainda não tem bypass) e/ou a linha `sector_only` não aparece.

- [ ] **Step 7: Implementar o bypass**

Em `attachment.service.ts`:
- `canAccessDocument`: aceitar `roleNames?: string[]` como 7.º parâmetro; se ausente e `v !== "public"`, `await getFreshRoles(auth.userId, auth.tenantId, tx)`; se `isTenantAdmin(roles)`, devolver `{ allowed: true, restricted: false }`. Não consultar papéis para documentos `public` (já são permitidos, evita query e novo ponto de falha).
- `listDocumentsForApi`: `opts` ganha `roleNames?: string[]`; resolver papéis apenas se alguma linha tiver `visibility !== "public"`; no `.filter`, se admin, aceitar a linha antes das outras condições.
- Substituir o comentário em `:473-476` que afirma que `ORG_ADMIN` não tem acesso.

- [ ] **Step 8: Confirmar que passa e atualizar o teste antigo**

Run: `cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/attachment-admin.test.ts src/__tests__/access-decision.test.ts`
Expected: PASS (4 testes).
Em `src/__tests__/phase3-4.integration.test.ts:421-428`, mudar o nome para `"admin descarrega sector_only (poder total)"` e a asserção para `200`; não alterar `:466-480`.
Se houver Postgres local configurado, correr também esse ficheiro; caso contrário registar o bloqueio dinâmico no relatório e validar a asserção por leitura.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/access-decision.service.ts apps/api/src/__tests__/access-decision.test.ts apps/api/src/services/attachment.service.ts apps/api/src/__tests__/attachment-admin.test.ts apps/api/src/__tests__/phase3-4.integration.test.ts
git commit -m "fix(api): let tenant admins read all documents in their tenant"
```

---

### Task 2: Listagem de aprovações sem fuga

**Files:**
- Modify: `apps/api/src/services/access-decision.service.ts`
- Modify: `apps/api/src/__tests__/access-decision.test.ts`
- Modify: `apps/api/src/modules/approvals.module.ts:25-43,66-73`

**Interfaces:**
- Consumes: `isTenantAdmin` da Task 1.
- Produces: `export function canSeeApproval(roleNames: string[], userId: string, approval: { requesterId: string | null; supervisorId: string | null }): boolean` — `true` para admin, supervisor responsável ou próprio requerente.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `access-decision.test.ts`:

```ts
describe("canSeeApproval", () => {
  test("member vê só as próprias aprovações", () => {
    expect(canSeeApproval(["MEMBER"], "u1", { requesterId: "u1", supervisorId: "s1" })).toBe(true);
    expect(canSeeApproval(["MEMBER"], "u1", { requesterId: "u2", supervisorId: "s1" })).toBe(false);
  });
  test("supervisor vê as que supervisiona e as suas", () => {
    expect(canSeeApproval(["SECTOR_SUPERVISOR"], "u1", { requesterId: "u2", supervisorId: "u1" })).toBe(true);
    expect(canSeeApproval(["SECTOR_SUPERVISOR"], "u1", { requesterId: "u2", supervisorId: "s2" })).toBe(false);
  });
  test("admin vê todas", () => {
    expect(canSeeApproval(["ORG_ADMIN"], "u1", { requesterId: "u2", supervisorId: "s2" })).toBe(true);
  });
});
```

- [ ] **Step 2: Confirmar que falha**

Run: `cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/access-decision.test.ts`
Expected: FAIL com "canSeeApproval is not a function".

- [ ] **Step 3: Implementar `canSeeApproval`**

`true` se `isTenantAdmin(roleNames)`, ou `approval.requesterId === userId`, ou (`roleNames.includes("SECTOR_SUPERVISOR")` e `approval.supervisorId === userId`).

- [ ] **Step 4: Ligar ao handler `GET /approvals`**

Em `approvals.module.ts:25-43`: manter `query.status` e `query.sectorId` na query; depois de `findMany`, aplicar `.filter(row => canSeeApproval(roleNames, auth!.userId, row))` antes de devolver `{ data: rows }`. Em `GET /approvals/:id`, substituir o bloco em `:66-73` por `canSeeApproval(roleNames, auth!.userId, approval)`.

- [ ] **Step 5: Confirmar que passa**

Run: `cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/access-decision.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/access-decision.service.ts apps/api/src/__tests__/access-decision.test.ts apps/api/src/modules/approvals.module.ts
git commit -m "fix(api): scope approval listings to admin, supervisor or requester"
```

---

### Task 3: Decisão segura e registada

**Files:**
- Modify: `apps/api/src/services/access-decision.service.ts`
- Modify: `apps/api/src/__tests__/access-decision.test.ts`
- Modify: `apps/api/src/modules/approvals.module.ts:12-20,82-207`

**Interfaces:**
- Consumes: `isTenantAdmin` e `canSeeApproval` das Tasks 1–2.
- Produces:
  - `export function canResolveApproval(roleNames: string[], userId: string, approval: { requesterId: string | null; supervisorId: string | null }): boolean` — substitui a função local em `approvals.module.ts`.
  - `export function approvalAuditEntry(input: { tenantId: string; userId: string; status: "approved" | "rejected"; documentId: string; approvalId: string; notes?: string; ip: string }): { tenantId: string; userId: string; action: string; resource: string; resourceId: string; metadata: string; ip: string }`

- [ ] **Step 1: Escrever os testes que falham**

```ts
describe("canResolveApproval", () => {
  test("ninguém resolve o próprio pedido, nem o admin", () => {
    const own = { requesterId: "u1", supervisorId: "s1" };
    expect(canResolveApproval(["ORG_ADMIN"], "u1", own)).toBe(false);
    expect(canResolveApproval(["SECTOR_SUPERVISOR"], "u1", own)).toBe(false);
  });
  test("supervisor responsável resolve; supervisor alheio não", () => {
    expect(canResolveApproval(["SECTOR_SUPERVISOR"], "u1", { requesterId: "u2", supervisorId: "u1" })).toBe(true);
    expect(canResolveApproval(["SECTOR_SUPERVISOR"], "u1", { requesterId: "u2", supervisorId: "s2" })).toBe(false);
  });
});

describe("approvalAuditEntry", () => {
  test("regista quem decidiu e o que foi decidido", () => {
    const base = { tenantId: "t1", userId: "u1", documentId: "d1", approvalId: "a1", ip: "127.0.0.1" };
    expect(approvalAuditEntry({ ...base, status: "approved" }).action).toBe("APPROVAL_APPROVED");
    const denied = approvalAuditEntry({ ...base, status: "rejected", notes: "motivo" });
    expect(denied.action).toBe("APPROVAL_REJECTED");
    expect(denied.resource).toBe("approvals");
    expect(denied.resourceId).toBe("a1");
    expect(JSON.parse(denied.metadata).notes).toBe("motivo");
  });
});
```

- [ ] **Step 2: Confirmar que falha**

Run: `cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/access-decision.test.ts`
Expected: FAIL com "canResolveApproval is not a function".

- [ ] **Step 3: Implementar as duas funções**

`canResolveApproval`: `false` se `approval.requesterId === userId`; depois, admin → `true`; supervisor → `roleNames.includes("SECTOR_SUPERVISOR") && approval.supervisorId === userId`; resto `false`.
`approvalAuditEntry`: `action = status === "approved" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED"`, `resource = "approvals"`, `resourceId = approvalId`, `metadata = JSON.stringify({ documentId, type: "access_request", notes })` (omitir `notes` quando ausente), `ip` copies from input.

- [ ] **Step 4: Ligar ao handler `PATCH /approvals/:id`**

- Apagar a função local `canResolveApproval` em `approvals.module.ts:12-20` e importar a do serviço.
- Dentro de `withTenant`, obter `roleNames = await getFreshRoles(auth!.userId, auth!.tenantId, tx)` (terceiro argumento obrigatório) e chamar `canResolveApproval(roleNames, auth!.userId, existing)`.
- Depois da atualização em `:106-110`, inserir `tx.insert(auditLogs).values(approvalAuditEntry({...}))` com `clientIp` (adicionar `clientIp` ao destructure do handler).
- Manter `withIdempotency`, notificações e criação de `documentShares` inalteradas neste passo.

- [ ] **Step 5: Confirmar que passa**

Run: `cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/access-decision.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/access-decision.service.ts apps/api/src/__tests__/access-decision.test.ts apps/api/src/modules/approvals.module.ts
git commit -m "fix(api): block self-approval and audit approval decisions"
```

---

### Task 4: Um pedido, uma decisão, nos dois ecrãs

**Files:**
- Modify: `apps/api/src/services/access-decision.service.ts`
- Modify: `apps/api/src/__tests__/access-decision.test.ts`
- Modify: `apps/api/src/modules/approvals.module.ts:115-155`
- Modify: `apps/api/src/modules/documents.module.ts:693-788`

**Interfaces:**
- Consumes: funções das Tasks 1–3.
- Produces:
  - `export function counterpartStatuses(status: "approved" | "denied"): { accessRequestStatus: "approved" | "denied"; approvalStatus: "approved" | "rejected" }`
  - `export async function syncCounterpart(tx: DB, input: { documentId: string; requesterId: string; status: "approved" | "denied"; resolvedBy: string; resolvedAt: Date }): Promise<void>`
  - `export function shouldCreateShare(existingShare: { id: string } | null | undefined): boolean`

- [ ] **Step 1: Escrever os testes que falham**

```ts
describe("counterpartStatuses", () => {
  test("aprovado actualiza as duas tabelas", () => {
    expect(counterpartStatuses("approved")).toEqual({ accessRequestStatus: "approved", approvalStatus: "approved" });
  });
  test("rejeitado usa os estados de cada tabela", () => {
    expect(counterpartStatuses("denied")).toEqual({ accessRequestStatus: "denied", approvalStatus: "rejected" });
  });
});

describe("shouldCreateShare", () => {
  test("não cria partilha duplicada", () => {
    expect(shouldCreateShare(null)).toBe(true);
    expect(shouldCreateShare({ id: "share-1" })).toBe(false);
  });
});
```

- [ ] **Step 2: Confirmar que falha**

Run: `cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/access-decision.test.ts`
Expected: FAIL com "counterpartStatuses is not a function".

- [ ] **Step 3: Implementar as três funções**

- `counterpartStatuses`: mapear conforme os enums em `db/schema.ts:165-219` (`document_access_requests`: `approved|denied`; `approvals`: `approved|rejected`).
- `syncCounterpart`: usar `tx.update(documentAccessRequests).set({ status, resolvedBy, resolvedAt }).where(and(eq(documentAccessRequests.documentId, ...), eq(documentAccessRequests.requesterId, ...), eq(documentAccessRequests.status, "pending")))` e o equivalente em `approvals` com `eq(approvals.type, "access_request")`. `DB` importado apenas como tipo (`import type { DB } from "../db"`). Sem insert, sem migração.
- `shouldCreateShare`: `!existingShare`.

- [ ] **Step 4: Confirmar que passa**

Run: `cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/access-decision.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 5: Ligar `PATCH /approvals/:id`**

Dentro do ramo `approved`, antes de `tx.insert(documentShares)` (`:142-148`), procurar partilha ativa existente para `existing.requesterId` no mesmo documento (`status: "active"`, `revokedAt IS NULL`) e só inserir se `shouldCreateShare(existingShare)`. Depois das notificações, chamar `await syncCounterpart(tx, { documentId: approval.documentId, requesterId: existing.requesterId!, status: "approved", resolvedBy: auth!.userId, resolvedAt: now })` quando `existing.type === "access_request"`. No ramo `rejected`, chamar `syncCounterpart` com `status: "denied"`.

- [ ] **Step 6: Ligar `PATCH /documents/:param/access-requests/:requestId`**

Substituir o bloco de autorização em `:715-719` por:
```ts
const roleNames = await getFreshRoles(auth!.userId, tenantId, tx);
const isSupervisor = idRow.sector?.supervisorId === auth!.userId;
if (req.requesterId === auth!.userId || (!isTenantAdmin(roleNames) && !(roleNames.includes("SECTOR_SUPERVISOR") && isSupervisor))) {
  set.status = 403;
  return { error: { code: "FORBIDDEN", message: "Apenas o supervisor do sector ou o admin podem resolver este pedido." } };
}
```
Adicionar `getFreshRoles` e `isTenantAdmin` aos imports. Antes do `tx.insert(documentShares)` em `:727`, aplicar a mesma verificação `shouldCreateShare`. Depois de gravar a decisão, chamar `syncCounterpart` com `status: "approved" | "denied"`, `documentId: idRow.document.id`, `requesterId: req.requesterId`, `resolvedBy: auth!.userId`, `resolvedAt: now`. Manter os inserts em `audit_logs` e as notificações existentes.

- [ ] **Step 7: Verificação completa**

Run:
```bash
cd apps/api && JWT_SECRET=test-only-secret bun test src/__tests__/access-decision.test.ts src/__tests__/attachment-admin.test.ts src/__tests__/document-tags.test.ts
```
Expected: PASS (13 testes).
Se `bun run typecheck` existir, correr; caso contrário registar.
Revisar o diff com `git diff --check` — nenhum segredo, nenhum dado de tenant real.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/access-decision.service.ts apps/api/src/__tests__/access-decision.test.ts apps/api/src/modules/approvals.module.ts apps/api/src/modules/documents.module.ts
git commit -m "fix(api): keep access requests in sync across both decision screens"
```

---

## Fim

- Atualizar `docs/superpowers/specs/2026-11-21-authorization-fixes-design.md` com o estado final e o risco deixado em aberto (pedido órfão quando o requerente é o único supervisor/admin).
- Relatório final em português com: ficheiros alterados (file:linha), comandos e outputs, decisões tomadas, pendências e riscos.
