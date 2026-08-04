# BACKLOG.md — DocID Platform

> Backlog organizado por fases. Cada fase é um entregável funcional e independente.
> Critério de prioridade: P0 = bloqueante | P1 = essencial | P2 = importante | P3 = nice-to-have
>
> **Estado: Fases 1-4 completas e validadas E2E. Fase 5 maioritariamente completa
> (falta preview de PDF/multi-página no scanner, cache do classificador e a UI
> detalhada de 3-opções do watcher). Fase 6 — Geração Offline de Identificadores
> — completa (backend, motor de sync nativo, renovação de lease, UI e registo de
> dispositivos). Fase 7 — Cache Offline de Leitura — completa (leitura de
> listagens offline a partir de cache encriptada). Fase 8 — Seed Offline —
> completa (corrige a lacuna da geração offline: caches e leases agora são
> semeados). Fase 9 — Upload Offline Ligado à UI — completa (upload que falha
> por rede é enfileirado).**

---

## FASE 1 — Fundação (API Multi-tenant + Auth + RBAC)
> **Objectivo:** API funcional com isolamento por organização, autenticação, sectores e controlo de acesso.
> **Entregável:** Servidor pronto para receber o cliente Tauri.

*(sem alterações nesta ronda — ver secção **5.6** para correcções de segurança
aplicadas posteriormente a itens aqui marcados como completos)*

### 1.1 — Setup do Projecto
- [x] **P0** Inicializar monorepo (`docid/apps/api`, `docid/apps/desktop`, `docid/packages/types`)
- [x] **P0** Configurar `packages/types` com tipos partilhados (tenant, user, document, identifier)
- [x] **P0** Migrar base de dados de SQLite → PostgreSQL
- [x] **P0** Configurar Drizzle ORM com conexão PostgreSQL
- [x] **P0** Setup Redis (cache + BullMQ)
- [x] **P0** Configurar variáveis de ambiente (`.env` + validação com TypeBox)
- [x] **P1** Setup Swagger UI em `/docs` actualizado com novos endpoints

### 1.2 — Schema da Base de Dados
- [x] **P0** Tabela `organizations` (tenants)
- [x] **P0** Tabela `sectors`
- [x] **P0** Tabela `users`
- [x] **P0** Tabela `roles` (system + custom)
- [x] **P0** Tabela `role_permissions`
- [x] **P0** Tabela `user_roles`
- [x] **P0** Tabela `categories` (seed com 45 categorias)
- [x] **P0** Tabela `identifiers` (com campo `origin: digital | physical`)
- [x] **P0** Tabela `documents`
- [x] **P0** Tabela `document_shares`
- [x] **P0** Tabela `approvals`
- [x] **P0** Tabela `audit_logs`
- [x] **P0** Configurar Row Level Security (RLS) no PostgreSQL para todas as tabelas com `tenant_id` — **ver 5.6, mecanismo original tinha falha de isolamento sob concorrência, corrigido**
- [x] **P0** Criar índices: `tenant_id`, `sector_id`, `identifier`, `status`, `created_at`
- [x] **P1** Migration inicial com Drizzle Kit

### 1.3 — Middleware
- [x] **P0** Middleware de autenticação JWT (`auth.middleware.ts`)
- [x] **P0** Middleware de tenant (`tenant.middleware.ts`) — **reescrito em 5.6, ver detalhes**
- [x] **P0** Middleware de permissões (`rbac.middleware.ts`)

### 1.4 — Módulo Auth
- [x] **P0** `POST /auth/login`
- [x] **P0** `POST /auth/refresh`
- [x] **P0** `POST /auth/logout`
- [x] **P1** `GET /auth/me`
- [x] **P1** `PATCH /auth/me/password`
- [x] **P1** `PATCH /auth/me/notifications-preferences` *(novo — Fase 5.5)*
- [ ] **P2** `POST /auth/forgot-password`
- [ ] **P2** `POST /auth/reset-password`

### 1.5 — Módulo Organizações (Tenants)
- [x] **P0** `POST /tenants`
- [x] **P0** `GET /tenants/me`
- [x] **P1** `PATCH /tenants/me`
- [x] **P1** `PATCH /tenants/me/identifier-prefix`
- [ ] **P2** `GET /tenants/me/stats`

### 1.6 — Módulo Sectores
- [x] **P0** `POST /sectors`
- [x] **P0** `GET /sectors`
- [x] **P0** `GET /sectors/:id`
- [x] **P0** `PATCH /sectors/:id`
- [x] **P0** `PATCH /sectors/:id/supervisor`
- [x] **P1** `DELETE /sectors/:id` — **tratamento de erro de FK adicionado em 5.6**
- [x] **P1** `GET /sectors/:id/members`

### 1.7 — Módulo Utilizadores
- [x] **P0** `POST /users`
- [x] **P0** `GET /users`
- [x] **P0** `GET /users/:id`
- [x] **P0** `PATCH /users/:id`
- [x] **P0** `PATCH /users/:id/sector`
- [x] **P1** `DELETE /users/:id`
- [x] **P1** `POST /users/:id/roles`
- [x] **P1** `DELETE /users/:id/roles/:roleId`

### 1.8 — Módulo Roles & Permissões
- [x] **P0** Seed roles de sistema
- [x] **P0** `GET /roles`
- [x] **P1** `POST /roles`
- [x] **P1** `PATCH /roles/:id/permissions`
- [x] **P1** `DELETE /roles/:id`
- [ ] **P2** `GET /roles/:id/users`

### 1.9 — Migrar Módulos Existentes para Multi-tenant
- [x] **P0** Todos os itens desta secção — sem alteração

---

## FASE 2 — Desktop Base (App Tauri)
> **Objectivo:** Aplicação desktop funcional para as operações principais (online).

### 2.1 — Setup Tauri
- [x] **P0** Inicializar projecto Tauri v2, Vite + React + TypeScript
- [x] **P0** Configurar TailwindCSS — **`shadcn/ui` não foi adoptado; UI usa
  componentes Tailwind próprios (`docid-ui.tsx`)**
- [x] **P0** Configurar react-router-dom v6
- [x] **P0** Configurar Zustand
- [x] **P0** Configurar serviço HTTP — **consolidado numa única instância via
  `infrastructure/di/container.ts`, ver 5.6**
- [x] **P0** Configurar `tauri-plugin-sql` (SQLite local)
- [x] **P0** Configurar `tauri-plugin-fs`
- [x] **P1** Configurar `@tauri-apps/plugin-dialog` *(diálogo nativo de ficheiro/pasta, necessário para upload nativo e watcher)*
- [ ] **P1** Configurar `tauri-plugin-notification`
- [ ] **P1** Configurar `tauri-plugin-updater`

### 2.2 — Autenticação (UI)
- [x] **P0** Ecrã de login
- [x] **P0** Persistência de sessão — token via `tauri-plugin-store`,
  **encriptado com AES-GCM (`SecureStorageAdapter`)**
- [x] **P0** Refresh automático de JWT
- [x] **P0** Logout + limpeza de sessão
- [x] **P1** Hidratação do perfil via `GET /auth/me` no arranque *(antes só
  decodificava o JWT localmente — corrigido)*
- [ ] **P1** Ecrã de "Esqueci a password"

### 2.3 — Layout & Navegação
- [x] **P0** Layout principal + sidebar + header
- [x] **P0** Sidebar com navegação por módulos, incluindo Digitalizar
- [x] **P0** Header com utilizador, organização, notificações, logout
- [x] **P1** Badge de fila offline no header
- [x] **P1** Tema claro/escuro *(Settings → Aparência)*

### 2.4 — Dashboard
- [x] **P0** Cards de estatísticas
- [ ] **P1** Gráfico de actividade
- [ ] **P1** Lista de documentos recentes
- [ ] **P1** Lista de aprovações pendentes no dashboard
- [ ] **P2** Widget de fila offline no dashboard

### 2.5 — Módulo Identificadores (UI)
- [x] **P0** Todos os itens desta secção — implementados (`Identifiers.tsx`)
- [ ] **P1** Visualização do histórico de eventos do identificador

### 2.6 — Módulo Documentos (UI)
- [x] **P0** Listar, upload, detalhe, download — implementados (`Documents.tsx`)
- [x] **P1** Indicador de origem digital/físico
- [ ] **P2** Pré-visualização inline de PDFs

### 2.7 — Contratos & Candidaturas como Perfis (UI)
- [ ] Sem alteração — não abordado nesta ronda de trabalho.

### 2.8 — Gestão de Utilizadores & Sectores (UI)
- [x] **P1** Todos os itens principais — implementados (`Users.tsx`, `Sectors.tsx`)
- [ ] **P2** Página de perfil dedicada por utilizador (fora do próprio perfil)
- [ ] **P2** Transferir utilizador entre sectores — via UI de edição, sem fluxo dedicado

---

## FASE 3 — Offline Sync
> **Objectivo:** Utilizadores podem fazer upload de ficheiros sem conexão.

### 3.1 — Fila Local (Tauri / Rust)
- [x] **P0** Todos os itens desta secção
- [x] **P0** **Bug crítico corrigido**: `safe_dest_path` falhava sempre
  (`canonicalize()` chamado sobre um caminho ainda inexistente) — impedia
  todo o enfileiramento offline. Provado com teste antes/depois.

### 3.2 — Motor de Sync (Rust)
- [x] **P0** Todos os itens desta secção
- [x] **P1** Recuperação de itens presos em `uploading` após crash/encerramento
  inesperado (`reset_stuck_items`, corre no arranque do ciclo de sync)

### 3.3 — UI da Fila Offline
- [x] **P0/P1** Todos os itens, excepto notificação nativa (pendente)

### 3.4 — BullMQ Server-side
- [ ] Sem alteração — não abordado nesta ronda.

---

## FASE 4 — Workflows (Partilha + Aprovações)
> Sem alterações funcionais nesta ronda — ver **5.6** para correcções de
> segurança aplicadas aos módulos `approvals` e `documents` (partilha).

---

## FASE 5 — Nativo Avançado

### 5.1 — File System Watcher
- [x] **P0** `start_watcher` / `stop_watcher`
- [x] **P0** Detecção de ficheiros novos **e pré-existentes** — `notify` só
  reage a eventos futuros; foi adicionada uma varredura inicial
  (`walk_files`) no arranque do watcher para cobrir ficheiros já presentes
  na pasta.
- [x] **P0** Extracção de texto (Rust): **`pdf-extract`** para PDF, leitura
  directa para TXT/MD/CSV. `.docx` continua pendente (decisão entre
  `docx-rs` ou `quick-xml`, documentada no código).
- [x] **P0** Regex de detecção de identificador — formato final:
  `[A-Z]{1,6}-[A-Z]{2,5}-\d{4}-\d{4}-\d{3}` (o limite inferior do prefixo
  da organização foi corrigido de 2 para 1 carácter, para cobrir prefixos
  curtos permitidos pelo schema).
- [x] **P1** Deduplicação de notificações — `watcher_seen.json` (path + mtime,
  escrita atómica) evita reprocessar o mesmo ficheiro a cada arranque da app.
- [ ] **P0** UI com as 3 opções por ficheiro detectado (Adicionar agora /
  mais tarde / Não pertence) — **parcial**: os eventos backend já
  distinguem `identifier_found` de `file_detected`, e a aba "Pastas
  Vigiladas" mostra um contador; falta a lista detalhada de ficheiros
  detectados com as 3 acções específicas.
- [x] **P1** UI de configuração de pastas monitorizadas (`Settings` → "Pastas
  Vigiladas": listar, adicionar via diálogo nativo, remover, iniciar/parar,
  estado sincronizado com o backend via `is_watcher_running`)
- [ ] **P1** Lista de ficheiros "adicionados mais tarde" (lembretes)
- [ ] **P1** Relatório de detectados vs ignorados (além do contador simples)

### 5.2 — Integração Scanner
- [x] **P0** `list_scanners`, `scan_document`, opções de resolução/modo/formato
- [x] **P1** UI completa (`Scanner.tsx`): selecção de dispositivo, opções,
  digitalizar, download do resultado
- [x] **P1** Pré-visualização — **só para PNG**; PDF ainda sem preview
- [ ] **P1** Multi-página — adiado deliberadamente (depende de viabilidade
  de uma crate de renderização PDF→PNG cross-platform, ainda por confirmar)
- [ ] **P2** Integração com impressoras

### 5.3 — Classificação por IA
- [x] **P0** `POST /classifier/suggest`
- [x] **P0** Prompt de classificação
- [x] **P0** UI de sugestão com barra de confiança (`ClassifierSuggestion.tsx`)
- [x] **P0** Utilizador pode confirmar ou seleccionar categoria manualmente
- [ ] **P1** Melhorar prompt com exemplos few-shot
- [x] **P1** Registo de feedback (`POST /classifier/feedback`, tabela
  `classifier_feedback`, com validação de categoria e de posse do
  documento pelo tenant)
- [ ] **P2** Cache Redis de classificações — **adiado**; se implementado,
  a chave tem de incluir `tenantId` (`classifier:{tenantId}:hash:{sha256}`)
  para evitar partilha de cache entre organizações diferentes

### 5.4 — Onboarding de Organizações
- [x] **P1** Fluxo multi-passo implementado (`Onboarding.tsx`): dados da
  organização com slug/prefixo auto-gerados e editáveis, administrador,
  confirmação → `POST /tenants` → redirecciona para login com aviso de
  sucesso (sem auto-login, por decisão explícita)
- [x] **P1** Ecrã de configurações da organização (`Settings` → "Organização")
- [ ] **P2** Importar utilizadores via CSV
- [ ] **P2** Convite de membros por email (não fazia parte do fluxo simplificado)

### 5.5 — Configurações & Preferências (UI)
- [x] **P1** Perfil do utilizador (`Profile.tsx`)
- [x] **P1** Configurações da organização (nome, prefixo, slug/plano read-only)
- [x] **P1** Configuração de pastas monitoradas
- [ ] **P1** Configuração de scanner padrão (persistido) — a página Scanner
  permite escolher dispositivo por sessão, mas não guarda uma preferência
  por defeito
- [x] **P2** Configuração de notificações — 5 toggles (`PATCH
  /auth/me/notifications-preferences`)
- [x] **P2** Exportar dados da organização — auditoria (CSV, streaming) e
  estatísticas (JSON), ambos com rate limit de 5/hora

### 5.6 — Correcções de Segurança e Robustez (nova secção — hardening pós-auditoria)
> Itens da Fase 1 já estavam marcados como completos, mas uma auditoria de
> segurança revelou falhas reais de isolamento e integridade. Documentadas
> aqui por serem correcções a trabalho já entregue, não funcionalidade nova.

- [x] **P0** RLS reforçado: o mecanismo original (`set_config` fora de
  transacção) podia perder isolamento sob concorrência de pool de conexões;
  substituído por `withTenant()` — cada request corre dentro de uma
  transacção com `SET LOCAL app.current_tenant`, garantindo que o valor
  nunca escapa para outra conexão reaproveitada pelo pool.
- [x] **P0** Advisory lock de geração de identificadores não protegia o
  `INSERT` (só a leitura da sequência) — corrigido para cobrir leitura +
  inserção na mesma transacção.
- [x] **P0** Owner bypass em falta na visibilidade de identificadores —
  o criador de um identificador `sector_only` perdia acesso ao mudar de
  sector; corrigido, alinhado com o mesmo bypass já existente para documentos.
- [x] **P0** Roles verificadas a partir do JWT (potencialmente desactualizado)
  em vez da base de dados em `canResolveApproval`/`canShareDocument` —
  corrigido para usar `getFreshRoles()`, consistente com `requireRole()`.
- [x] **P1** Tratamento de erro uniforme (`safeError()` + padrão de
  re-throw/rollback seguro) aplicado a todos os handlers de escrita em
  `identifiers`, `documents`, `approvals`, `roles`, `sectors`, `users`,
  `classifier` — antes, alguns `try/catch` capturavam o erro *dentro* da
  transacção do `withTenant`, mascarando falhas e permitindo commit parcial.
- [x] **P1** `DELETE /sectors/:id` devolve erro claro em violação de FK em
  vez da mensagem crua do Postgres.
- [x] **P1** Suite de testes de segurança e carga (`apps/api/scripts/loadtest/`):
  fuzzing de concorrência entre tenants (600 requests), exaustão de pool,
  rollback de `SET LOCAL`, bypass de `tenantId` malformado, contenção do
  advisory lock — todos confirmados sem fuga de dados entre tenants.
- [x] **P2** Consolidação de `HttpApiClient`/adapters Tauri numa única
  instância via `infrastructure/di/container.ts`, eliminando instâncias
  soltas espalhadas por vários componentes.
- [x] **P2** Bun adoptado oficialmente como gestor de pacotes do desktop
  (`packageManager` no `package.json`), após incompatibilidade do `npm`
  com a versão de Node instalada.

---

## FASE 6 — Geração Offline de Identificadores *(nova fase, fora do plano original)*
> **Objectivo:** permitir gerar identificadores sem ligação à internet, sem
> risco de duplicados entre dispositivos, respeitando a exigência legal
> angolana de numeração sequencial e cronológica para documentos fiscais
> (Decreto Presidencial 292/18 e 71/25).
>
> **Descoberta importante:** nem todas as categorias têm exigência legal de
> sequência — só `FAT`, `REC`, `NOT`, `NDB` (confiança alta) e `GUE`, `ORD`
> (confiança média, por precaução) precisam do mecanismo pesado de reserva de
> lotes. As restantes ~36 categorias usam um caminho simplificado.
> **Pendente:** confirmação desta classificação por um contabilista/consultor
> fiscal angolano antes de produção real — isolada numa única coluna
> (`categories.requiresSequential`), corrigível sem alterar código.

### 6.1 — Schema (M0)
- [x] **P0** Coluna `categories.requiresSequential` (boolean, default false)
- [x] **P0** Coluna `organizations.identifierLeaseBatchSize` (default 50,
  configurável pelo ORG_ADMIN)
- [x] **P0** Tabela `devices` — identidade estável de cada instalação desktop
- [x] **P0** Tabela `identifier_leases` — lotes de sequência reservados por
  dispositivo (chave de alocação `tenantId + categoryId`, sem `sectorId`,
  consistente com `generateIdentifier` já existente)
- [x] **P0** Tabela `identifier_release_pool` — fragmentos devolvidos e
  disponíveis para reaproveitamento
- [x] **P0** Índice único parcial (`WHERE status = 'active'`) impedindo dois
  lotes activos simultâneos para o mesmo dispositivo+categoria
- [x] **P0** As 3 tabelas novas adicionadas a `TABLES_WITH_TENANT` (RLS)

### 6.2 — Lógica de alocação no backend (M1)
- [x] **P0** `next_free` para geração online passa a considerar lotes
  activos de outros dispositivos (`GREATEST(MAX(sequence), MAX(lease.endSeq))`)
  — sem isto, geração online podia colidir com um lote já reservado mas
  ainda não consumido offline
- [x] **P0** `POST /identifiers/lease` — reserva um lote, com first-fit no
  pool de fragmentos devolvidos antes de estender a sequência
- [x] **P0** `POST /identifiers/lease/:id/release` — devolve a sobra não
  usada ao pool
- [x] **P0** `PATCH /devices/:id/force-release` — acção administrativa
  irreversível para dispositivo perdido/nunca reconectado (`ORG_ADMIN` only)
- [x] **P0** `POST /identifiers/register-offline` — regista um identificador
  já gerado offline com o número exacto reservado no lote

### 6.3 — Caminho simplificado para categorias não-fiscais (M1.5)
- [x] **P1** `POST /identifiers/register-offline-loose` — sem lease nem lock
  partilhado prévio; reutiliza `generateIdentifier()` internamente (mesma
  protecção de concorrência já corrigida em 5.6); **um identificador por
  request, sem suporte a lote** (decisão deliberada, evita reintroduzir a
  classe de bug de "resolver categoria por item dentro de um lote")
- [x] **P1** Validação: rejeita se a categoria afinal tiver
  `requiresSequential = true`

### 6.4 — Testes do backend (M2)
- [x] **P0** Concorrência de `POST /identifiers/lease` sem sobreposição de
  intervalos
- [x] **P0** Geração online nunca atribui número dentro de um lote activo
- [x] **P0** Reaproveitamento correcto do pool após `release`
- [x] **P0** Rejeição de `register-offline` fora do intervalo do lote ou de
  lote alheio
- [x] **P0** `force-release` seguido de tentativa de registo é rejeitado

### 6.5 — Desktop nativo (M3)
- [x] **P0** Cache local (SQLite) de lotes activos, prefixo da organização e
  categorias — `cache_categories()`, `cache_tenant_state()`, schema
  `local_category_cache`, `local_identifier_lease`
- [x] **P0** Comando `generate_offline_identifier` — consome lote local
  (categorias fiscais via `local_identifier_lease`) ou contador local solto
  (restantes via `local_loose_counters`); insere em `local_pending_identifiers`
- [x] **P0** Motor de sincronização de identificadores pendentes — integrado no
  `run_sync_cycle_inner` existente:
  - Agrupamento de pendentes fiscais por `lease_id` (lote único) e não-fiscais
    item-a-item (`group_identifier_batches`)
  - `POST /identifiers/register-offline` para lotes fiscais,
    `POST /identifiers/register-offline-loose` para não-fiscais
  - Tratamento de resposta: `synced` (OK), `conflict`/`OUT_OF_ORDER` (fora de
    ordem), `LeaseInactive` → `mark_lease_remote_released_inner`, retry com
    `MAX_ATTEMPTS=3`
  - 16 testes unitários de agrupamento e transições de estado
- [x] **P1** Renovação automática de lote perto do esgotamento:
  - `renew_exhausted_leases()` verifica leases activos com 20% ou menos de
    capacidade restante (ou `next_to_use > end_seq`)
  - HTTP (`POST /identifiers/lease`) primeiro, só depois aplica troca atómica
    em transacção SQLite (`TransactionBehavior::Immediate`)
  - `apply_lease_renewal()` extraída como função síncrona testável (3 testes:
    sucesso, corrida perdida, idempotência sem duplicação)
- [x] **P2** UI de gestão de leases (dispositivos, forçar libertação) — Settings →
  "Dispositivos" com lista de leases, barra de uso, status chip, botão "Forçar
  libertação" com confirmação irreversível

### 6.6 — Frontend (M4)
- [x] **P0** `Identifiers.tsx` — caminho offline com indicação visual de
  número "definitivo" (fiscal, via lease) vs "provisório até sincronizar"
  (não-fiscal, via `register-offline-loose`) — badges verde/âmbar no
  GenerateModal
- [x] **P1** `Settings` → "Organização": configurar `identifierLeaseBatchSize`
  (10–500, default 50)
- [x] **P1** Gestão de dispositivos (listar, force-release com aviso de
  irreversibilidade) — separador "Dispositivos" em Settings

### 6.7 — UI de Pendentes (M4.5)
- [x] **P1** Separador "Pendentes" na página Identifiers com sub-tabs
  "Todos/Conflitos/Falhados"
- [x] **P1** Lista de pendentes com identificador, categoria, status, tentativas,
  última origem e data de criação
- [x] **P1** Detalhe visual de conflito (razão + mensagem) e de erro terminal
- [x] **P1** Acções "Re-sincronizar" (reset para pending) e "Remover" (delete
  local) para conflitos e falhados
- [x] **P1** Badge de contagem total no separador Pendentes

### 6.8 — Registo e Identificação de Dispositivos (M5)
- [x] **P1** Registo automático do dispositivo no arranque — comando Rust
  `get_or_register_device_id` (`identifiers.rs`) devolve identidade estável por
  instalação (`device_id` + `device_name`), consumido por `deviceStore.ts`
- [x] **P1** Schema `devices` actualizado (migração 0013): `registeredByUserId`,
  status `active`/`inactive`, `deactivatedAt`/`deactivatedBy`
- [x] **P1** `PATCH /devices/:id/deactivate` — desactiva um dispositivo (impede
  nova geração offline; leases activos mantêm-se); UI em Settings →
  "Dispositivos" com botão "Desactivar" restrito a `ORG_ADMIN`

---

## FASE 7 — Cache Offline de Leitura *(nova fase, fora do plano original)*
> **Objectivo:** resolver o P0 reportado — as páginas de listagem ficavam vazias
> ou com erro "Failed to fetch" quando a API estava inacessível. Com a sessão a
> sobreviver offline (JWT persistido + decode local, sem `/auth/me` bloqueante),
> a leitura passa a servir dados em cache encriptada quando não há ligação.

### 7.1 — Armazenamento seguro
- [x] **P0** `OfflineCache` (Tauri): AES-GCM com IV aleatório por escrita
  (`crypto.getRandomValues(12)`), store `docid-cache`, chave de sessão de 32
  bytes guardada em `docid-secure`
- [x] **P0** Entrada `{ version, cachedAt, ttlMs, data }`; versionamento
  `CACHE_VERSION = 1` por chave (`cache:v1:{tenant}:{user}:{endpoint}:{params}`)
- [x] **P0** TTL por endpoint (`CACHE_TTLS`, 1h–7d) + limite LRU de 50 chaves
- [x] **P0** Sem lock concorrente — last-write-wins documentado

### 7.2 — Hook e integração
- [x] **P0** `useOfflineCache`: fetcher + cache; em falha de rede serve a entrada
  em cache (`isStale` + `cachedAt`), senão mostra erro amigável; `enabled` para
  gating (ex.: vista "Pendentes")
- [x] **P0** `mapError`: converte "Failed to fetch"/NetworkError em mensagem PT
  ("Sem ligação à API…"), preservando mensagens do servidor e fallbacks
- [x] **P0** Integrado nas 8 páginas de leitura: Dashboard (`/stats`),
  Identifiers (`/identifiers`), Documents (`/documents`), Approvals (`/approvals`),
  Sectors (`/sectors`), Users (`/users`), Audit (`/audit`), Settings
  (`/tenants/me`, `/devices`, `/auth/me`)
- [x] **P1** `OfflineNotice` — aviso âmbar "a mostrar dados em cache de {data}"
  com botão "Tentar novamente" quando offline com cache
- [x] **P1** `mapError` aplicado a todos os catches de escrita (sectores,
  utilizadores, aprovações, configurações, cancelar identificador, anexar
  documento, perfil, login, onboarding)

### 7.3 — Ciclo de vida
- [x] **P1** Logout limpa a cache e a chave de encriptação
  (`authStore.logout` → `clearAll` + `clearKey`)
- [x] **P1** Arranque purga chaves de versões antigas (`purgeStaleVersions`)
- [x] **P2** Invalidação write-through: após escrita bem-sucedida a página faz
  refresh e sobrescreve a cache; TTL como fallback

### Fora de âmbito (trabalho futuro)
- [ ] **P2** Enfileiramento de escritas offline (fila de pedidos) — Opção C
- [ ] **P2** Upload offline via `attach_document_native` (Rust) — faz HTTP
  directo, sem fila
- [ ] **P2** Cache de endpoints auxiliares (categorias no GenerateModal, listas
  de sectores/utilizadores nos dropdowns de Users/Audit)

---

## FASE 8 — Seed Offline da Geração de Identificadores *(nova fase, fora do plano original)*
> **Objectivo:** corrigir a lacuna confirmada — a geração offline de
> identificadores **nunca funcionou em produção**: `cache_categories`,
> `cache_tenant_state` e `request_lease` estavam registados no Tauri mas nunca
> eram invocados, e o motor de sync só renovava leases existentes. Plano completo
> em `.opencode/plans/plano-offline-completo.md` (Fases 0–4).

### 8.1 — Seed no motor de sync
- [x] **P0** `seed_offline_caches` (Rust, `sync/mod.rs`): no ciclo de sync, quando
  online, faz `GET /categories` → upsert em `local_category_cache` e
  `GET /tenants/me` → upsert em `local_tenant_state` (org_prefix + batch size)
- [x] **P0** `seed_missing_leases` (Rust, `sync/mod.rs`): reserva leases iniciais
  para combinações (categoria, sector) já em uso (pendentes/contadores) sem lease
  activo, via `request_lease_inner`
- [x] **P0** `request_lease_inner` extraído do comando `request_lease`
  (reutilizável pelo sync e pelo novo comando)

### 8.2 — Frontend (belt & suspenders)
- [x] **P0** `Identifiers.tsx`: após carregar categorias online, invoca
  `cache_categories` (frescura sem depender do timing do sync)
- [x] **P0** `useGenerateIdentifier.ts`: no caminho online, invoca
  `ensure_offline_lease(categoryId, sectorId)` antes de gerar — garante lease
  para (categoria fiscal, sector) caso não exista
- [x] **P0** Comando Rust `ensure_offline_lease`: retorna `false` para categorias
  não-sequenciais, `true` se já existe lease activo, senão reserva um; tolerante
  a corridas (re-check após erro)

### Critério de aceitação
- App usada online alguns minutos → `generate_offline_identifier` gera
  identificadores fiscais e não-fiscais sem "Categoria não encontrada" nem
  "Sem lease activo". **Verificação manual pendente (runtime).**

---

## FASE 9 — Upload Offline Ligado à UI *(Fase 1 do plano offline)*
> **Objectivo:** quando um upload de documento falha por falta de rede na app
> desktop, enfileirar localmente (fila offline já existente) em vez de apenas
> mostrar erro. Infra de fila existia mas nenhuma página a usava.

### 9.1 — Detecção de erro de rede + enqueue
- [x] **P0** `isNetworkError` (`shared/errors/mapError.ts`): reconhece erros de
  rede do browser (`Failed to fetch`) e do Rust/reqwest (`error sending
  request`, `timed out`, `dns error`, `tls`, `connection`, etc.); `mapError`
  reutiliza-o
- [x] **P0** `enqueueFromPath` adicionado à porta `ISyncService` e às duas
  implementações (`TauriSyncAdapter`/`SyncService`) → comando `enqueue_upload`
  (copia o ficheiro para a fila local)
- [x] **P0** `Documents.tsx` (UploadModal): em erro de rede no
  `attach_document_native`, enfileira via `sync.enqueueFromPath(path,
  identifier, tenantId, userId)`; mostra "Guardado na fila offline — será
  enviado automaticamente quando houver ligação"; actualiza o badge da fila
- [x] **P0** Erros de negócio (validação/422/permissões) **não** são enfileirados
- [ ] **P1** Verificação manual em runtime: offline anexar enfileira; online
  envia automaticamente (flush no `run_sync_cycle`) e sai da fila

### Fora de âmbito (Fase 4 do plano — trabalho futuro)
- [ ] **P2** Fase 4: fila de escritas offline (idempotência, ordem, conflitos)


---

## FASE 11 — Download Offline de Documentos *(Fase 3 do plano offline)*
> **Objectivo:** permitir abrir/baixar documentos já sincronizados sem rede.
> Antes, `Documents.tsx` abria `window.open(fileUrl)` — falhava offline. Agora
> o ficheiro é descarregado e guardado em disco (cache local) e aberto com a
> app padrão do SO.

### 11.1 — Comandos Rust (cache local em disco)
- [x] **P0** `SyncState.downloads_dir` (`app_data/downloads`), populado no `lib.rs`
- [x] **P0** `download_document_offline(param, filename)`: devolve o caminho local se já
  em cache; senão descarrega de `GET /documents/{param}/download` (Bearer token) e
  guarda em `downloads/{param_sanitizado}/{ficheiro}`; erro claro se offline e não
  cacheado; limite de 50MB
- [x] **P0** `is_document_cached(param)`: verifica existência do ficheiro em cache
- [x] **P0** `open_local_file(path)`: abre com a app padrão do SO (`xdg-open`/`open`/`start`)
  — sem dependência nova (std::process)
- [x] **P0** Comandos registados em `lib.rs`

### 11.2 — Frontend
- [x] **P0** Porta `ISyncService` + `TauriSyncAdapter` + `SyncService`:
  `downloadOffline`, `openLocalFile`, `isDocumentCached`
- [x] **P0** `Documents.tsx`: botão de download (linha + detalhe) tenta cache local
  via `downloadOffline` + `openLocalFile`; em erro mostra banner "não disponível
  offline"; browser continua `window.open(fileUrl)`
- [x] **P0** `DetailModal`: indicador "Disponível offline" / "Não disponível offline"
  via `isDocumentCached`
- [ ] **P1** Verificação manual em runtime: abrir documento online → reabrir offline
  abre do disco; documento nunca visto mostra "Não disponível offline"
- [ ] **P1** Evicção da cache de downloads (limite de idade/tamanho total)

---

## FASE 10 — Cache de Endpoints Auxiliares *(Fase 2 do plano offline)*
> **Objectivo:** estender a cache offline de leitura (Fase 7) aos endpoints
> auxiliares que ainda a não usavam — `/categories`, `/sectors/:id/members` e
> os dropdowns de sectores/utilizadores. Offline, dropdowns e listagens
> auxiliares mostram dados em cache em vez de vazios.

### 10.1 — TTLs e infra de cache
- [x] **P0** `CACHE_TTLS` (`OfflineCache.ts`): novas entradas `/categories` (1h) e
  `/sectors/:id/members` (1h)
- [x] **P0** `ttlFor` com match dinâmico: padrões com `:id` (ex. `/sectors/:id/members`)
  casam com endpoints concretos (`/sectors/abc/members`)

### 10.2 — `/categories` via `useOfflineCache`
- [x] **P0** `Identifiers.tsx`: carga de categorias passa a `useOfflineCache` (mantém o
  invoke `cache_categories` no fetcher — belt & suspenders da Fase 8)
- [x] **P0** `ClassifierSuggestion.tsx`: dropdown manual de categorias com fallback de cache

### 10.3 — Dropdowns e listagens auxiliares
- [x] **P0** Novo hook `useCachedAux` (fetch + `offlineCache.set` no sucesso; fallback
  `offlineCache.get` em falha; contexto do `authStore`)
- [x] **P0** `Sectors.tsx`: `/sectors/:id/members` com cache (detalhe de membros + edição de sector)
- [x] **P0** `Users.tsx`: `/sectors` do filtro com cache
- [x] **P0** `Audit.tsx`: `/sectors` + `/users` dos maps de nomes com cache
- [x] **P0** `ShareDocumentModal.tsx`: `/sectors` + `/users` dos dropdowns com cache
- [ ] **P1** Verificação manual em runtime: offline dropdowns e membros mostram dados em cache

---

## Débito Técnico & Qualidade
- [x] **P1** Testes de integração para endpoints críticos
- [x] **P1** Testes do motor de sync offline — **feito**: `compute_upload_outcome`
  (função pura), `reset_stuck_items` (crash recovery), ciclo completo
  sucesso/falha até `MAX_ATTEMPTS`; sincronização de identificadores
  (agrupamento, state transitions, `lease_needs_renewal`, `apply_lease_renewal`,
  `fetch_active_leases`); 90 testes Rust no total
- [x] **P1** Rate limiting nos endpoints públicos — **estendido** aos novos
  endpoints de exportação (5/hora)
- [x] **P1** Rate limiting tolerante a falhas de Redis (v1.1.5) — quando o Redis
  está indisponível: `connect()` explícito + flag `redisUnavailable`; um único
  warn por processo em vez de stack trace por request
- [x] **P1** Robustez offline das listagens — em falha de rede as páginas mostram
  ecrãs vazios em vez de "Failed to fetch" (v1.1.5); depois substituído pela
  Fase 7 (leitura com dados em cache)
- [x] **P1** Sanitização de nomes de ficheiro no upload (path traversal) —
  também aplicado ao `attach_document_native` (Rust)
- [ ] **P1** Logs estruturados na API (pino ou similar)
- [x] **P1** Health check endpoint `GET /health`
- [x] **P2** Documentação OpenAPI actualizada
- [x] **P2** Script de seed para dados de demonstração
- [ ] **P2** Pipeline CI básica (lint + typecheck + testes)
- [ ] **P3** Testes E2E com Playwright

---

## Resumo por Fase

| Fase | Foco | Estado |
|---|---|---|
| **1** | API multi-tenant + Auth + RBAC | ✅ Completo (E2E validado; correcções de segurança em 5.6) |
| **2** | App Tauri (online) | ✅ Completo |
| **3** | Offline sync | ✅ Completo (incl. bug crítico de path corrigido, testes) |
| **4** | Partilha + Aprovações + SSE | ✅ Completo |
| **5** | Scanner + IA + File Watcher + Settings | 🔄 Quase completo — falta preview PDF/multi-página no scanner, cache do classificador, e a UI detalhada de 3-opções do watcher |
| **5.6** | Correcções de segurança (hardening) | ✅ Completo — RLS, advisory lock, roles frescas, tratamento de erro uniforme, suite de testes de carga |
| **6** | Geração offline de identificadores | ✅ Completo — backend (M0–M2), motor de sync nativo + testes (M3), UI (M4 + M4.5), registo de dispositivos (M5); classificação legal de categorias pendente de confirmação profissional |
| **7** | Cache offline de leitura | ✅ Completo — `OfflineCache` encriptado (AES-GCM), hook nas 8 páginas, `mapError`, limpeza no logout; resolve o P0 de ecrãs vazios offline |
| **8** | Seed offline da geração de identificadores | ✅ Completo — lacuna corrigida: caches (categorias/tenant) e leases semeados no ciclo de sync + `ensure_offline_lease`/`cache_categories` no frontend; verificação manual em runtime pendente |
| **9** | Upload offline ligado à UI | ✅ Completo — `isNetworkError`, `enqueueFromPath`, fallback de rede no `UploadModal` do Documents; verificação manual em runtime pendente |
| **10** | Cache de endpoints auxiliares | ✅ Completo — TTLs `/categories` + `/sectors/:id/members` (match dinâmico), `useCachedAux`, dropdowns/maps de sectores/utilizadores com fallback de cache; verificação manual em runtime pendente |
| **11** | Download offline de documentos | ✅ Completo — cache de ficheiros em disco (`downloads_dir`), `download_document_offline`/`is_document_cached`/`open_local_file`, abertura com app do SO, indicador de disponibilidade offline no detalhe; verificação manual em runtime pendente |

> Consultar `README.md` para visão geral do produto e arquitectura; este
> ficheiro é o documento vivo de estado por fase.
