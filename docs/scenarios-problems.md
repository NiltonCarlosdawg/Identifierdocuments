# Cenários de Teste e Problemas Encontrados — DocID v2

> Fases 1–4: auth, identificadores, documentos, partilha, aprovações, notificações, visibility

---

## 10 Cenários de Teste

### 1. Health Check + Criação de Organização + Login

- **Ficheiro:** `phase3-4.integration.test.ts:74-103`
- **Testes:**
  - `GET /` retorna `{ status: "online" }`
  - `POST /tenants` cria organização → `POST /auth/login` retorna JWT com role `ORG_ADMIN`
- **Problemas associados:** Rate limiter pode bloquear o login se houver muitos requests (ver Problema #1)

### 2. Fluxo Completo de Documento

- **Ficheiro:** `phase3-4.integration.test.ts:105-270`
- **Testes:**
  - Setup: criar sectores (A e B), criar supervisor no sector B, atribuir role `SECTOR_SUPERVISOR`
  - `POST /identifiers/generate` — gerar identificador com formato `{PREFIX}-{CATEGORY}-{ANO}-{MESDIA}-{SEQ}`
  - `POST /documents/attach` — associar ficheiro (verifica que o identificador está no texto extraído)
  - `POST /documents/attach` com `uploadSource: "sync"` — confirma que `uploadSource` é preservado
- **Problemas associados:** —

### 3. Partilha Cross-Sector Cria Aprovação Pendente

- **Ficheiro:** `phase3-4.integration.test.ts:229-244`
- **Testes:**
  - `POST /documents/:identifier/share` com `sectorId` de sector diferente → approval pendente criada
  - Supervisor do sector destino vê a approval pendente via `GET /approvals?status=pending`
- **Problemas associados:** —

### 4. Partilha sem Destino Retorna 422

- **Ficheiro:** `phase3-4.integration.test.ts:246-253`
- **Testes:**
  - `POST /documents/:identifier/share` com body vazio `{}` → `422`
- **Problemas associados:** —

### 5. ORG_ADMIN Pode Aprovar Qualquer Aprovação

- **Ficheiro:** `phase3-4.integration.test.ts:255-263`
- **Testes:**
  - `PATCH /approvals/:id` com `status: "approved"` por ORG_ADMIN → `200`
- **Problemas associados:** Ordem de verificação em `canAccessDocument` (ver Problema #2)

### 6. Notificações: Listar, Marcar Lida e SSE Stream

- **Ficheiro:** `phase3-4.integration.test.ts:272-313`
- **Testes:**
  - `GET /notifications` — retorna array de notificações
  - `PATCH /notifications/:id/read` — marca como lida (`isRead: true`)
  - `GET /notifications/stream?access_token=...` — SSE stream responde com `text/event-stream` e mensagem `connected`
- **Problemas associados:** —

### 7. Visibility: `public` vs `sector_only` na Listagem de Identificadores

- **Ficheiro:** `phase3-4.integration.test.ts:315-409`
- **Testes:**
  - Setup: criar sectores, supervisor no sector B
  - `public` identifier (categoria MEM) → `visibility: "public"`
  - `sector_only` identifier (categoria CPS) → `visibility: "sector_only"`
  - Admin vê `sector_only` na lista com `restricted: true`
  - Admin vê `public` na lista com `restricted: false`
  - Supervisor (sector B) vê o seu próprio `sector_only` com `restricted: false`
  - Supervisor vê `public` identifier normalmente
- **Problemas associados:** Ordem de verificação em `canAccessDocument` (ver Problema #2)

### 8. Download: Admin Bloqueado em `sector_only`, `public` OK

- **Ficheiro:** `phase3-4.integration.test.ts:417-431`
- **Testes:**
  - `GET /documents/:sector_only/download` por admin → `403` com `{ error: { code: "ACCESS_REQUIRED" } }`
  - `GET /documents/:public/download` por admin → `200`
- **Problemas associados:** Ordem de verificação em `canAccessDocument` (ver Problema #2)

### 9. Request-Access Flow: Criar, Duplicado, Aprovar, Download

- **Ficheiro:** `phase3-4.integration.test.ts:439-476`
- **Testes:**
  - `POST /documents/:sector_only/request-access` por admin → `200` com `type: "access_request"`, `status: "pending"`
  - `POST /documents/:sector_only/request-access` duplicado → `409` com `{ error: { code: "ALREADY_REQUESTED" } }`
  - Supervisor aprova `access_request` → `200`
  - Admin descarrega o documento → `200` (share foi criado automaticamente)
- **Problemas associados:** Ordem de verificação em `canAccessDocument` (ver Problema #2)

### 10. Sectores e RBAC: Listagem e Guard de Autenticação

- **Ficheiro:** `phase3-4.integration.test.ts:479-500`
- **Testes:**
  - `GET /sectors` com token → `200`, lista com ≥2 sectores
  - `GET /approvals` sem token → `401`
- **Problemas associados:** —

---

## 6 Problemas Encontrados

### Problema #1 — Rate Limiter Bloqueia Testes com Múltiplos Logins

| Campo | Detalhe |
|---|---|
| **Localização** | `apps/api/src/middleware/rateLimit.ts` |
| **Sintoma** | Testes que fazem >5 logins em 1 minuto falham com `429 Too Many Requests` |
| **Causa** | Rate limiter in-memory, chaveado por IP, default 5 tentativas/min |
| **Solução** | Iniciar servidor de testes com `RATE_LIMIT_MAX=100` |
| **Teste afectado** | Cenários 1, 2, 7, 9 (múltiplos logins: admin + supervisor + member) |

### Problema #2 — Ordem Incorrecta em `canAccessDocument`

| Campo | Detalhe |
|---|---|
| **Localização** | `apps/api/src/services/attachment.service.ts` — função `canAccessDocument` |
| **Sintoma** | ORG_ADMIN nunca conseguia descarregar `sector_only` mesmo depois de request-access aprovado |
| **Causa** | A verificação de ORG_ADMIN (`restricted: true`) era feita **antes** de verificar partilhas existentes |
| **Solução** | Inverter a ordem: primeiro verificar `sharedWithUserId`/`sharedWithSectorId`, depois verificar ORG_ADMIN para restricted |
| **Teste afectado** | Cenários 5, 7, 8, 9 |

### Problema #3 — `onConflictDoNothing` Não Actualiza Linhas Existentes

| Campo | Detalhe |
|---|---|
| **Localização** | `apps/api/src/db/seed.ts` — inserção de categorias |
| **Sintoma** | Após adicionar campo `defaultVisibility` às categorias, o seed não actualizava as categorias já existentes |
| **Causa** | `onConflictDoNothing` ignora completamente conflitos — não faz UPDATE |
| **Solução** | Substituir por `onConflictDoUpdate` com `set` para actualizar os campos alterados |
| **Teste afectado** | Cenário 7 (categorias com `defaultVisibility` incorrecto) |

### Problema #4 — Falsos Erros de LSP (Type Inference)

| Campo | Detalhe |
|---|---|
| **Localização** | Vários ficheiros em `apps/api/src/modules/*.ts` |
| **Sintoma** | `Property 'auth' does not exist on type`, `IndexBuilder[] is not assignable to PgTableExtraConfig` |
| **Causa** | Limitação de type inference do Elysia + Drizzle; o código compila e corre sem erros |
| **Solução** | Ignorar (não afecta runtime) |
| **Teste afectado** | Nenhum |

### Problema #5 — Rust: Missing `process` Feature no Tokio

| Campo | Detalhe |
|---|---|
| **Localização** | `apps/desktop/src-tauri/Cargo.toml` |
| **Sintoma** | Erro de compilação: `Command` não encontrado em `tokio::process` |
| **Causa** | Tokio requer feature flag `"process"` para `tokio::process::Command` |
| **Solução** | Adicionar `"process"` à lista de features do tokio em `Cargo.toml` |
| **Teste afectado** | Nenhum (compilação Rust) |

### Problema #6 — Rust: Lifetime Issue no File Watcher

| Campo | Detalhe |
|---|---|
| **Localização** | `apps/desktop/src-tauri/src/commands/watcher.rs` |
| **Sintoma** | Erro de compilação: lifetime mismatch ao tentar usar `app.state()` dentro de uma `spawn` |
| **Causa** | O lock do `app.state()` mantinha uma referência que não podia ultrapassar o escopo da closure da spawn |
| **Solução** | Escopar o lock (ler o necessário antes da spawn) e obter state via `app_clone.state()` dentro da spawn |
| **Teste afectado** | Nenhum (compilação Rust) |
