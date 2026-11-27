# Verano Labs — DocID API

API multi-organização de gestão de documentos empresariais: autenticação JWT, RBAC por
sector, isolamento por Row Level Security, geração de identificadores (também offline),
documentos com versões, partilha com aprovação, notificações, licenças e subscrições.

Arquitectura e regras: [`docs/CLAUDE.md`](../../docs/CLAUDE.md).

## Stack

- **Framework:** [Elysia](https://elysiajs.com) + [Drizzle ORM](https://orm.drizzle.team)
- **Runtime:** [Bun](https://bun.sh) em desenvolvimento e testes; em produção, bundle Node
  (`node dist/index.js`, ver *Produção*)
- **Base de Dados:** PostgreSQL 16+ (RLS)
- **Redis 7+:** opcional (rate limit partilhado, BullMQ para thumbnails)
- **Docs:** Swagger UI em `/docs` fora de produção (em produção só com `ENABLE_SWAGGER=true`)

---

## Desenvolvimento

Corra a partir da raiz do repositório (`bun install` instala todo o workspace).

```bash
cd apps/api
cp .env.example .env        # ajustar DATABASE_URL e JWT_SECRET
bun run db:migrate          # migrações
bun run db:seed             # categorias, roles de sistema e plano free
bun dev                     # http://localhost:3000 (hot reload)
```

- Painel da provedora: `bun run provider:create -- <email> <password> [nome]`.
- Criar organizações: com `ALLOW_PUBLIC_ONBOARDING=true`, ou com o cabeçalho
  `x-onboarding-secret` igual a `ONBOARDING_SECRET`.
- Variáveis: todas comentadas em [`.env.example`](.env.example); as principais em
  `docs/CLAUDE.md` §14.

## Testes

```bash
NODE_ENV=test bun test                      # tudo (precisa de PostgreSQL com seed)
bun test src/__tests__/<ficheiro>.test.ts   # um ficheiro
```

- `NODE_ENV=test` desliga os limites de pedidos.
- Use uma base própria para testes: os testes de integração criam organizações e dados.
- O utilizador do CI é superutilizador e ignora o RLS. Os testes que provam o isolamento
  (`rls-coverage`, `rls-app-role`, `auth-lookup`) criam papéis sem `BYPASSRLS`;
  `rls-app-role` arranca a própria API com esse papel.

---

## Estrutura

```
src/
├── index.ts          # Elysia: CORS, auth, tenant, licenseGuard, módulos, workers
├── db/               # schema, withTenant, migrate, seed, role-check, migrations/
├── middleware/       # auth (JWT, roles frescas), tenant, licenseGuard, rateLimit
├── modules/          # rotas por domínio (ver abaixo)
├── services/         # regras de negócio (identificadores, leases, pool de números,
│                     #   anexos, acesso, subscrições, licenças, pedidos, e-mail, IA)
├── jobs/             # e-mails, lembretes de renovação, filas BullMQ
└── lib/              # cors, ip, logger, data e prefixo dos identificadores, …
scripts/
├── deploy-server.sh      # deploy no servidor (chamado pelo workflow Deploy DocID)
├── apply-migrations.mjs  # migrações em produção, com o dono das tabelas
└── loadtest/             # testes de carga e de isolamento entre organizações
```

---

## Fluxo principal

```
POST /auth/login                          → token
POST /identifiers/generate                → "VL-PROP-2026-0424-001"
  (o identificador vai no documento)
POST /documents/attach (multipart)        → documento principal, versão 1
  A API procura o identificador no texto e devolve o resultado em `verification`,
  mas aceita o ficheiro mesmo sem ele (desde 25/11/2026).
POST /documents/:param/share              → partilha; noutro sector cria aprovação
PATCH /approvals/:id                      → aprovar / rejeitar
GET /documents/:param/download
```

`:param` aceita o id do documento ou o identificador.

---

## Rotas

### Sistema
| Método | Rota | Descrição |
|---|---|---|
| GET | `/` · `/health` | Estado do processo (não verifica a BD) |

### Autenticação
| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/login` | Login (limites por IP+email e por email) |
| POST | `/auth/refresh` | Renova o token (até `SESSION_MAX_AGE_HOURS` desde o login) |
| POST | `/auth/forgot-password` · `/auth/reset-password` | Recuperar password por código |
| GET · PATCH | `/auth/me` | Perfil |
| PATCH | `/auth/me/password` | Mudar password (devolve token novo; invalida os antigos) |
| PATCH | `/auth/me/notifications-preferences` | Preferências de notificação |

Não há logout no servidor: a app apaga o token e as credenciais locais.

### Organização
| Método | Rota | Descrição |
|---|---|---|
| POST | `/tenants` | Onboarding (ver *Desenvolvimento*) |
| GET · PATCH | `/tenants/me` | Dados da organização; prefixo bloqueado depois do 1.º identificador |
| GET | `/tenants/me/license` · `/tenants/me/stats` | Licença e estatísticas |

### Sectores, utilizadores e roles
| Método | Rota | Descrição |
|---|---|---|
| GET · POST | `/sectors` | Listar / criar |
| GET · PATCH · DELETE | `/sectors/:id` | Detalhe / editar / apagar |
| GET | `/sectors/:id/members` | Membros |
| PATCH | `/sectors/:id/supervisor` | Definir supervisor |
| GET · POST | `/users` | Listar / criar |
| POST | `/users/invite` · `/users/import` | Convite por e-mail · importação CSV |
| GET · PATCH · DELETE | `/users/:id` | Detalhe / editar / desactivar |
| PATCH | `/users/:id/sector` | Mudar de sector |
| POST · DELETE | `/users/:id/roles` · `/users/:id/roles/:roleId` | Atribuir / retirar role |
| GET · POST | `/roles` | Listar / criar role custom |
| GET | `/roles/:id/users` | Utilizadores com a role |
| PATCH · DELETE | `/roles/:id/permissions` · `/roles/:id` | Permissões / apagar |

### Categorias e identificadores
| Método | Rota | Descrição |
|---|---|---|
| GET | `/categories` · `/categories/:id` | 42 categorias |
| POST | `/identifiers/generate` | Gerar (quota mensal do plano) |
| GET | `/identifiers` · `/identifiers/:identifier` | Listar / consultar |
| PATCH | `/identifiers/:identifier/cancel` | Cancelar |
| POST | `/identifiers/lease` | Reservar lote de números fiscais para um dispositivo |
| POST | `/identifiers/release` · `/identifiers/force-release` | Devolver lote / libertar lote de dispositivo perdido (ORG_ADMIN) |
| POST | `/identifiers/register-offline` | Registar identificadores fiscais emitidos offline |
| POST | `/identifiers/register-offline-loose` | Registar identificador não fiscal criado offline |

### Dispositivos
| Método | Rota | Descrição |
|---|---|---|
| GET · POST | `/devices` | Listar / registar |
| PATCH | `/devices/:id` · `/devices/:id/deactivate` | Editar / desactivar (ORG_ADMIN) |

### Documentos
| Método | Rota | Descrição |
|---|---|---|
| POST | `/documents/attach` | Documento principal (multipart) |
| POST | `/documents/attachments` | Anexo a um identificador com documento principal |
| GET | `/documents` | Listar (um principal por identificador) |
| GET | `/documents/:param` | Metadados, versões e anexos |
| GET | `/documents/:param/download` · `/documents/:param/thumbnail` | Ficheiro / miniatura |
| POST | `/documents/:param/versions` | Nova versão |
| GET | `/documents/:param/versions/:version/download` | Versão específica |
| PATCH | `/documents/:param/tags` | Tags |
| POST · GET | `/documents/:param/share` · `/documents/:param/shares` | Partilhar / histórico |
| PATCH | `/documents/:param/shares/:shareId/revoke` | Revogar partilha |
| POST · GET | `/documents/:param/request-access` · `/documents/:param/access-requests` | Pedir acesso / listar pedidos |
| PATCH · POST | `/documents/:param/access-requests/:requestId` · `…/cancel` | Decidir / cancelar pedido |

### Aprovações, notificações, auditoria e IA
| Método | Rota | Descrição |
|---|---|---|
| GET | `/approvals` · `/approvals/:id` | Listar / detalhe |
| PATCH | `/approvals/:id` | Aprovar / rejeitar |
| GET | `/notifications` · `/notifications/stream` | Histórico / SSE |
| PATCH | `/notifications/:id/read` | Marcar como lida |
| GET | `/audit` · `/audit/export` | Logs / exportação CSV (5 por hora) |
| GET | `/stats` · `/stats/export` | Estatísticas / exportação JSON |
| POST | `/classifier/suggest` · `/classifier/feedback` | Sugerir categoria / registar feedback |

### E-mail da organização ([`docs/NOTIFICACOES_EMAIL.md`](../../docs/NOTIFICACOES_EMAIL.md))
| Método | Rota | Descrição |
|---|---|---|
| GET · PUT · DELETE | `/email/settings` | Configuração SMTP da organização |
| POST | `/email/settings/test` | Enviar e-mail de teste |
| GET | `/email/logs` · POST `/email/logs/:id/retry` | Histórico / reenviar |
| GET | `/email-links/download` | Link assinado do e-mail (público) |

### Comercial
| Método | Rota | Descrição |
|---|---|---|
| GET | `/plans` | Planos públicos (landing) |
| POST | `/subscriptions/checkout-token` | Link de checkout a partir da app |
| GET | `/subscriptions/checkout` | Dados do checkout |
| POST | `/orders` | Pedido de subscrição (público): de uma organização existente (token, slug ou e-mail) ou de um cliente novo sem conta (`companyName`, `contactName`) |
| POST | `/provider/login` | Login do painel da provedora |
| GET · POST · PUT | `/provider/plans` · `/provider/plans/:id` | Planos |
| GET · POST | `/provider/orders` · `…/:id/approve` · `…/:id/reject` | Pedidos |
| GET · POST | `/provider/tenants` · `…/:id/suspend` · `…/:id/reactivate` | Organizações |
| GET · PATCH | `/provider/licenses` · `/provider/licenses/:number` | Licenças |
| GET · PATCH | `/platform/licenses` · `/platform/licenses/:licenseNumber` | Licenças via `x-platform-admin-token` ([`docs/LICENCAS.md`](../../docs/LICENCAS.md)) |

---

## Produção

- Servidor cPanel/CloudLinux; a API corre `node dist/index.js`, mantida por `run.sh` (cron a cada
  minuto) e `supervisor.sh`, que partilham o `watchdog.lock`.
- Deploy automático em cada push para `main` (workflow *Deploy DocID* →
  `scripts/deploy-server.sh`): recusa se as dependências mudarem, guarda o código actual, aplica
  migrações com `scripts/apply-migrations.mjs`, reinicia com o lock do watchdog e confirma o
  `/health`, repondo o código anterior se algo falhar.
- Nunca correr `src/db/migrate.ts` em produção nem ler o `docid-api.log` inteiro: a conta tem
  limite de I/O e isso já deixou a API sem resposta.
- Utilizador da BD sem `BYPASSRLS`: [`docs/RLS_PRODUCAO.md`](../../docs/RLS_PRODUCAO.md).
