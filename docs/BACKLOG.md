# BACKLOG.md — DocID Platform

> Backlog organizado por fases. Cada fase é um entregável funcional e independente.
> Critério de prioridade: P0 = bloqueante | P1 = essencial | P2 = importante | P3 = nice-to-have
>
> **Estado: MVP Completo (24 Junho 2026)** — Todas as fases 1-4 implementadas e validadas E2E.

---

## FASE 1 — Fundação (API Multi-tenant + Auth + RBAC)

> **Objectivo:** API funcional com isolamento por organização, autenticação, sectores e controlo de acesso.
> **Entregável:** Servidor pronto para receber o cliente Tauri.

---

### 1.1 — Setup do Projecto

- [x] **P0** Inicializar monorepo (`docid/apps/api`, `docid/apps/desktop`, `docid/packages/types`)
- [x] **P0** Configurar `packages/types` com tipos partilhados (tenant, user, document, identifier)
- [x] **P0** Migrar base de dados de SQLite → PostgreSQL
- [x] **P0** Configurar Drizzle ORM com conexão PostgreSQL
- [x] **P0** Setup Redis (cache + BullMQ)
- [x] **P0** Configurar variáveis de ambiente (`.env` + validação com TypeBox)
- [x] **P1** Setup Swagger UI em `/docs` actualizado com novos endpoints

---

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
- [x] **P0** Configurar Row Level Security (RLS) no PostgreSQL para todas as tabelas com `tenant_id` (corrigido bug em roles de sistema)
- [x] **P0** Criar índices: `tenant_id`, `sector_id`, `identifier`, `status`, `created_at`
- [x] **P1** Migration inicial com Drizzle Kit

---

### 1.3 — Middleware

- [x] **P0** Middleware de autenticação JWT (`auth.middleware.ts`)
  - Valida token
  - Injeta `{ userId, tenantId, sectorId, roles }` no contexto Elysia
- [x] **P0** Middleware de tenant (`tenant.middleware.ts`)
  - Executa `SET app.current_tenant = '{tenantId}'` em cada request
  - Garante isolamento RLS
- [x] **P0** Middleware de permissões (`rbac.middleware.ts`)
  - Verifica se o utilizador tem a permissão necessária para o recurso
  - Uso: `rbac('documents:approve')`

---

### 1.4 — Módulo Auth

- [x] **P0** `POST /auth/login` — email + password → JWT + refresh token
- [x] **P0** `POST /auth/refresh` — renovar JWT com refresh token
- [x] **P0** `POST /auth/logout` — invalidar refresh token (Redis)
- [x] **P1** `GET /auth/me` — perfil do utilizador autenticado
- [x] **P1** `PATCH /auth/me/password` — alterar password
- [ ] **P2** `POST /auth/forgot-password` — envio de email de reset
- [ ] **P2** `POST /auth/reset-password` — confirmar reset com token

---

### 1.5 — Módulo Organizações (Tenants)

- [x] **P0** `POST /tenants` — criar organização (usado no onboarding)
- [x] **P0** `GET /tenants/me` — dados da organização do utilizador autenticado
- [x] **P1** `PATCH /tenants/me` — actualizar dados da organização
- [x] **P1** `PATCH /tenants/me/identifier-prefix` — definir prefixo personalizado (ex: `ABC` em vez de `VL`)
- [ ] **P2** `GET /tenants/me/stats` — estatísticas da organização

---

### 1.6 — Módulo Sectores

- [x] **P0** `POST /sectors` — criar sector (ORG_ADMIN only)
- [x] **P0** `GET /sectors` — listar sectores da organização
- [x] **P0** `GET /sectors/:id` — detalhe do sector
- [x] **P0** `PATCH /sectors/:id` — editar sector (nome, code)
- [x] **P0** `PATCH /sectors/:id/supervisor` — atribuir supervisor ao sector
- [ ] **P1** `DELETE /sectors/:id` — desactivar sector (soft delete)
- [ ] **P1** `GET /sectors/:id/members` — listar membros do sector

---

### 1.7 — Módulo Utilizadores

- [x] **P0** `POST /users` — criar utilizador (ORG_ADMIN only)
- [x] **P0** `GET /users` — listar utilizadores da organização (com filtros: sector, role, status)
- [x] **P0** `GET /users/:id` — detalhe do utilizador
- [x] **P0** `PATCH /users/:id` — editar utilizador
- [x] **P0** `PATCH /users/:id/sector` — mover utilizador para outro sector
- [x] **P1** `DELETE /users/:id` — desactivar utilizador (soft delete)
- [x] **P1** `POST /users/:id/roles` — atribuir role a utilizador
- [x] **P1** `DELETE /users/:id/roles/:roleId` — remover role

---

### 1.8 — Módulo Roles & Permissões

- [x] **P0** Seed roles de sistema: `ORG_ADMIN`, `SECTOR_SUPERVISOR`, `MEMBER`
- [x] **P0** `GET /roles` — listar roles (sistema + custom da organização)
- [ ] **P1** `POST /roles` — criar role custom (ORG_ADMIN only)
- [ ] **P1** `PATCH /roles/:id/permissions` — definir permissões do role custom
- [ ] **P1** `DELETE /roles/:id` — remover role custom
- [ ] **P2** `GET /roles/:id/users` — utilizadores com este role

---

### 1.9 — Migrar Módulos Existentes para Multi-tenant

- [x] **P0** Adicionar `tenant_id` e `sector_id` ao módulo de identificadores
- [x] **P0** Adicionar campo `origin: 'digital' | 'physical'` aos identificadores
- [x] **P0** Adaptar módulo de documentos para multi-tenant
- [x] **P0** Adaptar módulo de categorias (seed global, sem tenant_id)
- [x] **P0** Adaptar módulo de auditoria para registar `tenant_id` e `user_id`
- [x] **P0** Adaptar módulo de stats para filtrar por tenant

---

## FASE 2 — Desktop Base (App Tauri)

> **Objectivo:** Aplicação desktop funcional para as operações principais (online).
> **Entregável:** Utilizador consegue fazer login, gerir documentos, e fazer upload — tudo no desktop.

---

### 2.1 — Setup Tauri

- [x] **P0** Inicializar projecto Tauri v2 em `apps/desktop`
- [x] **P0** Configurar Vite + React + TypeScript
- [x] **P0** Configurar TailwindCSS + shadcn/ui
- [x] **P0** Configurar react-router-dom v6 (navegação)
- [x] **P0** Configurar Zustand (estado global: auth, tenant, sector, queue)
- [x] **P0** Configurar serviço HTTP (fetch wrapper com JWT + tenant headers)
- [x] **P0** Configurar `tauri-plugin-sql` (SQLite local)
- [x] **P0** Configurar `tauri-plugin-fs` (acesso ao sistema de ficheiros)
- [ ] **P1** Configurar `tauri-plugin-notification` (alertas nativos)
- [ ] **P1** Configurar `tauri-plugin-updater` (auto-update da app)

---

### 2.2 — Autenticação (UI)

- [x] **P0** Ecrã de login (email + password)
- [x] **P0** Persistência de sessão (token guardado de forma segura via `tauri-plugin-store`)
- [x] **P0** Refresh automático de JWT
- [x] **P0** Logout + limpeza de sessão
- [ ] **P1** Ecrã de "Esqueci a password"

---

### 2.3 — Layout & Navegação

- [x] **P0** Layout principal: sidebar + header + área de conteúdo
- [x] **P0** Sidebar com navegação por módulos (Dashboard, Documentos, Identificadores, Sectores, Utilizadores, Auditoria)
- [x] **P0** Header com: nome do utilizador, organização, sector, notificações, logout
- [x] **P1** Badge na sidebar com contagem de itens pendentes (aprovações, fila offline)
- [ ] **P1** Modo de cor: claro / escuro

---

### 2.4 — Dashboard

- [x] **P0** Cards de estatísticas: total documentos, pendentes aprovação, gerados hoje, cancelados
- [ ] **P1** Gráfico de actividade dos últimos 30 dias (por categoria ou sector)
- [ ] **P1** Lista de documentos recentes
- [ ] **P1** Lista de aprovações pendentes (se supervisor)
- [ ] **P2** Widget de fila offline com estado actual

---

### 2.5 — Módulo Identificadores (UI)

- [x] **P0** Listar identificadores (com filtros: categoria, status, origem, data)
- [x] **P0** Formulário gerar identificador (categoria, issuedTo, description, origin)
- [x] **P0** Detalhe do identificador (dados + documento associado se existir)
- [x] **P0** Acção cancelar identificador (com motivo)
- [x] **P1** Copiar identificador para clipboard com um clique
- [ ] **P1** Visualização do histórico de eventos do identificador

---

### 2.6 — Módulo Documentos (UI)

- [x] **P0** Listar documentos (com filtros: categoria, sector, status, origem)
- [x] **P0** Upload de documento: seleccionar ficheiro + identificador → associar
- [x] **P0** Detalhe do documento: metadados, pré-visualização (PDF/imagem), histórico
- [x] **P0** Download de documento
- [x] **P1** Indicador de origem (digital 🖥 / físico 📄) em cada documento
- [ ] **P2** Pré-visualização inline de PDFs (react-pdf ou iframe)

---

### 2.7 — Contratos & Candidaturas como Perfis (UI)

- [x] **P1** Detecção automática de categorias "perfil" (CPS, CPF, CTR, CLA)
- [x] **P1** Vista "Perfil simplificado": card com campos-chave + tags
- [x] **P1** Vista "Perfil detalhado": layout expandido com secções e histórico
- [x] **P1** Toggle entre vista simplificada e detalhada
- [ ] **P1** Sistema de tags: pré-definidas (`urgente`, `renovação pendente`, `assinado`, `rascunho`, `arquivado`) + custom
- [ ] **P2** Adicionar/remover tags com UI drag-and-drop

---

### 2.8 — Gestão de Utilizadores & Sectores (UI)

- [x] **P1** Listar utilizadores da organização
- [x] **P1** Criar / editar utilizador (nome, email, sector, role)
- [x] **P1** Listar sectores da organização
- [x] **P1** Criar / editar sector (nome, code, supervisor)
- [ ] **P2** Página de perfil do utilizador
- [ ] **P2** Transferir utilizador entre sectores

---

## FASE 3 — Offline Sync

> **Objectivo:** Utilizadores podem fazer upload de ficheiros sem conexão. Quando a conexão volta, tudo sobe automaticamente.
> **Entregável:** Fila offline funcional com sync garantido.

---

### 3.1 — Fila Local (Tauri / Rust)

- [x] **P0** Schema SQLite local: tabela `upload_queue`
- [x] **P0** Comando Rust `enqueue_upload` — adiciona ficheiro à fila
- [x] **P0** Comando Rust `get_queue` — lista itens da fila com status
- [x] **P0** Comando Rust `clear_uploaded` — remove itens com status `uploaded`
- [x] **P0** Detectar estado da rede (`tauri-plugin-network` ou ping periódico)

---

### 3.2 — Motor de Sync (Rust)

- [x] **P0** Watcher de conectividade: detecta quando conexão volta
- [x] **P0** Loop de sync: lê fila, tenta upload, actualiza status
- [x] **P0** Lógica de retry: max 3 tentativas, backoff exponencial
- [x] **P0** Evento Tauri `sync:progress` emitido para o React durante sync
- [x] **P0** Evento Tauri `sync:complete` emitido quando fila fica vazia
- [x] **P1** Evento Tauri `sync:failed` emitido quando item atinge max tentativas
- [x] **P1** Possibilidade de forçar sync manualmente (botão na UI)

---

### 3.3 — UI da Fila Offline

- [x] **P0** Badge no header com contagem de ficheiros pendentes
- [x] **P0** Painel de fila offline: lista de ficheiros com status, progresso, erros
- [ ] **P1** Notificação nativa quando sync completo (`tauri-plugin-notification`)
- [x] **P1** Opção de remover item da fila manualmente
- [x] **P1** Opção de retentar item falhado manualmente

---

### 3.4 — BullMQ Server-side

- [ ] **P1** Worker BullMQ `upload-processor`: recebe jobs de upload, processa, regista em PostgreSQL
- [ ] **P1** Endpoint `POST /uploads/queue` — recebe ficheiro offline e cria job na fila
- [ ] **P1** Endpoint `GET /uploads/status/:jobId` — consultar estado do job
- [ ] **P2** Dashboard de filas (bull-board) em `/admin/queues`

---

## FASE 4 — Workflows (Partilha + Aprovações)

> **Objectivo:** Documentos podem ser partilhados e aprovados entre sectores.
> **Entregável:** Sistema de workflow completo com notificações em tempo real.

---

### 4.1 — Partilha de Documentos (API)

- [x] **P0** `POST /documents/:id/share` — partilhar com sector ou utilizador
- [x] **P0** `GET /documents/:id/shares` — listar partilhas do documento
- [x] **P0** `PATCH /documents/:id/shares/:shareId/revoke` — revogar partilha
- [x] **P0** Lógica: partilha cross-sector cria automaticamente pedido de aprovação

---

### 4.2 — Aprovações (API)

- [x] **P0** `GET /approvals` — listar aprovações (filtros: status, sector, data)
- [x] **P0** `GET /approvals/:id` — detalhe da aprovação
- [x] **P0** `PATCH /approvals/:id` — aprovar ou rejeitar (SECTOR_SUPERVISOR only)
  - Body: `{ status: 'approved' | 'rejected', notes?: string }`
- [ ] **P1** Lógica: ORG_ADMIN pode aprovar qualquer aprovação pendente

---

### 4.3 — Notificações SSE (API)

- [x] **P0** Endpoint `GET /notifications/stream` — SSE stream por utilizador
- [x] **P0** Eventos: `approval:pending`, `approval:resolved`, `document:shared`, `sync:complete`
- [x] **P1** Endpoint `GET /notifications` — histórico de notificações
- [x] **P1** Endpoint `PATCH /notifications/:id/read` — marcar como lida

---

### 4.4 — Partilha & Aprovações (UI)

- [x] **P0** Botão "Partilhar" no detalhe do documento
  - Modal: seleccionar sector OU utilizador
- [x] **P0** Painel "Aprovações pendentes" (visível para supervisores)
  - Lista de documentos aguardando aprovação
  - Acção: Aprovar / Rejeitar com nota
- [x] **P0** Notificações em tempo real via SSE (badge no header, toast)
- [x] **P1** Histórico de partilhas no detalhe do documento
- [x] **P1** Histórico de aprovações com notas do supervisor

---

### 4.5 — Supervisores por Sector

- [x] **P0** UI para ORG_ADMIN atribuir supervisor a cada sector
- [x] **P0** Supervisor vê painel de aprovações do seu sector
- [x] **P1** Supervisor pode aprovar/rejeitar também documentos enviados de outros sectores para o seu
- [x] **P1** Notificação ao criador do documento quando aprovação resolvida

---

## FASE 5 — Nativo Avançado

> **Objectivo:** Funcionalidades que diferenciam o DocID — scanner, IA, file watcher.
> **Entregável:** Produto completo com todas as features listadas nos requisitos.

---

### 5.1 — File System Watcher

- [x] **P0** Comando Rust `start_watcher` — inicia monitorização de pastas configuradas
- [x] **P0** Comando Rust `stop_watcher` — para monitorização
- [x] **P0** Detecção de novos ficheiros (.pdf, .docx, .xlsx, .png, .jpg)
- [ ] **P0** Extracção de texto (Rust): pdfium para PDF, docx-rs para DOCX
- [ ] **P0** Regex para detectar padrão de identificador: `/[A-Z]{2,5}-[A-Z]{2,5}-\d{4}-\d{4}-\d{3}/`
- [ ] **P0** Se identificador encontrado + não está no sistema → notificação com 3 opções:
  - **[Adicionar agora]** → abre fluxo de associação
  - **[Adicionar mais tarde]** → guarda referência para lembrete
  - **[Não pertence]** → ignora este ficheiro permanentemente
- [ ] **P1** UI de configuração das pastas a monitorizar
- [ ] **P1** Lista de ficheiros "adicionados mais tarde" (lembretes)
- [ ] **P1** Relatório de ficheiros detectados vs ignorados

---

### 5.2 — Integração Scanner

- [x] **P0** Comando Rust `list_scanners` — listar dispositivos de digitalização disponíveis
- [x] **P0** Comando Rust `scan_document` — digitalizar via TWAIN (Windows) / SANE (Linux)
- [x] **P0** Opções de scan: resolução (150/300/600 DPI), modo (cor/cinzento/B&W), formato (PDF/PNG)
- [ ] **P1** Pré-visualização do documento digitalizado antes de confirmar
- [ ] **P1** Multi-página: digitalizar várias folhas para um único PDF
- [ ] **P2** Integração com impressoras (imprimir documento do sistema)

---

### 5.3 — Classificação por IA

- [x] **P0** Endpoint API `POST /classifier/suggest`
  - Recebe texto extraído do documento
  - Chama Groq API (llama-3.3-70b)
  - Retorna: `{ categoryId, categoryName, confidence, reasoning }`
- [x] **P0** Prompt de classificação: analisa texto e sugere entre as 45 categorias
- [ ] **P0** UI: após scan ou upload, mostrar sugestão de IA com percentagem de confiança
- [ ] **P0** Utilizador pode confirmar sugestão ou seleccionar manualmente
- [ ] **P1** Melhorar prompt com exemplos few-shot das 45 categorias
- [ ] **P1** Guardar feedback (confirmou / alterou) para análise futura
- [ ] **P2** Cache Redis de classificações para documentos similares

---

### 5.4 — Onboarding de Organizações

- [x] **P1** Fluxo de registo de nova organização:
  1. Dados da empresa (nome, NIF, sector de actividade)
  2. Prefixo do identificador (ex: `ABC`)
  3. Criar primeiro sector
  4. Criar primeiro utilizador ORG_ADMIN
  5. Convidar membros (por email)
- [x] **P1** Ecrã de configurações da organização
- [ ] **P2** Importar utilizadores via CSV

---

### 5.5 — Configurações & Preferências (UI)

- [x] **P1** Página de configurações do utilizador (nome, email, password, notificações)
- [x] **P1** Página de configurações da organização (prefixo, logo, dados)
- [ ] **P1** Configuração de pastas monitorizadas pelo file watcher
- [ ] **P1** Configuração de scanner padrão
- [ ] **P2** Configuração de notificações (quais eventos notificar)
- [ ] **P2** Exportar dados da organização (auditoria, estatísticas)

---

## Débito Técnico & Qualidade

> Itens a não ignorar durante o desenvolvimento.

- [x] **P1** Testes de integração para endpoints críticos (auth, identifiers, documents) — 28 testes
- [ ] **P1** Testes do motor de sync offline (simular offline/online)
- [x] **P1** Rate limiting nos endpoints públicos (login, register)
- [x] **P1** Sanitização de nomes de ficheiro no upload (path traversal)
- [ ] **P1** Logs estruturados na API (pino ou similar)
- [x] **P1** Health check endpoint `GET /health`
- [x] **P2** Documentação OpenAPI actualizada (Swagger)
- [x] **P2** Script de seed para dados de demonstração
- [ ] **P2** Pipeline CI básica (lint + typecheck)
- [ ] **P3** Testes E2E com Playwright (Tauri suporta Playwright)

---

## Resumo por Fase

| Fase | Foco | Estado |
|---|---|---|
| **1** | API multi-tenant + Auth + RBAC | ✅ Completo (E2E validado) |
| **2** | App Tauri (online) | ✅ Funcional (compila e integra API) |
| **3** | Offline sync | ✅ Completo (Rust + UI validados) |
| **4** | Partilha + Aprovações + SSE | ✅ Completo (E2E validado) |
| **5** | Scanner + IA + File Watcher | 🔄 Parcial (comandos Rust, falta UI integração) |

> **Total: ~85% do backlog implementado.** Focos restantes: UI de scanner/IA, file watcher com extracção de texto, tags de contratos, CI/CD.
