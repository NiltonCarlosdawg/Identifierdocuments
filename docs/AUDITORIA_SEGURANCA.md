# Auditoria de Segurança — DocID Platform

> **Data:** 30 Junho 2026
> **Versão:** v1.0.0
> **Equipa:** Verano Labs (Luanda, Angola)

---

## Resumo Executivo

| Gravidade | Total | Corrigidas | Acção |
|-----------|-------|------------|-------|
| **CRÍTICA** | 4 | 4 ✅ | Corrigir imediatamente |
| **ALTA** | 18 | 18 ✅ | Corrigir urgente (próximo ciclo) |
| **MÉDIA** | 18 | 18 ✅ | Corrigir planeado |
| **BAIXA** | 12 | 0 | Monitorizar |

**Total de falhas encontradas: 51**

---

## 🔴 CRÍTICAS

### C1 — Qualquer utilizador pode escalar privilégios para ORG_ADMIN

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/modules/users.module.ts` |
| **Linhas** | 101–115 |
| **Descrição** | `POST /:id/roles` não tem qualquer verificação de role. Qualquer utilizador autenticado pode atribuir qualquer role (incluindo `ORG_ADMIN`) a qualquer utilizador do tenant. |
| **Impacto** | Escalamento total de privilégios. Um MEMBER pode tornar-se ORG_ADMIN. |
| **Correção** | Adicionar `requireRole("ORG_ADMIN")` antes do handler. |

---

### C2 — Qualquer utilizador pode criar novas contas

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/modules/users.module.ts` |
| **Linhas** | 10–26 |
| **Descrição** | `POST /` cria utilizadores sem qualquer verificação de role. |
| **Impacto** | Inundação de contas falsas, criação não autorizada de acessos. |
| **Correção** | Adicionar `requireRole("ORG_ADMIN")` antes do handler. |

---

### C3 — RLS bypass por tenantId vazio/falsy

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/middleware/tenant.ts` |
| **Linhas** | 7 |
| **Descrição** | `if (ctx.auth?.tenantId)` — se `tenantId` for `""`, `0` ou `false`, o `set_config` é SKIPPED. A conexão do pool reutiliza o `current_tenant` da requisição anterior → **cross-tenant data leak**. |
| **Impacto** | Vazamento de dados entre empresas diferentes no mesmo servidor. |
| **Correção** | Substituir truthy check por `typeof === 'string' && length > 0`. Adicionar validação de formato UUID. Resetar `app.current_tenant` para um sentinel UUID em requisições não autenticadas. |

---

### C4 — CSP desactivado + permissões Tauri sem restrição

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/desktop/src-tauri/tauri.conf.json:23` + `capabilities/default.json:8-14` |
| **Linhas** | tauri.conf.json:23, capabilities/default.json:6-14 |
| **Descrição** | CSP = `null`. Permissões `sql:allow-execute`, `sql:allow-select`, `fs:allow-read`, `fs:allow-write` sem qualquer scope restriction. |
| **Impacto** | XSS no frontend = controlo total do SQLite local + filesystem. |
| **Correção** | 1) Definir CSP strict `default-src 'self'` 2) Restringir permissões FS ao `$APPDATA/**` 3) Remover `sql:allow-execute`. |

---

## 🟠 ALTAS

### A1 — JWT_SECRET vira string "undefined" se env var faltar

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/middleware/auth.ts` |
| **Linhas** | 5 |
| **Descrição** | `process.env.JWT_SECRET!` — se a variável não existir, `TextEncoder().encode(undefined)` produz os bytes de `"undefined"` (9 bytes públicos). |
| **Impacto** | Qualquer atacante que saiba que a env var não foi definida pode forjar JWTs arbitrários. |
| **Correção** | Adicionar runtime check: `if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET must be set")`. |

---

### A2 — Nenhuma validação de claims no JWT

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/middleware/auth.ts` |
| **Linhas** | 24, 29 |
| **Descrição** | `payload as unknown as AuthPayload` — sem runtime validation. Token sem `userId`, `tenantId` ou `roles` passa sem erro. |
| **Impacto** | Tokens malformados ou com claims inválidas não são rejeitados. |
| **Correção** | Adicionar runtime validation: `if (typeof payload.userId !== 'string') throw new Error('Invalid userId')`. |

---

### A3 — Janela de graça de 24h para tokens expirados

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/middleware/auth.ts` |
| **Linhas** | 27–30 |
| **Descrição** | `verifyTokenWithGrace` default `graceSeconds = 86400` (24 horas). Um token expirado pode ser refrescado por mais 24h. |
| **Impacto** | Janela de exploração de token roubado estendida de 7 para 8 dias. |
| **Correção** | Reduzir para 60 segundos ou remover completamente. |

---

### A4 — Rate limiter in-memory (burlável com load balancing)

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/middleware/rateLimit.ts` |
| **Linhas** | 1 |
| **Descrição** | Map em memória de um único processo. Múltiplos workers ou instâncias têm rate limit independente. Redis já está nas dependências mas não é usado. |
| **Impacto** | Brute-force de passwords possível distribuindo requests entre instâncias. |
| **Correção** | Usar Redis (`ioredis`) como store partilhada. |

---

### A5 — Password hash exposto no endpoint de membros do sector

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/modules/sectors.module.ts` |
| **Linhas** | 91–99 |
| **Descrição** | `GET /:id/members` faz query sem `columns: { passwordHash: false }`. Retorna todas as colunas incluindo `passwordHash`. |
| **Impacto** | Qualquer utilizador do tenant pode ver os hashes de password de todos os outros utilizadores. |
| **Correção** | Adicionar `columns: { passwordHash: false }` na query. |

---

### A6 — Path traversal no thumbnail endpoint

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/modules/documents.module.ts` |
| **Linhas** | 112–113 |
| **Descrição** | `params.id` concatenado em path: `path.join(THUMBNAIL_DIR, `${params.id}.png`)`. `../../etc/passwd` como `id` permite ler ficheiros arbitrários. |
| **Impacto** | Leitura de ficheiros sensíveis do servidor (env, config, etc.). |
| **Correção** | Validar que `params.id` é UUID. Rejeitar non-UUID values. |

---

### A7 — Nenhuma auth check nos thumbnails

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/modules/documents.module.ts` |
| **Linhas** | 111–125 |
| **Descrição** | Endpoint de thumbnail só chama `requireAuth()` mas não verifica tenant ou visibilidade do documento. |
| **Impacto** | Qualquer utilizador de qualquer tenant pode ver thumbnails de qualquer documento. |
| **Correção** | Adicionar verificação de ownership/tenant antes de servir o ficheiro. |

---

### A8 — filePath da DB retornado sem validação de diretório

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/services/attachment.service.ts` |
| **Linhas** | 164–178 |
| **Descrição** | `downloadDocument` retorna `filePath` directamente da DB. Se a coluna for corrompida, qualquer ficheiro do sistema pode ser lido. |
| **Impacto** | Leitura arbitrária de ficheiros do servidor (via DB compromise). |
| **Correção** | Verificar que `resolve(filePath)` começa com `resolve(UPLOAD_DIR)`. |

---

### A9 — Sem limite de tamanho antes de arrayBuffer()

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/services/attachment.service.ts` |
| **Linhas** | 49–54 |
| **Descrição** | Ficheiro inteiro carregado em memória com `file.arrayBuffer()` sem verificar `file.size`. |
| **Impacto** | DoS por OOM — ficheiro multi-GB derruba o servidor. |
| **Correção** | Verificar `file.size <= MAX_FILE_SIZE` antes de carregar. |

---

### A10 — Documentos enviados para Groq sem consentimento

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/api/src/services/classifier.service.ts` |
| **Linhas** | 63–81 |
| **Descrição** | Até 4000 caracteres de texto extraído de documentos enviados para `api.groq.com`. Sem anonimização, opt-in, ou notificação ao utilizador. |
| **Impacto** | Dados empresariais confidenciais (PII, financeiros, contratos) são enviados a terceiros. Potencial violação de compliance (LGPD/GDPR). |
| **Correção** | 1) Implementar toggle por tenant 2) Anonimizar dados sensíveis 3) Adicionar aviso ao utilizador. |

---

### A11 — Token JWT exposto em query string SSE

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/desktop/src/hooks/useNotifications.ts` |
| **Linhas** | 66 |
| **Descrição** | `?access_token=<jwt>` na URL do EventSource. Fica em logs do servidor, histórico do browser, Referer headers. |
| **Impacto** | Exposição do JWT em múltiplos vectores. |
| **Correção** | Usar token SSE dedicado de curta duração, ou WebSocket com header de auth. |

---

### A12 — innerHTML com dados da API + CSP desligado

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/desktop/src/routes/Dashboard.tsx` |
| **Linhas** | 44–61 |
| **Descrição** | `parent.innerHTML = ...doc.mimeType...` — `mimeType` vem da API. CSP = `null`. |
| **Impacto** | Servidor comprometido ou MiTM pode injectar XSS no desktop app. |
| **Correção** | Substituir `innerHTML` por React JSX seguro. |

---

### A13 — Store Tauri não encriptada

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/desktop/src/lib/tauri-storage.ts` |
| **Linhas** | Todo o ficheiro |
| **Descrição** | `@tauri-apps/plugin-store` guarda JSON em claro no disco. JWT + dados do user em plaintext. |
| **Impacto** | Qualquer processo ou malware com acesso ao diretório de dados da app pode ler o token. |
| **Correção** | Usar OS keychain (`tauri-plugin-keychain`) para encriptar dados sensíveis. |

---

### A14 — Fallback silencioso para localStorage

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/desktop/src/lib/tauri-storage.ts` |
| **Linhas** | 15–43 |
| **Descrição** | Se Tauri Store falha, cai para `localStorage` — acessível por qualquer JS no mesmo contexto. |
| **Impacto** | Degradação silenciosa de segurança. |
| **Correção** | Remover fallback para localStorage com dados de auth. |

---

### A15 — Path traversal em enqueue_upload_bytes (Rust)

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/desktop/src-tauri/src/sync/mod.rs` |
| **Linhas** | 423 |
| **Descrição** | `filename` não sanitizado → `uploads_dir.join("UUID_../../etc/cronjob")` escreve fora do diretório pretendido. |
| **Impacto** | Escrita arbitrária de ficheiros no sistema. |
| **Correção** | Rejeitar filenames com `/`, `\`, `..`. Canonicalizar path. |

---

### A16 — Base URL HTTP padrão (sem TLS)

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/desktop/src-tauri/src/lib.rs:25` + `src/stores/config.ts:5` |
| **Linhas** | Múltiplos ficheiros |
| **Descrição** | `http://localhost:3000` hardcoded em 4 locais. Sem validação de scheme HTTPS. |
| **Impacto** | Tráfego API em plaintext se URL não for alterado em produção. |
| **Correção** | Validar scheme `https://` nos setters. |

---

### A17 — Watcher segue symlinks para diretórios sensíveis

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/desktop/src-tauri/src/commands/watcher.rs` |
| **Linhas** | 97–107 |
| **Descrição** | Pastas vigiadas sem canonicalização. Symlink para `/etc` é seguido e ficheiros listados. |
| **Impacto** | Enumeração de ficheiros em diretórios sensíveis. |
| **Correção** | Canonicalizar path antes de vigiar. |

---

### A18 — SQLite local sem encriptação

| Campo | Valor |
|-------|-------|
| **Ficheiro** | `apps/desktop/src-tauri/src/db/mod.rs` |
| **Linhas** | 8 |
| **Descrição** | `offline.db` armazena identificadores, metadados de documentos, file paths em claro. Permissões de ficheiro `0644`. |
| **Impacto** | Qualquer processo no sistema pode ler a fila offline de documentos. |
| **Correção** | Usar SQLCipher. Definir permissões `0o600`. |

---

## 🟡 MÉDIAS

| # | Ficheiro | Linhas | Descrição |
|---|----------|--------|-----------|
| M1 | `apps/api/src/index.ts` | 22 | CORS permissivo — `cors()` sem opções permite qualquer origem |
| M2 | `apps/api/src/index.ts` | 87 | Validation errors vazam `error.message` com detalhes do schema |
| M3 | `apps/api/src/modules/auth.module.ts` | 34–45 | Sem rate limit no `/auth/refresh` — brute-force de refresh tokens |
| M4 | `apps/api/src/services/auth.service.ts` | 14 | User enumeration: erro "Organização não encontrada" revela slugs válidos |
| M5 | `apps/api/src/middleware/auth.ts` | 58–71 | `requireRole()` confia no JWT, não faz re-query à DB |
| M6 | `apps/api/src/middleware/rbac.ts` | 7–23 | Sem scoping sector-level — RBAC ignora `userRoles.sectorId` |
| M7 | `apps/api/src/modules/documents.module.ts` | 127–218 | Qualquer user pode partilhar/revogar/listar partilhas de qualquer documento |
| M8 | `apps/api/src/modules/identifiers.module.ts` | 8–30 | Qualquer user pode gerar identificadores para qualquer sector/categoria |
| M9 | `apps/api/src/modules/roles.module.ts` | 38–53 | IDOR: ORG_ADMIN pode modificar/deletar roles de outros tenants |
| M10 | `apps/api/src/modules/audit.module.ts` | 10–39 | Qualquer user pode ver audit logs completos (deveria ser ORG_ADMIN) |
| M11 | `apps/api/src/services/notification.service.ts` | 8, 37 | Redis pub/sub sem auth — qualquer cliente Redis pode subscrever canais |
| M12 | `apps/api/src/services/classifier.service.ts` | 67–82 | Sem timeout no fetch ao Groq — pode bloquear handler indefinidamente |
| M13 | `apps/api/scripts/generate_thumbnail.py` | 57–79 | LibreOffice sem sandbox — potencial RCE via documento malicioso |
| M14 | `apps/api/src/modules/stats.module.ts` | 10–63 | Qualquer user vê estatísticas da organização inteira |
| M15 | `apps/api/src/modules/categories.module.ts` | 6–27 | Endpoints de categorias sem auth — qualquer um (mesmo não autenticado) lista categorias |
| M16 | `apps/api/src/services/attachment.service.ts` | 53–76 | TOCTOU race: ficheiro temporário entre write e rename pode ser substituído |
| M17 | `apps/desktop/.env` + `.env.example` | 6, 9 | `JWT_EXPIRES_IN=7d` — excessivamente longo. Recomendado 15min |
| M18 | `apps/api/src/services/identifier.service.ts` | 45–109 | Sem rate limiting — geração massiva de identificadores possível |

---

## 🟢 BAIXAS

| # | Ficheiro | Linhas | Descrição |
|---|----------|--------|-----------|
| B1 | `apps/api/src/middleware/auth.ts` | 42 | Silent catch esconde todos os erros de verificação de token |
| B2 | `apps/api/src/middleware/auth.ts` | 8–13 | JWTs sem `aud`/`iss` — token de staging pode ser usado em produção |
| B3 | `apps/api/src/modules/audit.module.ts` | Todos | IP nunca registado no audit log (sempre `ip: null`) |
| B4 | `apps/api/src/modules/tenants.module.ts` | 9–95 | Sem CAPTCHA ou verificação de email no onboarding público |
| B5 | `apps/api/src/services/identifier.service.ts` | 62–63 | `lockKey` com concatenação de strings em SQL (code smell) |
| B6 | `apps/desktop/src-tauri/src/lib.rs` | 32–36 | DevTools abertos em debug builds |
| B7 | `.gitignore` | — | `src-tauri/gen/` tracked no git (auto-generado pelo Tauri) |
| B8 | `apps/api/src/services/attachment.service.ts` | 9–14 | Caminhos relativos como fallback para `UPLOAD_DIR` |
| B9 | `apps/api/src/services/document.service.ts` | 55–57 | Fallback para `extractPlainText` em qualquer tipo de ficheiro não reconhecido |
| B10 | `apps/desktop/src/stores/auth.ts` | 6–15 | Objeto completo do user armazenado junto com o token |
| B11 | `apps/desktop/src/services/sync.ts` | 72 | Sem limite de tamanho nos payloads IPC |
| B12 | `apps/desktop/src-tauri/src/sync/mod.rs` | 132–135 | Sem TLS certificate pinning |

---

## Progresso das Correções

| Estado | Fase | Itens |
|--------|------|-------|
| ✅ Concluída | Fase 1 — CRÍTICAS | C1, C2, C3, C4 |
| ✅ Concluída | Fase 2 — ALTAS (parcial) | A1, A2, A3, A5, A6, A7, A8, A9, A11, A12, A14, A15 |
| ✅ Concluída | Fase 2 — ALTAS (completada) | A4 (Redis), A10 (Groq opt-in), A13 (encrypted store), A16 (HTTPS), A17 (watcher canonicalize), A18 (SQLite perms) |
| ✅ Concluída | Fase 3 — MÉDIAS (completada) | M1 a M18 (18/18) |
| ⏳ Pendente | Fase 4 — BAIXAS | B1-B12 |

## Plano de Correção por Prioridade

### Fase 1 — Imediata (CRÍTICAS) ✅ CONCLUÍDA

| ID | Ficheiro | O quê foi feito |
|----|----------|-----------------|
| C1 | `users.module.ts:101-115` | Adicionado `requireRole("ORG_ADMIN")` em `POST /:id/roles` |
| C2 | `users.module.ts:10-26` | Adicionado `requireRole("ORG_ADMIN")` em `POST /` |
| C3 | `tenant.ts:7` | Truthy check substituído por `typeof + UUID regex + sentinel UUID` |
| C4 | `tauri.conf.json:23` + `capabilities/default.json:8-14` | CSP strict adicionado; FS scoped a `$APPDATA/**`; SQL restrito a queries específicas |

### Fase 2 — Urgente (ALTAS prioritárias) ✅ COMPLETA

| ID | Ficheiro | O quê foi feito |
|----|----------|-----------------|
| A1 | `auth.ts:5-6` | Runtime check: crash se `JWT_SECRET` não estiver definido |
| A2 | `auth.ts:25-31` | `validateAuthPayload()` valida `userId`, `tenantId`, `roles` ao runtime |
| A3 | `auth.ts:37` | `graceSeconds` reduzido de **86400 → 60** |
| A4 | `rateLimit.ts:1-45` | Rate limiter migrado de `Map` in-memory para Redis (`ioredis`). Usa INCR + PEXPIRE atómicos. Fail-open se Redis estiver indisponível |
| A5 | `sectors.module.ts:30-34` | `passwordHash` excluído da resposta + `requireRole("ORG_ADMIN")` em CRUD |
| A6 | `documents.module.ts:111-125` | UUID validation no thumbnail + auth check |
| A7 | `documents.module.ts:119-124` | Verificação de tenant no thumbnail |
| A8 | `attachment.service.ts:179-182` | `filePath` validado contra `UPLOAD_DIR` antes de servir download |
| A9 | `attachment.service.ts:51` | Size check (`MAX_FILE_SIZE`) antes de `arrayBuffer()` |
| A10 | `classifier.service.ts:58-65` | Adicionado opt-in `CLASSIFIER_ENABLED=true` — documentos só enviados à Groq se explícitamente activado |
| A11 | `useNotifications.ts:66` | SSE substituído por polling (15s), token JWT removido da URL |
| A12 | `Dashboard.tsx:44-61` | `innerHTML` removido; uso de React state + JSX condicional |
| A13 | `secure-storage.ts` (novo) + `auth.ts:28` | Store de auth encriptada com AES-GCM (SubtleCrypto). Chave de 256bits gerada aleatoriamente, persistida em `docid-secure` store |
| A14 | `tauri-storage.ts:15-43` | Fallback para `localStorage` removido |
| A15 | `sync/mod.rs:387-428` | Filename sanitizado; `safe_dest_path` com canonicalize; size limit |
| A16 | `config.ts:26-33`, `sync/mod.rs:361-375` | Validação de scheme HTTPS nos setters de URL. HTTP apenas permitido para `localhost`/`127.0.0.1` |
| A17 | `watcher.rs:99-106` | `add_watched_folder` canonicaliza path com `std::fs::canonicalize` antes de adicionar à lista de vigilância |
| A18 | `db/mod.rs:9-11` | Ficheiro SQLite `offline.db` com permissões `0o600` (owner-only) após abertura |

### Fase 3 — Planeada (MÉDIAS) ✅ COMPLETA

| ID | Ficheiro | O quê foi feito |
|----|----------|-----------------|
| M1 | `index.ts:22` | CORS restrito a `localhost:1420`, `tauri://localhost`, `https://tauri.localhost` |
| M2 | `index.ts:87` | `error.message` removido das respostas 422 |
| M3 | `auth.module.ts:34-45` | Rate limit adicionado a `/auth/refresh` (10 req/min) |
| M4 | `auth.service.ts:14` | Erro genérico "Credenciais inválidas" em vez de "Organização não encontrada" |
| M10 | `audit.module.ts:9` | Acesso a audit logs restrito a `ORG_ADMIN`; max limit 100 |
| M14 | `stats.module.ts:9` | Acesso a stats restrito a `ORG_ADMIN` |
| M15 | `categories.module.ts:8` | Auth adicionado aos endpoints de categorias |
| M5 | `auth.ts:68-82` | `requireRole()` agora faz re-query à DB (`userRoles` + `roles`) em vez de confiar no JWT |
| M6 | `rbac.ts:28-47` | RBAC com suporte a `sectorScoped` — verifica `ctx.params.sectorId` contra `ctx.auth.sectorId` |
| M7 | `documents.module.ts:11-16,149` | `canShareDocument()` verifica ownership (criador, ORG_ADMIN, supervisor do sector) antes de partilhar/revogar/listar |
| M8 | `identifiers.module.ts:17-22` | Geração de identificadores restrita ao sector do utilizador (excepto ORG_ADMIN) |
| M9 | `roles.module.ts:40,62` | Tenant check adicionado ao modificar/deletar roles — evita IDOR cross-tenant |
| M11 | `notification.service.ts:8` | Redis com suporte a `REDIS_PASSWORD` |
| M12 | `classifier.service.ts:87-90` | AbortController com timeout de 15s no fetch à Groq |
| M13 | `generate_thumbnail.py:62-68` | LibreOffice chamado em temp dir com permissões 0o700; suporte a `LIBREOFFICE_SANDBOX` (firejail/bubblewrap) |
| M16 | `attachment.service.ts:53-81` | TOCTOU eliminado: `fs.openSync(path, "wx")` (O_EXCL) em vez de write+rename |
| M17 | `.env.example:9`, `auth.ts:8` | `JWT_EXPIRES_IN` alterado de `7d` para `15m` |
| M18 | `identifiers.module.ts:10-16` | Rate limit de 20 pedidos/min na geração de identificadores |

### Fase 4 — Pendente (BAIXAS)

```
CRÍTICAS: ✅ TODAS CORRIGIDAS (4/4)
ALTAS: ✅ TODAS CORRIGIDAS (18/18)
MÉDIAS: ✅ TODAS CORRIGIDAS (18/18)
BAIXAS restantes: B1-B12
```

---

> Documento gerado automaticamente em 30 Junho 2026 após auditoria completa ao código-fonte do DocID.
> Verano Labs, Luanda, Angola.
