# BACKLOG.md — DocID Platform

> Backlog organizado por fases. Cada fase é um entregável funcional e independente.
> Critério de prioridade: P0 = bloqueante | P1 = essencial | P2 = importante | P3 = nice-to-have
>
> **Estado: Fases 1-5 completas e validadas E2E (impressoras e convite por email
> incluídos). Preview PDF/multi-página no scanner, extracção `.docx` e cache Redis
> do classificador concluídos.
> Fase 6 — Geração Offline de Identificadores
> — completa (backend, motor de sync nativo, renovação de lease, UI e registo de
> dispositivos). Fase 7 — Cache Offline de Leitura — completa (leitura de
> listagens offline a partir de cache encriptada). Fase 8 — Seed Offline —
> completa (corrige a lacuna da geração offline: caches e leases agora são
> semeados). Fase 9 — Upload Offline Ligado à UI — completa (upload que falha
> por rede é enfileirado). Fase 10 — Cache de Endpoints Auxiliares — completa.
> Fase 11 — Download Offline de Documentos — completa. Fase 12 — Fila de
> Escritas Offline — completa. Ronda de "itens fáceis" do backlog concluída:
> `GET /tenants/me/stats`, `GET /roles/:id/users`, widgets do Dashboard (fila
> offline, aprovações pendentes, documentos recentes), prompt few-shot do
> classificador e evicção da cache de downloads (30 dias). **Fase 14 — Anexos
> múltiplos + versionamento** concluída (`document_versions`, kind/label,
> endpoints e UI de lote/detalhe).**

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
- [x] **P2** `POST /auth/forgot-password` *(Fase 14 — token 15min single-use, hash SHA-256, rate-limit 5/15min; SMTP via env; fallback log em dev)*
- [x] **P2** `POST /auth/reset-password` *(Fase 14 — validação minLength 6, transacção, safeError)*

### 1.5 — Módulo Organizações (Tenants)
- [x] **P0** `POST /tenants`
- [x] **P0** `GET /tenants/me`
- [x] **P1** `PATCH /tenants/me`
- [x] **P1** `PATCH /tenants/me/identifier-prefix`
- [x] **P2** `GET /tenants/me/stats` — reutiliza `collectStats` do módulo de stats (ORG_ADMIN)

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
- [x] **P2** `GET /roles/:id/users` — devolve utilizadores com o role (email, nome, sector, `grantedAt`)

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
- [x] **P1** Configurar `tauri-plugin-notification` — plugin registado (Rust +
  capability `notification:default`) e notificações nativas nos eventos do
  watcher e na conclusão da sincronização (`shared/helpers/notifications.ts`)
- [ ] **P1** Configurar `tauri-plugin-updater`

### 2.2 — Autenticação (UI)
- [x] **P0** Ecrã de login
- [x] **P0** Persistência de sessão — token via `tauri-plugin-store`,
  **encriptado com AES-GCM (`SecureStorageAdapter`)**
- [x] **P0** Refresh automático de JWT
- [x] **P0** Logout + limpeza de sessão
- [x] **P1** Hidratação do perfil via `GET /auth/me` no arranque *(antes só
  decodificava o JWT localmente — corrigido)*
- [x] **P1** Ecrã de "Esqueci a password" *(Fase 14 — fluxo 2 passos: pedir código → código + nova password; resposta uniforme)*

### 2.3 — Layout & Navegação
- [x] **P0** Layout principal + sidebar + header
- [x] **P0** Sidebar com navegação por módulos, incluindo Digitalizar
- [x] **P0** Header com utilizador, organização, notificações, logout
- [x] **P1** Badge de fila offline no header
- [x] **P1** Tema claro/escuro *(Settings → Aparência)*

### 2.4 — Dashboard
- [x] **P0** Cards de estatísticas
- [x] **P1** Gráfico de actividade — série temporal dos últimos 14 dias
  (identificadores + documentos/dia) devolvida por `/stats` e renderizada como
  bar-chart SVG no Dashboard sem dependência extra
- [x] **P1** Lista de documentos recentes — painel com os últimos 5 (`/documents?limit=5`)
- [x] **P1** Lista de aprovações pendentes no dashboard — painel com `/approvals?status=pending`
- [x] **P2** Widget de fila offline no dashboard — contador de pendentes + abre o painel da fila

### 2.5 — Módulo Identificadores (UI)
- [x] **P0** Todos os itens desta secção — implementados (`Identifiers.tsx`)
- [x] **P1** Visualização do histórico de eventos do identificador — filtro
  `resourceId` em `/audit` e timeline no modal de detalhe (geração, consulta,
  cancelamento, associação de documento)

### 2.6 — Módulo Documentos (UI)
- [x] **P0** Listar, upload, detalhe, download — implementados (`Documents.tsx`)
- [x] **P1** Indicador de origem digital/físico
- [ ] **P2** Pré-visualização inline de PDFs

### 2.7 — Contratos & Candidaturas como Perfis (UI)
- [ ] Sem alteração — não abordado nesta ronda de trabalho.

### 2.8 — Gestão de Utilizadores & Sectores (UI)
- [x] **P1** Todos os itens principais — implementados (`Users.tsx`, `Sectors.tsx`)
- [ ] **P2** Página de perfil dedicada por utilizador (fora do próprio perfil)
- [x] **P2** Transferir utilizador entre sectores — via UI de edição, sem fluxo dedicado

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
  directa para TXT/MD/CSV, **`zip` + `<w:t>`** para `.docx` (watcher e
  `extract_text_command`)
- [x] **P0** Regex de detecção de identificador — formato final:
  `[A-Z]{1,6}-[A-Z]{2,5}-\d{4}-\d{4}-\d{3}` (o limite inferior do prefixo
  da organização foi corrigido de 2 para 1 carácter, para cobrir prefixos
  curtos permitidos pelo schema).
- [x] **P1** Deduplicação de notificações — `watcher_seen.json` (path + mtime,
  escrita atómica) evita reprocessar o mesmo ficheiro a cada arranque da app.
- [x] **P0** UI com as 3 opções por ficheiro detectado (Adicionar agora /
  mais tarde / Não pertence) — lista persistida em `watcher_files`; com
  identificador anexa já (`attach_document_native` / fila offline); sem
  identificador abre Documentos com o ficheiro pré-seleccionado
- [x] **P1** UI de configuração de pastas monitorizadas (`Settings` → "Pastas
  Vigiladas": listar, adicionar via diálogo nativo, remover, iniciar/parar,
  estado sincronizado com o backend via `is_watcher_running`)
- [x] **P1** Lista de ficheiros "adicionados mais tarde" (lembretes) —
  persistidos no SQLite local; sobrevivem a reinícios; acções Adicionar agora / Dispensar
- [x] **P1** Relatório de detectados vs ignorados (contagens por status/kind
  no WatcherTab)

### 5.2 — Integração Scanner
- [x] **P0** `list_scanners`, `scan_document`, opções de resolução/modo/formato
- [x] **P1** UI completa (`Scanner.tsx`): selecção de dispositivo, opções,
  digitalizar, download do resultado
- [x] **P1** Pré-visualização — PNG via `<img>`; PDF via `<object>`/blob URL
  com fallback para download (WebKit/Linux pode não renderizar PDF inline)
- [x] **P1** Multi-página — cada digitalização acrescenta uma página; navegação,
  remover página, descarregar actual ou todas; mudar o formato limpa as páginas
- [x] **P2** Integração com impressoras — `list_printers`/`print_file`/`print_bytes`
  (CUPS `lp`/`lpstat` no Linux/macOS, Win32_Printer no Windows); impressora
  predefinida em Settings; imprimir a partir do Scanner e do detalhe de Documentos

### 5.3 — Classificação por IA
- [x] **P0** `POST /classifier/suggest`
- [x] **P0** Prompt de classificação
- [x] **P0** UI de sugestão com barra de confiança (`ClassifierSuggestion.tsx`)
- [x] **P0** Utilizador pode confirmar ou seleccionar categoria manualmente
- [x] **P1** Melhorar prompt com exemplos few-shot — 3 exemplos (factura, acta, contrato) no `SYSTEM_PROMPT`
- [x] **P1** Registo de feedback (`POST /classifier/feedback`, tabela
  `classifier_feedback`, com validação de categoria e de posse do
  documento pelo tenant)
- [x] **P2** Cache Redis de classificações — chave
  `classifier:{tenantId}:hash:{sha256}` (texto+filename, TTL 24h); falha de
  Redis não bloqueia o pedido; resultados `UNKNOWN` não são cacheados

### 5.4 — Onboarding de Organizações
- [x] **P1** Fluxo multi-passo implementado (`Onboarding.tsx`): dados da
  organização com slug/prefixo auto-gerados e editáveis, administrador,
  confirmação → `POST /tenants` → redirecciona para login com aviso de
  sucesso (sem auto-login, por decisão explícita)
- [x] **P1** Ecrã de configurações da organização (`Settings` → "Organização")
- [x] **P2** Importar utilizadores via CSV *(Fase 14 — `POST /users/import` ORG_ADMIN, colunas email/full_name/sector/role, password gerada devolvida no relatório; UI em Users)*
- [x] **P2** Convite de membros por email — `POST /users/invite` (ORG_ADMIN /
  SECTOR_SUPERVISOR); cria conta com password temporária, envia email SMTP
  (fallback: password devolvida na resposta se SMTP não estiver configurado);
  UI em Utilizadores → Convidar

### 5.5 — Configurações & Preferências (UI)
- [x] **P1** Perfil do utilizador (`Profile.tsx`)
- [x] **P1** Configurações da organização (nome, prefixo, slug/plano read-only)
- [x] **P1** Configuração de pastas monitoradas
- [x] **P1** Configuração de scanner padrão (persistido) — o scanner escolhido na
  página Scanner fica persistido em `docid-config` (configStore) e reutilizado
  como predefinição; selector também disponível em Configurações → Dispositivos
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
- [x] **P2** Enfileiramento de escritas offline (fila de pedidos) — Opção C —
  **feito na Fase 12**
- [ ] **P2** Upload offline via `attach_document_native` (Rust) — faz HTTP
  directo, sem fila (o fallback de rede do `UploadModal` enfileira via
  `enqueueFromPath` — Fase 9)
- [x] **P2** Cache de endpoints auxiliares (categorias no GenerateModal, listas
  de sectores/utilizadores nos dropdowns de Users/Audit) — **feito na Fase 10**

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
- [x] **P2** Fase 4: fila de escritas offline (idempotência, ordem, conflitos) —
  **feita na Fase 12**


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
- [x] **P1** Evicção da cache de downloads — **decisão do utilizador: só idade (30 dias)**;
  `evict_expired_downloads` remove ficheiros com mais de 30 dias e pastas vazias,
  chamado (limitado a 1×/hora) no `run_sync_cycle_inner`

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

## FASE 12 — Fila de Escritas Offline *(Fase 4 do plano offline)*
> **Objectivo:** enfileirar mutações (sectores, users, aprovações, cancelar
> identificador, etc.) quando a rede falha, e aplicá-las automaticamente quando
> a ligação voltar — com idempotência, ordem FIFO e tratamento de conflitos.
> Âmbito completo (todas as mutações), conforme decisão do utilizador.

### 12.1 — Persistência (Rust/SQLite)
- [x] **P0** Tabela `local_write_queue` em `db/mod.rs`: `method` (CHECK
  POST/PATCH/PUT/DELETE), `path`, `body`, `idempotency_key` (UNIQUE),
  `resource_key`, `status` (pending/applying/done/failed/conflict), `attempts`,
  `last_error`, `created_at`; índice `idx_write_status`
- [x] **P0** `WriteItem` + `row_to_write_item` + `fetch_writes_pending` +
  `insert_write` + `reset_stuck_writes` (recovery de itens presos em `applying`)
- [x] **P0** Comandos Tauri: `enqueue_write` (idempotente — devolve o item já
  existente para a mesma `idempotency_key`), `get_write_queue`,
  `remove_write_item`, `retry_write_item`; registados em `lib.rs`

### 12.2 — Replay (Rust)
- [x] **P0** `apply_write_http`: envio genérico do método/path/body com Bearer +
  header `Idempotency-Key`, timeout 120s
- [x] **P0** `classify_write_status`: 2xx→done; `ALREADY_RESOLVED`→done (estado
  do servidor manda); 400/404/409/410→conflict; 403/422→failed (permanente);
  401→AuthExpired (pausa); 408/425/429/5xx→transitório (retry)
- [x] **P0** `compute_write_outcome`: transições puras e testáveis; tentativas
  máx. `MAX_WRITE_ATTEMPTS=5`; backoff exponencial
- [x] **P0** `replay_write_queue`: FIFO sem paralelismo, reset de `applying`,
  pausa com pedido de re-login em sessão expirada, limpeza de `done` no fim
- [x] **P0** Integração no `run_sync_cycle_inner` (após sync de identificadores)
  e contagem de pendentes na fila de escritas no `start_background_sync`

### 12.3 — Frontend
- [x] **P0** Entidade `WriteItem` + `activeWriteCount` (`domain/entities`)
- [x] **P0** Porta `ISyncService` + `TauriSyncAdapter`/`SyncService`:
  `getWriteQueue`, `enqueueWrite`, `removeWriteItem`, `retryWriteItem`
- [x] **P0** Interceptor no `HttpApiClient`: em erro de rede em POST/PATCH/PUT/
  DELETE (não-FormData) enfileira via `sync.enqueueWrite` (idempotency + resource
  key derivada do path) e devolve feedback "ficou pendente e será sincronizado"
- [x] **P0** `writeQueueStore` + `WriteQueuePanel`/`WriteQueueBadge` (análogos ao
  painel de uploads) integrados no `Layout`
- [ ] **P1** Verificação manual em runtime: mutação offline fica pendente com
  feedback; ao voltar a ligação o replay aplica e a fila esvazia; duplicados não
  criam registos repetidos (idempotência/ALREADY_RESOLVED)

---

## Débito Técnico & Qualidade
- [x] **P1** Testes de integração para endpoints críticos
- [x] **P1** Testes do motor de sync offline — **feito**: `compute_upload_outcome`
  (função pura), `reset_stuck_items` (crash recovery), ciclo completo
  sucesso/falha até `MAX_ATTEMPTS`; sincronização de identificadores
  (agrupamento, state transitions, `lease_needs_renewal`, `apply_lease_renewal`,
  `fetch_active_leases`); Fase 12: `classify_write_status`, `compute_write_outcome`
   e persistência da fila de escritas; Fase 11 evicção da cache de downloads —
   107 testes Rust no total
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
- [x] **P1** Logs estruturados na API (pino) — `lib/logger.ts`, logs de request
  (método/path/status/duração) e de erro estruturados JSON, com redacção de
  segredos; roda em dev com `LOG_LEVEL`, desactivado em testes
- [x] **P1** Health check endpoint `GET /health`
- [x] **P2** Documentação OpenAPI actualizada
- [x] **P2** Script de seed para dados de demonstração
- [ ] **P2** Pipeline CI básica (lint + typecheck + testes)
- [ ] **P3** Testes E2E com Playwright

---

## FASE 14 — Anexos múltiplos + versionamento de documentos
> **Objectivo:** vários ficheiros por identificador (primary + attachments) e histórico de versões (a mais recente é a activa).
> **Entregável:** migração 0015, API attach/attachments/versions, UI desktop (lote + detalhe).

### 14.1 — Modelo de dados
- [x] **P0** Tabela `document_versions` com `UNIQUE(document_id, version)` e um `is_current` por documento
- [x] **P0** Remover unique de `documents.identifier_id`; adicionar `kind` (`primary`|`attachment`) e `label`
- [x] **P0** Índice parcial: no máximo um `kind=primary` por `identifier_id`
- [x] **P0** Backfill: cada documento existente → versão 1 current; metadados de ficheiro na versão
- [x] **P0** RLS para `document_versions`

### 14.2 — API
- [x] **P0** `POST /documents/attach` — cria primary v1 (rejeita se já existir primary)
- [x] **P0** `POST /documents/attachments` — cria attachment v1 (sem verificação obrigatória do ID)
- [x] **P0** `POST /documents/:id/versions` — nova versão; primary exige verificação do ID
- [x] **P0** `GET /documents/:id` — meta + `versions[]` + `attachments[]`
- [x] **P0** `GET /documents/:id/versions/:version/download` — download de versão específica
- [x] **P1** Listagem devolve o primary actual por identificador

### 14.3 — Desktop
- [x] **P0** `attach_document_native` com `mode: attach | version | attachment`
- [x] **P0** UploadModal: selecção múltipla, lote com IDs distintos ou anexos ao mesmo ID
- [x] **P0** DetailModal: timeline de versões, nova versão, adicionar anexo
- [x] **P1** Feedback de lote por ficheiro (sucesso/falha/fila) sem abortar o resto

### 14.4 — Testes
- [x] **P0** Suite de integração: primary, rejeição do 2.º primary, attachment, versão, download histórico

---

## Resumo por Fase

| Fase | Foco | Estado |
|---|---|---|
| **1** | API multi-tenant + Auth + RBAC | ✅ Completo (E2E validado; correcções de segurança em 5.6) |
| **2** | App Tauri (online) | ✅ Completo |
| **3** | Offline sync | ✅ Completo (incl. bug crítico de path corrigido, testes) |
| **4** | Partilha + Aprovações + SSE | ✅ Completo |
| **5** | Scanner + IA + File Watcher + Settings | ✅ Completo — watcher, scanner/PDF/multi-página, impressoras, classificador com cache Redis, convite por email |
| **5.6** | Correcções de segurança (hardening) | ✅ Completo — RLS, advisory lock, roles frescas, tratamento de erro uniforme, suite de testes de carga |
| **6** | Geração offline de identificadores | ✅ Completo — backend (M0–M2), motor de sync nativo + testes (M3), UI (M4 + M4.5), registo de dispositivos (M5); classificação legal de categorias pendente de confirmação profissional |
| **7** | Cache offline de leitura | ✅ Completo — `OfflineCache` encriptado (AES-GCM), hook nas 8 páginas, `mapError`, limpeza no logout; resolve o P0 de ecrãs vazios offline |
| **8** | Seed offline da geração de identificadores | ✅ Completo — lacuna corrigida: caches (categorias/tenant) e leases semeados no ciclo de sync + `ensure_offline_lease`/`cache_categories` no frontend; verificação manual em runtime pendente |
| **9** | Upload offline ligado à UI | ✅ Completo — `isNetworkError`, `enqueueFromPath`, fallback de rede no `UploadModal` do Documents; verificação manual em runtime pendente |
| **10** | Cache de endpoints auxiliares | ✅ Completo — TTLs `/categories` + `/sectors/:id/members` (match dinâmico), `useCachedAux`, dropdowns/maps de sectores/utilizadores com fallback de cache; verificação manual em runtime pendente |
| **11** | Download offline de documentos | ✅ Completo — cache de ficheiros em disco (`downloads_dir`), `download_document_offline`/`is_document_cached`/`open_local_file`, abertura com app do SO, indicador de disponibilidade offline no detalhe, evicção por idade (30 dias); verificação manual em runtime pendente |
| **12** | Fila de escritas offline | ✅ Completo — tabela `local_write_queue`, comandos enqueue/get/remove/retry, replay FIFO com idempotência (`ALREADY_RESOLVED`/conflitos/401), interceptor no `HttpApiClient`, painel + badge de escritas no Layout; verificação manual em runtime pendente |
| **13** | Itens fáceis do backlog | ✅ Completo — `GET /tenants/me/stats`, `GET /roles/:id/users`, widgets do Dashboard (fila offline, aprovações pendentes, documentos recentes), prompt few-shot do classificador, evicção da cache de downloads |
| **14** | Anexos múltiplos + versionamento | ✅ Completo — `document_versions`, kind/label, endpoints attach/attachments/versions, UI lote + detalhe |

> Consultar `README.md` para visão geral do produto e arquitectura; este
> ficheiro é o documento vivo de estado por fase.
