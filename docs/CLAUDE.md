# CLAUDE.md — DocID Platform · Contexto 360°

> Este ficheiro é a fonte de verdade para qualquer sessão de desenvolvimento do DocID.
> Lê-o integralmente antes de escrever qualquer linha de código.

---

## 1. O Que é o DocID

**DocID** é uma plataforma desktop de gestão de documentos empresariais desenvolvida pela **Verano Labs** (Luanda, Angola).

O produto resolve um problema real no mercado angolano: documentos empresariais (contratos, propostas, facturas, etc.) circulam sem rastreabilidade, perdem-se, são duplicados, e não têm controlo de acesso por sector.

### Conceito central
Cada documento recebe um **identificador único** (`VL-PROP-2026-0424-001`) antes de ser emitido. O documento físico ou digital **deve conter esse identificador** para ser aceite no sistema. Isso garante rastreabilidade fim-a-fim.

### Mercado-alvo
Empresas angolanas de médio porte (50–500 colaboradores) com múltiplos sectores internos: RH, Jurídico, Financeiro, Comercial, Técnico, Administrativo.

---

## 2. Decisões de Arquitectura (e o Porquê)

### Desktop-first com Tauri v2
- **Porquê Tauri e não Electron:** Bundle ~8MB vs ~180MB. Em Angola, máquinas corporativas têm frequentemente 4–8GB RAM e HDDs lentos. Tauri usa a WebView nativa do SO (Edge no Windows, WebKit no macOS/Linux), sem Chromium bundado.
- **Porquê desktop e não web:** Os requisitos de scanner (integração com TWAIN/WIA), file system watcher, e offline upload com garantia de entrega exigem acesso nativo ao SO. Um browser não consegue garantir isso de forma fiável (Background Sync API não funciona em Safari, SW morre com browser fechado).
- **A UI React é a mesma** — Tauri só adiciona o layer nativo via comandos Rust.

### PostgreSQL no servidor, SQLite na máquina
- **PostgreSQL (servidor):** Base de dados principal, multi-tenant via Row Level Security. Toda a informação real vive aqui.
- **SQLite (Tauri local):** Fila temporária de uploads offline. Funciona como caixa de saída — os ficheiros ficam aqui até serem enviados com sucesso ao servidor, depois apagam-se da fila. Não é uma réplica, é um buffer.

### Multi-tenancy via RLS (Row Level Security)
- Cada organização tem um `tenant_id` (UUID).
- O `tenant_id` viaja no JWT de autenticação.
- Middleware no Elysia injeta `SET app.current_tenant = '{tenant_id}'` em cada request.
- O PostgreSQL RLS garante que nenhuma query retorna dados de outro tenant — mesmo que o código da aplicação tenha um bug.

### Bun + Elysia (API)
- Já existe uma base funcional do DocID API com esta stack.
- Elysia tem validação de schema integrada (TypeBox), performance superior ao Fastify em benchmarks Bun.
- Drizzle ORM: type-safe, migrations simples, suporta RLS via SQL raw quando necessário.

---

## 3. Stack Completa

| Camada | Tecnologia | Versão alvo |
|---|---|---|
| Desktop runtime | Tauri | v2 (stable) |
| Desktop UI | React + Vite | React 18 |
| Styling | TailwindCSS + shadcn/ui | Tailwind v3 |
| Desktop core | Rust | stable |
| Local queue | SQLite via `tauri-plugin-sql` | — |
| API runtime | Bun | latest stable |
| API framework | Elysia | latest |
| ORM | Drizzle ORM | latest |
| Base de dados | PostgreSQL | 16+ |
| Cache | Redis | 7+ |
| Filas server-side | BullMQ | latest |
| IA classificação | Groq API | llama-3.3-70b |
| Real-time | SSE (Server-Sent Events) | — |
| Auth | JWT (jose) | — |
| File storage | Local filesystem (servidor) | — |
| Monorepo | — (estrutura manual, sem Turborepo) | — |

---

## 4. Estrutura do Monorepo

```
docid/
├── apps/
│   ├── desktop/                    ← App Tauri (cliente)
│   │   ├── src/                    ← React UI
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── routes/             ← páginas (react-router v6)
│   │   │   ├── components/         ← componentes UI
│   │   │   ├── hooks/              ← hooks custom
│   │   │   ├── stores/             ← estado global (zustand)
│   │   │   ├── services/           ← chamadas à API
│   │   │   └── lib/                ← utilitários
│   │   ├── src-tauri/              ← Rust core
│   │   │   ├── src/
│   │   │   │   ├── main.rs
│   │   │   │   ├── commands/       ← comandos invocáveis pelo React
│   │   │   │   │   ├── sync.rs     ← motor de sync offline
│   │   │   │   │   ├── scanner.rs  ← integração scanner
│   │   │   │   │   └── watcher.rs  ← file system watcher
│   │   │   │   └── db/             ← SQLite local (fila offline)
│   │   │   ├── tauri.conf.json
│   │   │   └── Cargo.toml
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── api/                        ← Servidor Elysia/Bun
│       ├── src/
│       │   ├── index.ts            ← entry point
│       │   ├── db/
│       │   │   ├── index.ts        ← conexão PostgreSQL
│       │   │   └── schema.ts       ← schema Drizzle (todas as tabelas)
│       │   ├── middleware/
│       │   │   ├── auth.ts         ← JWT validation
│       │   │   └── tenant.ts       ← RLS tenant injection
│       │   ├── modules/
│       │   │   ├── auth.module.ts
│       │   │   ├── tenants.module.ts
│       │   │   ├── sectors.module.ts
│       │   │   ├── users.module.ts
│       │   │   ├── roles.module.ts
│       │   │   ├── categories.module.ts
│       │   │   ├── identifiers.module.ts
│       │   │   ├── documents.module.ts
│       │   │   ├── sharing.module.ts
│       │   │   ├── approvals.module.ts
│       │   │   ├── audit.module.ts
│       │   │   └── stats.module.ts
│       │   └── services/
│       │       ├── identifier.service.ts
│       │       ├── document.service.ts
│       │       ├── attachment.service.ts
│       │       ├── classifier.service.ts  ← Groq AI
│       │       └── notification.service.ts ← SSE
│       └── package.json
│
└── packages/
    └── types/                      ← tipos TypeScript partilhados
        ├── src/
        │   ├── tenant.types.ts
        │   ├── user.types.ts
        │   ├── document.types.ts
        │   ├── identifier.types.ts
        │   └── index.ts
        └── package.json
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

### Tabelas core (PostgreSQL)

```sql
-- Organizações (tenants)
organizations: id, name, slug, plan, is_active, created_at

-- Sectores de cada organização
sectors: id, tenant_id, name, code, supervisor_id, created_at

-- Utilizadores
users: id, tenant_id, sector_id, email, password_hash,
       full_name, is_active, created_at

-- Roles (padrão + custom por org)
roles: id, tenant_id, name, is_system, created_at
-- is_system=true: ORG_ADMIN, SECTOR_SUPERVISOR, MEMBER

-- Permissões por role
role_permissions: id, role_id, resource, action
-- Ex: resource='documents', action='approve'

-- Atribuição de roles a utilizadores
user_roles: id, user_id, role_id, sector_id, granted_by, created_at

-- Categorias (seed global, não por tenant)
categories: id, name, group, created_at

-- Identificadores únicos
identifiers: id, tenant_id, sector_id, category_id, sequence,
             identifier (VL-PROP-2026-0424-001), issued_to,
             description, status, origin, created_by, created_at
-- status: draft | active | attached | cancelled
-- origin: digital | physical

-- Documentos (ficheiro associado ao identificador)
documents: id, tenant_id, identifier_id, filename, mime_type,
           file_path, file_size, extracted_text, uploaded_by,
           upload_source, created_at
-- upload_source: manual | scanner | sync (upload offline)

-- Partilha de documentos
document_shares: id, document_id, shared_by, shared_with_sector_id,
                 shared_with_user_id, created_at
-- shared_with_sector_id OU shared_with_user_id (um dos dois)

-- Aprovações / workflow
approvals: id, tenant_id, document_id, sector_id, supervisor_id,
           status, notes, requested_at, resolved_at
-- status: pending | approved | rejected

-- Auditoria (imutável)
audit_logs: id, tenant_id, user_id, action, resource,
            resource_id, metadata, ip, created_at

-- Fila offline (SQLite LOCAL na máquina - não no PostgreSQL)
-- upload_queue: id, file_path, identifier, tenant_id,
--               user_id, status, attempts, last_error, created_at
-- status: pending | uploading | uploaded | failed
```

---

## 6. Modelo de Acesso (RBAC)

### Roles de sistema (não editáveis)

| Role | Escopo | Pode fazer |
|---|---|---|
| `ORG_ADMIN` | Toda a organização | Tudo exceto aprovar documentos de outros sectores |
| `SECTOR_SUPERVISOR` | Sector atribuído | Aprovar/rejeitar submissões do sector e cross-sector |
| `MEMBER` | Sector atribuído | Criar, submeter, partilhar documentos do sector |

### Regras de acesso a documentos

1. Criador sempre vê o seu próprio documento
2. Documento partilhado com sector → todos os membros desse sector veem
3. Documento partilhado com utilizador específico → só esse utilizador vê
4. Supervisor vê todos os documentos do seu sector
5. ORG_ADMIN vê todos os documentos da organização
6. Aprovação necessária quando documento vai de sector A para sector B

### Roles custom
- Cada organização pode criar roles adicionais com permissões granulares
- Permissões: `documents:read`, `documents:create`, `documents:approve`,
  `identifiers:generate`, `sectors:manage`, `users:manage`, `audit:read`

---

## 7. Fluxo de um Documento

```
1. GERAR IDENTIFICADOR
   Utilizador (sector X) → POST /identifiers/generate
   → { identifier: "VL-PROP-2026-0424-001", origin: "digital" }

2. INCLUIR NO DOCUMENTO
   O documento (PDF/DOCX) deve conter o texto "VL-PROP-2026-0424-001"

3. ASSOCIAR FICHEIRO
   POST /documents/attach (multipart)
   → API extrai texto → verifica se identificador está presente
   → Se sim: guarda ficheiro, status = "attached"
   → Se não: rejeita com 422

4. PARTILHAR (opcional)
   POST /documents/share
   → { documentId, targetSectorId } OU { documentId, targetUserId }

5. APROVAÇÃO (se cross-sector)
   Sistema cria registo em approvals (status: pending)
   → Supervisor do sector destino recebe notificação SSE
   → PATCH /approvals/:id { status: "approved" | "rejected" }

6. CONSULTAR / DOWNLOAD
   GET /identifiers/VL-PROP-2026-0424-001
   GET /documents/VL-PROP-2026-0424-001/download
```

---

## 8. Fluxo Offline

```
[MÁQUINA DO UTILIZADOR - TAURI]

Utilizador offline
      ↓
Selecciona ficheiro + identificador
      ↓
Rust guarda em SQLite local:
  upload_queue { file_path, identifier, status: "pending" }
      ↓
UI mostra badge "1 ficheiro pendente"

[QUANDO CONEXÃO VOLTA]

Rust detecta network (tauri-plugin-network)
      ↓
Lê fila SQLite (status: "pending")
      ↓
Para cada item:
  1. status → "uploading"
  2. POST /documents/attach com o ficheiro
  3. Sucesso → status → "uploaded" → remove da fila
  4. Erro → status → "failed", attempts++ (max 3)
      ↓
SSE notifica UI do progresso
```

---

## 9. Integração Scanner + IA

```
[FLUXO DE SCAN]

Utilizador clica "Digitalizar documento"
      ↓
Tauri invoca comando Rust scanner.rs
      ↓
Rust abre interface TWAIN/WIA (Windows) / SANE (Linux)
      ↓
Documento digitalizado → PDF/PNG em memória
      ↓
POST /classifier/suggest (envia texto extraído)
      ↓
Groq API (llama-3.3-70b) → analisa texto → sugere categoria
      ↓
UI mostra sugestão com confiança %
  → "Parece ser um Contrato de Prestação de Serviços (CPS) — 87%"
      ↓
Utilizador confirma ou selecciona manualmente
      ↓
Fluxo normal de associação de documento
```

---

## 10. File Watcher (Rastreio de Ficheiros)

```
Tauri inicia watcher (Rust notify crate)
→ Monitoriza pastas configuradas pelo utilizador
→ Detecta ficheiros novos/modificados (.pdf, .docx, .xlsx, etc.)

Para cada ficheiro detectado:
  1. Extrai texto via Rust (pdfium / docx-rs)
  2. Procura padrão regex: /VL-[A-Z]+-\d{4}-\d{4}-\d{3}/
  3a. Encontrou identificador → verifica se está no sistema
       → Se não está: notificação "documento encontrado, anexar?"
       → Opções: [Adicionar agora] [Adicionar mais tarde] [Não pertence]
  3b. Não encontrou identificador → ignora (não é documento do sistema)
```

---

## 11. Contratos e Candidaturas como Perfis

Documentos das categorias `CPS`, `CPF`, `CTR`, `CLA`, e candidaturas (futuro) são renderizados como **perfis** em vez de simples entradas de lista.

### Modos de visualização
- **Simplificado:** card compacto com campos-chave + tags
- **Detalhado:** layout de perfil com secções expandidas, histórico, partilhas

### Tags
- Pré-definidas: `urgente`, `renovação pendente`, `assinado`, `rascunho`, `arquivado`
- Custom: qualquer string definida pelo utilizador

---

## 12. Formato do Identificador

```
VL  -  PROP  -  2026  -  0620  -  001
│      │         │        │        │
│      │         │        │        └── Sequência do dia (3 dígitos)
│      │         │        └────────── Data MMDD
│      │         └─────────────────── Ano
│      └───────────────────────────── Código da categoria
└──────────────────────────────────── Prefixo Verano Labs
```

Em multi-tenant, o prefixo `VL` pode ser substituído pelo prefixo da organização (configurável no onboarding).

---

## 13. Categorias de Documentos (45 total)

| Grupo | ID | Nome |
|---|---|---|
| Comercial | PROP | Proposta Comercial |
| Comercial | FAT | Factura |
| Comercial | REC | Recibo |
| Comercial | NOT | Nota de Crédito |
| Comercial | NDB | Nota de Débito |
| Comercial | ORD | Ordem de Compra |
| Comercial | GUE | Guia de Entrega / Remessa |
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

```env
# Servidor
PORT=3000
NODE_ENV=development

# PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost:5432/docid

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-here
JWT_EXPIRES_IN=7d

# Storage
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=52428800  # 50MB

# Groq (IA)
GROQ_API_KEY=your-groq-key

# SSE
SSE_HEARTBEAT_MS=30000
```

---

## 15. Convenções de Desenvolvimento

### Nomenclatura
- Ficheiros: `kebab-case.ts`
- Componentes React: `PascalCase.tsx`
- Funções/variáveis: `camelCase`
- Constantes: `UPPER_SNAKE_CASE`
- Tabelas DB: `snake_case` (plural)
- Colunas DB: `snake_case`

### Padrões API
- Respostas sempre: `{ data, meta?, error? }`
- Erros: `{ error: { code, message, details? } }`
- Paginação: `?page=1&limit=20` → `{ data, meta: { total, page, limit } }`
- Datas: ISO 8601 (UTC)

### Segurança
- NUNCA retornar `password_hash` em qualquer resposta
- SEMPRE validar `tenant_id` do JWT contra o recurso acedido
- SEMPRE usar prepared statements (Drizzle faz isso por defeito)
- Logs de auditoria são IMUTÁVEIS — sem UPDATE/DELETE na tabela `audit_logs`

### Performance
- Dados buscados na fronteira (módulo/rota), não em cada componente filho
- Usar `Promise.all()` para queries paralelas independentes
- Índices obrigatórios: `tenant_id`, `sector_id`, `identifier`, `status`, `created_at`
- Cache Redis para: categorias (imutáveis), stats, sessões

### Tauri / Rust
- Comandos Rust são assíncronos por defeito (`async fn`)
- Erros Rust → serializar para `{ code: string, message: string }` antes de retornar ao React
- Estado da fila offline → sempre ler do SQLite, nunca do estado React (fonte de verdade)

---

## 16. O Que Já Existe (DocID v1)

A API base já tem implementado:
- `GET /categories` — listar categorias agrupadas
- `POST /identifiers/generate` — gerar identificador
- `GET /identifiers` — listar com filtros
- `GET /identifiers/:identifier` — consultar
- `PATCH /identifiers/:identifier/cancel` — cancelar
- `POST /documents/attach` — associar documento (com verificação de texto)
- `GET /documents/:identifier` — metadados
- `GET /documents/:identifier/download` — download
- `GET /audit` — logs
- `GET /stats` — estatísticas

**O que NÃO existe ainda:** multi-tenancy, auth, sectores, RBAC, partilha, aprovações, offline sync, Tauri app, scanner, file watcher, classificação IA.

---

## 17. Princípio Guia

> O maior problema de performance raramente está no código — está na arquitectura.
> Antes de optimizar renderizações, perguntar: onde os dados estão a ser buscados?
> Dados na fronteira da página com `Promise.all()` > cada componente a fazer o seu próprio request.
