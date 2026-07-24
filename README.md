# Verano Labs — DocID Platform

Plataforma desktop de gestão de documentos empresariais com rastreabilidade
fim-a-fim, multi-tenancy, RBAC, geração de identificadores fiscalmente
válidos (mesmo offline), e classificação por IA.

> **DocID** resolve um problema real no mercado angolano: documentos
> empresariais (contratos, propostas, facturas, etc.) circulam sem
> rastreabilidade, perdem-se, são duplicados, e não têm controlo de acesso
> por sector — e continuam a precisar de numeração fiscalmente válida mesmo
> quando o dispositivo não tem ligação à internet.

## Funcionalidades principais

- **Multi-tenancy com isolamento reforçado por Row Level Security** — o
  isolamento entre organizações não depende só de filtros na aplicação;
  é imposto ao nível da base de dados (Postgres RLS), com testes de
  concorrência dedicados a confirmar zero fuga de dados entre tenants.
- **Geração de identificadores fiscalmente válidos, mesmo offline** —
  categorias fiscais (Factura, Recibo, Nota de Crédito/Débito, e outras
  identificadas por análise jurídica) mantêm numeração sequencial e
  cronológica em conformidade com o Decreto Presidencial 292/18 e 71/25,
  através de um mecanismo de reserva antecipada de lotes de sequência por
  dispositivo — sem depender de ligação constante à internet e sem risco
  de identificadores duplicados entre dispositivos.
- **Sincronização offline-first** — documentos e identificadores gerados
  sem rede são enfileirados localmente e sincronizados automaticamente ao
  reconectar, com retry, backoff exponencial, e recuperação de itens
  presos após um encerramento inesperado da aplicação.
- **Vigilância automática de pastas** — deteta identificadores em
  ficheiros novos ou já existentes numa pasta monitorizada (extracção de
  texto nativa em Rust, sem depender de rede), evitando notificações
  repetidas para ficheiros já processados.
- **Integração de scanner** — digitalização directa de documentos físicos
  a partir da aplicação desktop.
- **Classificação de documentos por IA** (Groq) — sugestão automática de
  categoria com nível de confiança, e registo de feedback do utilizador
  (aceitação ou correcção) para acompanhamento de precisão ao longo do
  tempo.
- **RBAC por sector** — permissões e visibilidade de documentos por
  sector, com fluxo de aprovação dedicado para partilhas entre sectores
  diferentes e pedidos de acesso a documentos restritos.
- **Auditoria completa** — registo de todas as acções relevantes, com
  exportação para CSV/JSON sujeita a limite de utilização.

## Stack

| Camada | Tecnologia |
|---|---|
| Desktop runtime | Tauri v2 |
| Desktop UI | React + Vite + TailwindCSS |
| Desktop core | Rust |
| Persistência local (offline) | SQLite (via `rusqlite`) |
| API runtime | Bun |
| API framework | Elysia |
| ORM | Drizzle ORM |
| Base de Dados | PostgreSQL 16+ (com Row Level Security) |
| Cache | Redis 7+ |
| Auth | JWT (jose) |
| IA classificação | Groq API (llama-3.3-70b) |
| Real-time | SSE |

> **Nota:** a UI desktop usa componentes Tailwind próprios (`docid-ui.tsx`
> — `PageHeader`, `Modal`, `StatusChip`, `EmptyState`, `Pagination`, etc.),
> não `shadcn/ui`. Se o projecto vier a adoptar `shadcn/ui` no futuro,
> actualizar esta tabela nessa altura.

## Arquitectura (resumo)

- **Backend**: multi-tenant com RLS activo em todas as tabelas com
  `tenantId`, acesso à base de dados sempre através de uma transacção com
  `SET LOCAL app.current_tenant` (helper `withTenant`), nunca acesso
  directo fora desse contexto em rotas autenticadas.
- **Desktop**: arquitectura hexagonal no frontend (domain / application /
  infrastructure / interfaces), com injecção de dependência centralizada
  num único módulo de composição (`infrastructure/di/container.ts`) —
  evita instâncias soltas de clientes HTTP ou adapters Tauri espalhadas
  pelo código.
- **Geração de identificadores**: dividida em dois caminhos consoante a
  categoria do documento —
  - Categorias com exigência legal de sequência: reserva de lotes
    (*lease*) por dispositivo, com pool de reaproveitamento de fragmentos
    devolvidos e não usados.
  - Restantes categorias: geração local mais simples, sem reserva prévia,
    com o número final confirmado apenas na sincronização.

## Repositórios

- **API:** [`apps/api/`](./apps/api) — [README](./apps/api/README.md)
- **Desktop:** [`apps/desktop/`](./apps/desktop)
- **Types:** [`packages/types/`](./packages/types)

## Documentação

- [`CLAUDE.md`](./CLAUDE.md) — Arquitectura completa do sistema
- [`BACKLOG.md`](./BACKLOG.md) — Backlog organizado por fases
- `apps/api/README.md` — Documentação detalhada da API

## Estado do projecto

Em desenvolvimento activo. Consultar `BACKLOG.md` para o estado detalhado
por fase, incluindo pendências conhecidas (ex.: confirmação profissional
da classificação de categorias fiscais para numeração sequencial, e
cobertura de testes de alguns caminhos de sincronização nativa).
