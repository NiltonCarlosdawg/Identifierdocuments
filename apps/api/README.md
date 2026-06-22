# Verano Labs — DocID API v2

API multi-tenant de gestão de documentos empresariais com autenticação JWT, RBAC e RLS.

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Elysia](https://elysiajs.com)
- **ORM:** [Drizzle ORM](https://orm.drizzle.team)
- **Base de Dados:** PostgreSQL 16+
- **Cache:** Redis 7+
- **Docs:** Swagger UI em `/docs`

---

## Instalação e Arranque

```bash
# Instalar dependências
bun install

# Copiar e configurar variáveis de ambiente
cp .env.example .env

# Correr migrations
bun run db:migrate

# Popular categorias (opcional)
bun run db:seed

# Iniciar em modo desenvolvimento (com hot-reload)
bun dev

# Iniciar em produção
bun start
```

A API fica disponível em `http://localhost:3000`
Swagger UI: `http://localhost:3000/docs`

---

## Variáveis de Ambiente

```env
PORT=3000
NODE_ENV=development

# PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost:5432/docid

# Redis (opcional)
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-here
JWT_EXPIRES_IN=7d

# Storage
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=52428800  # 50MB

# Groq (IA para classificação)
GROQ_API_KEY=your-groq-key

# SSE
SSE_HEARTBEAT_MS=30000
```

---

## Estrutura do Projecto

```
src/
├── index.ts                        # Entry point — Elysia app
├── db/
│   ├── index.ts                    # Conexão PostgreSQL
│   ├── schema.ts                   # Schema Drizzle (todas as tabelas)
│   └── migrations/                 # Migrations Drizzle Kit
├── middleware/
│   ├── auth.ts                     # Validação JWT
│   ├── tenant.ts                   # Injecção de tenant_id (RLS)
│   └── rateLimit.ts                # Rate limiting por IP
├── modules/
│   ├── auth.module.ts              # Login, perfil, alterar password
│   ├── tenants.module.ts           # Gestão de organizações
│   ├── sectors.module.ts           # Gestão de sectores
│   ├── users.module.ts             # Gestão de utilizadores
│   ├── roles.module.ts             # Roles e permissões
│   ├── categories.module.ts        # Categorias de documentos
│   ├── identifiers.module.ts       # Geração e consulta de IDs
│   ├── documents.module.ts         # Upload, download, partilha
│   ├── approvals.module.ts         # Workflow de aprovação
│   ├── audit.module.ts             # Log de operações
│   ├── stats.module.ts             # Métricas
│   └── classifier.module.ts        # Classificação por IA (Groq)
└── services/
    ├── auth.service.ts             # Lógica de autenticação
    ├── identifier.service.ts       # Geração e consulta de IDs
    ├── document.service.ts         # Extração de texto (PDF / DOCX / TXT)
    ├── attachment.service.ts       # Upload, verificação e associação
    ├── classifier.service.ts       # Classificação via Groq API
    └── notification.service.ts     # Notificações SSE em tempo real
```

---

## Fluxo Principal

```
1. (Opcional) Criar organização
   POST /tenants  (onboarding sem auth)

2. Autenticar
   POST /auth/login → JWT token

3. Gerar identificador
   POST /identifiers/generate
   { "categoryId": "PROP", "issuedTo": "Cliente", "origin": "digital" }
   → { identifier: "TST-PROP-2026-0424-001" }

4. Incluir o identificador no documento (PDF, DOCX, TXT, etc.)
   O documento DEVE conter o texto "TST-PROP-2026-0424-001"

5. Associar o documento ao identificador
   POST /documents/attach  (multipart/form-data)
   { identifier: "TST-PROP-2026-0424-001", file: <ficheiro> }
   → Verifica se o identificador está no conteúdo do ficheiro
   → Se encontrado: guarda e marca como "attached"
   → Se não encontrado: rejeita com erro 422

6. Partilhar com outro sector (opcional)
   POST /documents/:identifier/share
   → Cria registo de aprovação se for cross-sector

7. Consultar / Download
   GET /identifiers/TST-PROP-2026-0424-001
   GET /documents/TST-PROP-2026-0424-001/download
```

---

## Modelo de Acesso (RBAC)

| Role | Escopo | Permissões |
|---|---|---|
| `ORG_ADMIN` | Toda a organização | Tudo exceto aprovar docs de outros sectores |
| `SECTOR_SUPERVISOR` | Sector atribuído | Aprovar/rejeitar submissões |
| `MEMBER` | Sector atribuído | Criar, submeter, partilhar documentos |

---

## Endpoints Principais

### Sistema
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Health check básico |
| GET | `/health` | Health check detalhado (uptime, versão) |

### Autenticação
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/auth/login` | Login (email + password) → JWT |
| GET | `/auth/me` | Perfil do utilizador autenticado |
| PATCH | `/auth/me/password` | Alterar password |

### Organizações
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/tenants` | Criar organização (onboarding público) |
| GET | `/tenants/:id` | Detalhes da organização |
| PATCH | `/tenants/:id` | Actualizar organização |

### Sectores
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/sectors` | Listar sectores |
| POST | `/sectors` | Criar sector |
| PATCH | `/sectors/:id` | Actualizar sector |
| PATCH | `/sectors/:id/supervisor` | Definir supervisor |

### Utilizadores
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/users` | Listar utilizadores |
| POST | `/users` | Criar utilizador |
| PATCH | `/users/:id` | Actualizar utilizador |
| POST | `/users/:id/roles` | Atribuir role |

### Roles
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/roles` | Listar roles |
| POST | `/roles` | Criar role custom |

### Categorias
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/categories` | Listar todas (agrupadas) |
| GET | `/categories/:id` | Obter categoria por ID |

### Identificadores
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/identifiers/generate` | Gerar novo identificador |
| GET | `/identifiers` | Listar (filtros: categoria, status, ano) |
| GET | `/identifiers/:identifier` | Consultar identificador |
| PATCH | `/identifiers/:identifier/cancel` | Cancelar identificador |

### Documentos
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/documents/attach` | Associar documento (multipart) |
| GET | `/documents/:identifier` | Consultar metadados |
| GET | `/documents/:identifier/download` | Download do ficheiro |
| POST | `/documents/:identifier/share` | Partilhar com sector/utilizador |
| GET | `/documents/:identifier/shares` | Histórico de partilhas |
| DELETE | `/documents/:identifier/shares/:shareId` | Revogar partilha |

### Aprovações
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/approvals` | Listar aprovações |
| PATCH | `/approvals/:id` | Aprovar/rejeitar |

### Classificador IA
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/classifier/suggest` | Sugerir categoria por IA (Groq) |

### Notificações
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/notifications` | Histórico de notificações |
| PATCH | `/notifications/:id/read` | Marcar como lida |
| GET | `/notifications/stream` | SSE em tempo real |

### Auditoria & Stats
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/audit` | Logs de auditoria |
| GET | `/stats` | Estatísticas gerais |

---

## Exemplos com cURL

```bash
# 1. Health check
curl http://localhost:3000/health

# 2. Criar organização (onboarding)
curl -X POST http://localhost:3000/tenants \
  -H "Content-Type: application/json" \
  -d '{"name":"Minha Empresa","adminEmail":"admin@empresa.com","adminPassword":"123456"}'

# 3. Login
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","password":"123456"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

# 4. Listar categorias (autenticado)
curl http://localhost:3000/categories \
  -H "Authorization: Bearer $TOKEN"

# 5. Gerar identificador
curl -X POST http://localhost:3000/identifiers/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"categoryId":"PROP","issuedTo":"Cliente","origin":"digital"}'

# 6. Associar documento
curl -X POST http://localhost:3000/documents/attach \
  -H "Authorization: Bearer $TOKEN" \
  -F "identifier=VL-PROP-2026-0001-001" \
  -F "file=@/caminho/para/proposta.pdf" \
  -F "uploadSource=manual"

# 7. Sugerir categoria por IA
curl -X POST http://localhost:3000/classifier/suggest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"Contrato de prestação de serviços...","filename":"contrato.pdf"}'
```

---

## Categorias de Documentos (45)

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

## Testes

```bash
# Correr todos os testes
RATE_LIMIT_MAX=100 bun test

# O RATE_LIMIT_MAX evita rate limiting durante os testes
```
