# CLAUDE.md — DocID Platform · Contexto 360°

> Este ficheiro é a fonte de verdade técnica para qualquer sessão de desenvolvimento do DocID.
> Lê-o integralmente antes de escrever qualquer linha de código.
> Actualizado a 27/11/2026 contra o código em `main`.

---

## 1. O Que é o DocID

**DocID** é uma plataforma de gestão de documentos empresariais da **Verano Labs** (Luanda,
Angola), vendida sob a marca MilVendas: app desktop para os colaboradores, API multi-organização,
painel da provedora e site com checkout.

O produto resolve um problema real no mercado angolano: documentos empresariais (contratos,
propostas, facturas, etc.) circulam sem rastreabilidade, perdem-se, são duplicados, e não têm
controlo de acesso por sector.

### Conceito central
Cada documento recebe um **identificador único** (`VL-PROP-2026-0424-001`) antes de ser emitido.
O identificador deve ir no documento: é o que o liga ao registo no sistema.

> Desde 25/11/2026 (`9789862`) a API **não recusa** um ficheiro que não contenha o identificador:
> extrai o texto, procura-o (como ocorrência isolada, ver §12) e regista o resultado em
> `verification`, mas aceita o anexo. A regra antiga (422 quando não encontrado) já não existe.

### Mercado-alvo
Empresas angolanas de médio porte (50–500 colaboradores) com múltiplos sectores internos: RH,
Jurídico, Financeiro, Comercial, Técnico, Administrativo.

---

## 2. Decisões de Arquitectura (e o Porquê)

### Desktop-first com Tauri v2
- **Porquê Tauri e não Electron:** o instalador Windows normal tem ~9 MB e descarrega o WebView2
  só se faltar (há também um completo de ~300 MB, com o WebView2, para instalar sem internet),
  contra ~180 MB de uma app Electron. Em Angola, máquinas corporativas têm
  frequentemente 4–8 GB de RAM e HDDs lentos. Tauri usa a WebView nativa do SO (Edge no Windows,
  WebKit no macOS/Linux).
- **Porquê desktop e não web:** scanner (TWAIN/SANE), vigilância de pastas e envio garantido
  sem rede exigem acesso nativo ao SO.
- **A UI React é a mesma** — Tauri só adiciona a camada nativa via comandos Rust. A UI também corre
  num browser (modo de desenvolvimento e testes E2E), sem as funções nativas.

### PostgreSQL no servidor, SQLite na máquina
- **PostgreSQL (servidor):** base de dados principal, multi-organização via Row Level Security.
  Toda a informação real vive aqui; o servidor é sempre a autoridade final.
- **SQLite (desktop, `rusqlite`):** não é uma réplica. Guarda o que a app precisa para trabalhar
  sem rede: lotes de números fiscais, contadores locais, identificadores pendentes, fila de
  uploads, fila de escritas, cache de categorias e estado da organização, ficheiros detectados
  pelo watcher. A leitura offline das listagens vem de uma cache encriptada (AES-GCM) no
  `tauri-plugin-store`.

### Multi-organização via RLS
- Cada organização tem um `tenant_id` (UUID), que viaja no JWT.
- Toda a query autenticada corre em `withTenant(tenantId, tx => …)`: uma transacção com
  `set_config('app.current_tenant', id, true)` (equivale a `SET LOCAL`), para o valor nunca
  escapar para outra ligação do pool.
- As policies usam `NULLIF(current_setting('app.current_tenant', true), '')`: um tenant vazio
  devolve zero linhas, sem erro (migração 0024).
- Leituras entre organizações (login, onboarding, painel da provedora, checkout público, jobs)
  usam funções `SECURITY DEFINER` ou o pool `lookupDb`, que liga `app.auth_lookup = on`.
- **O RLS só protege se o utilizador da BD não for superutilizador nem tiver `BYPASSRLS`.** Em
  produção o utilizador da API (`milvendas_MV`) não tem bypass; a API avisa no arranque se tiver
  (`db/role-check.ts`, `REQUIRE_RLS_ROLE=true` recusa arrancar). Ver `docs/RLS_PRODUCAO.md`.

### API: Elysia + Drizzle; Bun em desenvolvimento, Node em produção
- Elysia com validação TypeBox; Drizzle ORM com migrações SQL em `src/db/migrations`.
- Em produção (cPanel/CloudLinux) o Bun não arranca por limites de processos: o CI gera um bundle
  `bun build --target=node --packages=external` com `NODE_ENV` definido como `production`, e o
  servidor corre `node dist/index.js`. Sem esse `--define`, o bundler fixa `development` e a API
  expunha o Swagger em produção.

---

## 3. Stack Completa

| Camada | Tecnologia |
|---|---|
| Desktop runtime | Tauri v2 |
| Desktop UI | React 18 + Vite + TailwindCSS v3, componentes próprios em `docid-ui.tsx` (não shadcn/ui), react-router v6, Zustand |
| Desktop core | Rust (`rusqlite`, `notify`, `pdf-extract`, `keyring`, `reqwest`) |
| API | Elysia + Drizzle ORM; Bun (dev/testes) e Node 22 (produção) |
| Base de dados | PostgreSQL 16+ (produção: 13) |
| Cache e filas | Redis 7+ opcional (rate limit, BullMQ para thumbnails); sem Redis, rate limit em memória |
| E-mail | Fila transaccional em PostgreSQL (`email_logs`, `FOR UPDATE SKIP LOCKED`) + SMTP por organização |
| IA | Groq API (llama-3.3-70b), com cache Redis por hash do texto |
| Tempo real | SSE (`/notifications/stream`) |
| Auth | JWT (`jose`) HS256, 15 min + renovação até 7 dias desde o último login |
| Painel da provedora | `apps/admin` (Vite + React) |
| Site | `apps/landing` (Vite + React + Tailwind) |
| Testes | `bun test` (API e desktop), `cargo test` (Rust), Playwright (E2E contra uma API real) |
| Monorepo | Workspaces Bun (`apps/*`, `packages/*`), sem Turborepo |

---

## 4. Estrutura do Monorepo

```
apps/
├── api/                         ← API (Elysia)
│   ├── src/
│   │   ├── index.ts             ← entry point: middlewares, módulos, workers
│   │   ├── db/                  ← schema.ts, withTenant.ts, migrate.ts, seed.ts,
│   │   │                          role-check.ts, migrations/ (0000–0029 + journal)
│   │   ├── middleware/          ← auth.ts, tenant.ts, licenseGuard.ts, rateLimit.ts
│   │   ├── modules/             ← uma rota Elysia por domínio (auth, tenants, sectors, users,
│   │   │                          roles, categories, identifiers, documents, approvals, audit,
│   │   │                          stats, devices, classifier, email, plans, subscriptions,
│   │   │                          provider, platform)
│   │   ├── services/            ← regras de negócio (identifier, lease, release-pool,
│   │   │                          attachment, access-decision, subscription, license,
│   │   │                          license-enforcement, order, notification, classifier, email/)
│   │   ├── jobs/                ← email-worker, subscription-reminders, filas BullMQ
│   │   └── lib/                 ← cors, ip, logger, identifier-date, identifier-prefix, …
│   └── scripts/                 ← deploy-server.sh, apply-migrations.mjs (produção), loadtest/
├── desktop/                     ← App Tauri
│   ├── src/                     ← React em arquitectura hexagonal:
│   │   ├── domain/              ←   entidades e value objects
│   │   ├── application/         ←   portas, casos de uso, serviços
│   │   ├── infrastructure/      ←   HttpApiClient, adapters Tauri, storage; di/container.ts
│   │   │                            é o único sítio onde se instanciam clientes e adapters
│   │   ├── interfaces/          ←   pages/, components/, hooks/, stores/
│   │   └── shared/              ←   erros (mapError), helpers, constantes
│   └── src-tauri/src/           ← Rust: commands/ (identifiers, watcher, scanner, printer,
│                                  text_extraction, secure_key), sync/ (motor de sync e filas),
│                                  db/ (schema SQLite), updater.rs
├── admin/                       ← painel da provedora
└── landing/                     ← site público
packages/types/                  ← tipos partilhados
e2e/                             ← Playwright
scripts/                         ← versão do desktop, publicação na landing, verify-installer
```

---

## 5. Modelo de Dados Principal

### Hierarquia organizacional

```
Organization (tenant)
  └── Sector (ex: RH, Financeiro, Jurídico...)
        └── User
              └── Role (atribuído no sector)
```

### Tabelas (PostgreSQL)

| Área | Tabelas |
|---|---|
| Organizações e acesso | `organizations`, `sectors`, `users`, `roles`, `role_permissions`, `user_roles`, `password_reset_tokens` |
| Identificadores | `categories` (global), `identifiers`, `idempotency_records` |
| Geração offline | `devices`, `identifier_leases`, `identifier_release_pool` |
| Documentos | `documents` (primary/attachment, tags), `document_versions`, `document_shares`, `document_access_requests`, `approvals` |
| Notificações | `notifications`, `tenant_email_settings`, `email_logs` |
| Auditoria e IA | `audit_logs` (imutável), `classifier_feedback` |
| Comercial (plataforma) | `plans`, `orders`, `licenses`, `provider_users` |

- RLS activo e forçado em todas as tabelas com `tenant_id` e nas tabelas filhas
  `document_shares`, `user_roles`, `role_permissions` (migração 0029). `orders` é excepção
  deliberada: tabela da plataforma, lida só pela provedora e pelo checkout.
- `identifiers.status`: `active | attached | cancelled`; `origin`: `digital | physical`;
  `visibility`: `public | sector_only` (por omissão vem da categoria).
- `documents.kind`: `primary` (no máximo um por identificador) ou `attachment`; cada ficheiro tem
  versões em `document_versions`, com uma `is_current`.

### SQLite local (desktop)

`local_identifier_lease`, `local_pending_identifiers`, `local_loose_counters`,
`local_category_cache`, `local_tenant_state`, `local_device_identity`, `upload_queue`,
`local_write_queue`, `watcher_files`. Regras em `docs/offline-persistence-invariants.md`.

---

## 6. Modelo de Acesso (RBAC)

### Roles de sistema (`tenant_id` NULL, partilhados por todas as organizações)

| Role | Escopo | Pode fazer |
|---|---|---|
| `ORG_ADMIN` | Toda a organização | Gerir sectores, utilizadores, roles e organização; ver e abrir todos os documentos; aprovar qualquer pedido |
| `SECTOR_SUPERVISOR` | Sector atribuído | Aprovar/rejeitar partilhas e pedidos de acesso do sector; convidar membros |
| `MEMBER` | Sector atribuído | Gerar identificadores, anexar, partilhar documentos do sector |

As roles são sempre lidas da base de dados (`getFreshRoles`), não do JWT, que pode estar
desactualizado.

### Regras de acesso a documentos (`attachment.service.ts → canAccessDocument`)

1. Visibilidade `public` → qualquer utilizador da organização.
2. `ORG_ADMIN` → acesso a tudo na organização, incluindo `sector_only` de outros sectores.
3. Quem carregou o documento → acesso se o documento for do seu sector (perde-o ao mudar de
   sector; nos identificadores, o criador mantém sempre acesso).
4. Membros do sector do documento → acesso.
5. Partilha activa com o utilizador ou com o seu sector → acesso.
6. Caso contrário → pedido de acesso (`POST /documents/:param/request-access`), que o
   supervisor aprova.

> Incoerência conhecida: a listagem de identificadores marca como `restricted: true` os
> `sector_only` de outros sectores mesmo para o `ORG_ADMIN`, que os consegue abrir.

### Roles custom
Cada organização pode criar roles com permissões granulares (`roles`, `role_permissions`).

---

## 7. Fluxo de um Documento

```
1. GERAR IDENTIFICADOR
   POST /identifiers/generate { categoryId, sectorId?, origin?, visibility? }
   → { identifier: "VL-PROP-2026-0424-001" }
   (quota mensal do plano; estado da subscrição)

2. INCLUIR NO DOCUMENTO
   O documento (PDF/DOCX/TXT) deve conter o texto do identificador.

3. ANEXAR
   POST /documents/attach (multipart: identifier, file)     → documento principal, versão 1
   POST /documents/attachments                              → anexo ao mesmo identificador
   POST /documents/:param/versions                          → nova versão
   A API extrai o texto e regista se o identificador foi encontrado (informativo).

4. PARTILHAR
   POST /documents/:param/share { sectorId | userId }
   → mesmo sector: partilha activa; outro sector: aprovação pendente

5. APROVAR
   PATCH /approvals/:id { status: "approved" | "rejected" }
   → notificação SSE e e-mail (documento partilhado / aprovado)

6. CONSULTAR / DOWNLOAD
   GET /identifiers/:identifier
   GET /documents/:param  ·  GET /documents/:param/download
   Tudo fica em audit_logs.
```

---

## 8. Fluxo Offline

```
COM REDE (ciclo de sync de 5 s, em Rust)
  seed: GET /categories e /tenants/me → cache SQLite
  leases: reserva lotes para categorias fiscais em uso; renova abaixo de 20%
  identificadores pendentes → POST /identifiers/register-offline (fiscais, por lote)
                              POST /identifiers/register-offline-loose (restantes, um a um)
  fila de escritas (FIFO, Idempotency-Key) → replay; 401 pausa e pede novo login
  fila de uploads → POST /documents/attach | attachments; até 3 tentativas
  cache de downloads → evicção ao fim de 30 dias

SEM REDE
  gerar identificador fiscal → número do lote local (definitivo)
  gerar não fiscal → contador local (provisório: o número final vem do servidor)
  escritas (POST/PATCH/PUT/DELETE) → local_write_queue
  uploads → upload_queue
  leituras → cache encriptada
```

- **Cada item das filas pertence à sessão que o criou** (`tenant_id` + `user_id`, lidos do JWT):
  o replay só envia os itens da sessão actual, e o logout limpa o token do motor nativo. Escritas
  de versões anteriores sem dono ficam em conflito até alguém as reenviar.
- **Um identificador fiscal emitido offline é registado tal como foi emitido**, com a data desse
  dia; a API valida prefixo, categoria, sequência e uma data entre a véspera do lote e o dia
  seguinte a hoje.
- O estado das filas lê-se sempre do SQLite, nunca do estado React.

---

## 9. Integração Scanner + IA

```
Digitalizar (Scanner.tsx) → comando Rust scan_document (TWAIN no Windows, SANE no Linux;
  o macOS ainda não tem scanner)
  → PNG/PDF, multi-página, pré-visualização, impressão
Texto extraído → POST /classifier/suggest → Groq → { categoryId, confidence, reasoning }
  → UI mostra a sugestão com a confiança; o utilizador confirma ou escolhe outra
  → POST /classifier/feedback regista aceitação ou correcção
```

---

## 10. File Watcher

```
Pastas configuradas em Configurações → Pastas Vigiadas (notify crate)
→ varredura inicial + eventos de ficheiros novos/alterados (PDF, DOCX, TXT, MD, CSV)
→ extracção de texto em Rust → procura do identificador:
    (?:^|[^A-Z0-9])([A-Z]{1,6}-[A-Z]{2,5}-\d{4}-\d{4}-\d{3,})
→ encontrado: anexar já / mais tarde / não pertence (lista persistida em watcher_files)
→ deduplicação por caminho + mtime (watcher_seen.json)
```

---

## 11. Contratos como Perfis

Documentos das categorias `CPS`, `CPF`, `CTR`, `CLA` têm uma vista «Perfis» em Documentos (cards
com tags) e detalhe em modo perfil. Tags pré-definidas (`urgente`, `renovação pendente`,
`assinado`, `rascunho`, `arquivado`) e custom (`PATCH /documents/:id/tags`).

---

## 12. Formato do Identificador

```
VL  -  PROP  -  2026  -  0620  -  001
│      │         │        │        │
│      │         │        │        └── Sequência (3 dígitos com zeros; cresce sem limite: 1000, 1001…)
│      │         │        └────────── Data de emissão MMDD
│      │         └─────────────────── Ano
│      └───────────────────────────── Código da categoria
└──────────────────────────────────── Prefixo da organização
```

- **A sequência é por organização e categoria e nunca recomeça** — nem por dia nem por ano. O
  MMDD é só a data de emissão.
- **Prefixo:** 1 a 6 letras A–Z (normalizado para maiúsculas). Por omissão, as letras do slug
  (até 4) ou `ORG`. **Não pode mudar** depois de a organização emitir o primeiro identificador
  (409 `PREFIX_LOCKED`).
- **Data:** no fuso `IDENTIFIER_TIMEZONE` (por omissão `Africa/Luanda`), não na hora local do
  servidor. Offline, o desktop usa a hora local do computador.
- **Sequência fiscal:** a geração online e os lotes começam acima do maior número emitido ou
  reservado. Números devolvidos (`identifier_release_pool`) só são reaproveitados se nenhum número
  mais alto já tiver saído; a parte que já não é segura é anulada e auditada (`SEQUENCE_VOIDED`).
- **Procura no texto** (API e watcher): ocorrência isolada — antes não pode haver maiúscula nem
  dígito, e depois não pode haver dígito.

---

## 13. Categorias de Documentos (42)

As marcadas com **★** exigem numeração sequencial (`categories.requiresSequential`, migração
0009) e usam lotes por computador offline. **Pendente:** confirmação desta lista por um
contabilista angolano; corrige-se só nessa coluna, sem mudar código.

| Grupo | ID | Nome |
|---|---|---|
| Comercial | PROP | Proposta Comercial |
| Comercial | FAT ★ | Factura |
| Comercial | REC ★ | Recibo |
| Comercial | NOT ★ | Nota de Crédito |
| Comercial | NDB ★ | Nota de Débito |
| Comercial | ORD ★ | Ordem de Compra |
| Comercial | GUE ★ | Guia de Entrega / Remessa |
| Comercial | COT | Cotação |
| Financeiro | REL | Relatório Financeiro |
| Financeiro | EXT | Extracto de Conta |
| Financeiro | ORC | Orçamento Interno |
| Financeiro | AUT | Autorização de Pagamento |
| Financeiro | TRF | Comprovativo de Transferência |
| RH | CTR | Contrato de Trabalho |
| RH | TER | Termo de Rescisão |
| RH | FLC | Folha de Salário |
| RH | DEC | Declaração de Vínculo |
| RH | MAP | Mapa de Férias |
| RH | ADM | Admissão de Colaborador |
| Jurídico | CPS | Contrato de Prestação de Serviços |
| Jurídico | CPF | Contrato de Parceria / Fornecimento |
| Jurídico | NDA | Acordo de Confidencialidade |
| Jurídico | SLA | Acordo de Nível de Serviço |
| Jurídico | MOU | Memorando de Entendimento |
| Jurídico | POW | Procuração |
| Jurídico | ACO | Acordo de Colaboração |
| Jurídico | LIC | Contrato de Licenciamento |
| Jurídico | CLA | Contrato de Locação / Arrendamento |
| Jurídico | GAR | Carta de Garantia |
| Jurídico | TIT | Título Executivo / Livrança |
| Administrativo | ATA | Acta de Reunião |
| Administrativo | MEM | Memorando Interno |
| Administrativo | CIR | Circular |
| Administrativo | REQ | Requisição Interna |
| Administrativo | POL | Política / Regulamento Interno |
| Administrativo | PRO | Procedimento Operacional |
| Administrativo | DEL | Despacho / Deliberação |
| Técnico | ESP | Especificação Técnica |
| Técnico | MAN | Manual de Utilização |
| Técnico | REP | Relatório Técnico |
| Técnico | TAS | Termo de Aceitação / Entrega |
| Técnico | PLN | Plano de Projecto |

---

## 14. Variáveis de Ambiente (API)

A lista completa, comentada, está em `apps/api/.env.example`. As que mais importam:

| Variável | Para quê |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | PostgreSQL; Redis opcional |
| `JWT_SECRET` | ≥ 32 caracteres em produção (a API recusa arrancar com menos) |
| `JWT_EXPIRES_IN`, `SESSION_MAX_AGE_HOURS` | 15 min por token; 168 h desde o último login |
| `TRUSTED_PROXY_HOPS` | proxies à frente da API (LiteSpeed do cPanel = 1) para ler o IP real |
| `ALLOW_PUBLIC_ONBOARDING`, `ONBOARDING_SECRET` | quem pode criar organizações |
| `REQUIRE_RLS_ROLE` | recusar arrancar se o utilizador da BD ignorar o RLS |
| `IDENTIFIER_TIMEZONE` | fuso da data dos identificadores (`Africa/Luanda`) |
| `ENABLE_SWAGGER` | Swagger em `/docs` (desligado em produção) |
| `PLATFORM_ADMIN_TOKEN` | API da plataforma (`/platform/*`); sem ele, 404 |
| `LICENSE_TRIAL_DAYS`, `LICENSE_TRIAL_MAX_USERS`, `LICENSE_GRACE_DAYS` | período de teste e tolerância |
| `EMAIL_*`, `SMTP_*` | notificações por e-mail (ver `docs/NOTIFICACOES_EMAIL.md`) |
| `PROVIDER_NOTIFY_EMAIL`, `LANDING_URL` | alertas da provedora e link de checkout |
| `GROQ_API_KEY` | classificação por IA |

---

## 15. Convenções de Desenvolvimento

### Nomenclatura
- Ficheiros: `kebab-case.ts`
- Componentes React: `PascalCase.tsx`
- Funções/variáveis: `camelCase`
- Constantes: `UPPER_SNAKE_CASE`
- Tabelas e colunas DB: `snake_case` (tabelas no plural)

### Padrões API
- Respostas: `{ data, meta? }`; erros: `{ error: { code, message, details? } }`. Algumas rotas
  antigas ainda devolvem o objecto directamente (ex.: `POST /documents/attach` →
  `{ success, message, document, verification }`).
- Paginação: `?page=1&limit=20` → `{ data, meta: { total, page, limit } }`
- Datas: ISO 8601 (UTC), excepto a data dentro do identificador (§12)

### Segurança
- NUNCA retornar `password_hash` em qualquer resposta
- Toda a query autenticada dentro de `withTenant`; nunca `db` directo em rotas autenticadas
- Leituras entre organizações só por `lookupDb` ou funções `SECURITY DEFINER`
- SEMPRE prepared statements (Drizzle faz isso por defeito)
- Logs de auditoria são IMUTÁVEIS — sem UPDATE/DELETE em `audit_logs`
- Novas policies RLS com `NULLIF(current_setting('app.current_tenant', true), '')`

### Migrações
- Ficheiro SQL em `apps/api/src/db/migrations` + entrada no `meta/_journal.json`.
- Em produção correm pelo deploy (`apps/api/scripts/apply-migrations.mjs`), cada uma numa transacção com
  o dono das tabelas; têm de ser compatíveis com o código anterior (o rollback do deploy não as
  desfaz). Nunca correr `src/db/migrate.ts` em produção.

### Performance
- Dados buscados na fronteira (módulo/rota), não em cada componente filho
- `Promise.all()` para queries paralelas independentes
- Índices obrigatórios: `tenant_id`, `sector_id`, `identifier`, `status`, `created_at`
- Cache Redis para categorias, stats e classificações

### Tauri / Rust
- Erros Rust → `{ code, message }` antes de voltar ao React
- Estado das filas offline → sempre do SQLite, nunca do estado React
- `PRAGMA foreign_keys = ON` e transacções em toda a geração local

---

## 16. Estado Actual (27/11/2026)

- **Em produção:** API, painel e site em `didall.milvendas.ao` / `docid.milvendas.ao`; app
  desktop 1.2.7 (Windows e Linux; o macOS gera `.dmg` mas não está assinado nem é distribuído).
- **Deploy e releases automáticos** (ver `README.md`, secção Operação, e `apps/desktop/UPDATER.md`).
- **Comercial:** planos em Kwanzas, checkout com validação manual do pagamento, período de teste,
  licenças com modo só consulta. Coexistem três peças (`license.service`,
  `license-enforcement.service`, `subscription.service`); ver `docs/LICENCAS.md`.
- **Pendente:** validação fiscal das categorias ★; testes manuais em runtime (§17);
  monitorização própria (BACKLOG, Fase 15); assinatura Authenticode do instalador Windows.

---

## 17. Pendentes de Teste Manual (verificar na app real)

- Geração offline de identificadores fiscais e não fiscais depois de alguns minutos online
  (seed de caches e leases).
- Upload, escrita e download offline, e sincronização ao voltar a rede.
- Computador partilhado: utilizador A deixa escritas pendentes, sai; B entra — as de A não podem
  ser enviadas por B.
- Fluxo nativo de anexo: diálogo → `extract_text_command` → `ClassifierSuggestion` →
  `attach_document_native` (verificar o caminho devolvido em flatpak/snap e o tempo de resposta
  do classificador dentro do timeout de 10 s).
- Scanner e impressoras em hardware real.

---

## 18. Princípio Guia

> O maior problema de performance raramente está no código — está na arquitectura.
> Antes de optimizar renderizações, perguntar: onde os dados estão a ser buscados?
> Dados na fronteira da página com `Promise.all()` > cada componente a fazer o seu próprio request.
