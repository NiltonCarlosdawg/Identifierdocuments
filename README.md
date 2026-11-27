# Verano Labs — DocID Platform

Plataforma de gestão de documentos empresariais com rastreabilidade de ponta a ponta,
várias organizações isoladas, controlo de acesso por sector e numeração fiscal válida
mesmo sem internet.

> **DocID** resolve um problema real no mercado angolano: documentos empresariais
> (contratos, propostas, facturas) circulam pelo WhatsApp, email e pastas soltas, sem
> rastreabilidade, perdem-se, duplicam-se e não têm controlo de acesso por sector — e
> continuam a precisar de numeração fiscal válida quando o computador não tem rede.

Em produção: API em `https://didall.milvendas.ao`, site, downloads e painel da provedora em
`https://docid.milvendas.ao`. App desktop na versão **1.2.7** (Windows e Linux).

## Funcionalidades principais

- **Identificador antes do documento** — cada documento recebe um identificador único
  (`VL-PROP-2026-0424-001`) antes de ser emitido. Ao anexar o ficheiro, a API procura o
  identificador no texto e regista o resultado, mas já não o exige (desde 25/11/2026).
- **Várias organizações com isolamento na base de dados** — Row Level Security do
  PostgreSQL em todas as tabelas com dados de uma organização; o utilizador da API em
  produção não tem `BYPASSRLS` (ver [`docs/RLS_PRODUCAO.md`](docs/RLS_PRODUCAO.md)).
- **Numeração fiscal offline** — as categorias fiscais (FAT, REC, NOT, NDB, GUE, ORD) usam
  lotes de números reservados por computador, conforme os Decretos Presidenciais 292/18 e
  71/25; números devolvidos só são reaproveitados se a ordem cronológica o permitir.
- **Offline primeiro** — leitura a partir de cache encriptada, fila de uploads, fila de
  escritas com idempotência e downloads em cache; tudo sincroniza sozinho, sempre com a
  sessão de quem criou cada item.
- **Documentos com versões e anexos**, tags e perfis para contratos.
- **Partilha entre sectores com aprovação** do supervisor e pedidos de acesso a
  documentos restritos; notificações em tempo real (SSE) e por e-mail.
- **Vigilância de pastas, scanner e impressoras** no desktop; classificação de categoria
  por IA (Groq) com registo de feedback.
- **Licenças e subscrições** — planos em Kwanzas, período de teste, modo só consulta,
  checkout na landing e painel da provedora (`apps/admin`).
- **Auditoria** de todas as acções, com exportação CSV/JSON.

## Repositório

| Pasta | O que é |
|---|---|
| [`apps/api`](apps/api) | API (Bun/Elysia em desenvolvimento, `node dist/index.js` em produção) — [README](apps/api/README.md) |
| [`apps/desktop`](apps/desktop) | App desktop Tauri v2 (React + Rust + SQLite local) — [actualizações e releases](apps/desktop/UPDATER.md) |
| [`apps/admin`](apps/admin) | Painel da provedora (planos, pedidos, organizações, licenças) — [README](apps/admin/README.md) |
| [`apps/landing`](apps/landing) | Site público com downloads e checkout — [README](apps/landing/README.md) |
| [`packages/types`](packages/types) | Tipos TypeScript partilhados |
| [`e2e`](e2e) | Testes Playwright (desktop e painel, contra uma API real) |
| [`scripts`](scripts) | Versão do desktop, publicação na landing, verificação do instalador |

## Stack

| Camada | Tecnologia |
|---|---|
| Desktop | Tauri v2, React 18 + Vite + TailwindCSS (componentes próprios em `docid-ui.tsx`, não shadcn/ui), Rust, SQLite (`rusqlite`) |
| API | Elysia + Drizzle ORM; Bun em desenvolvimento e testes, bundle Node em produção (cPanel/CloudLinux) |
| Dados | PostgreSQL 16+ com RLS (produção em PostgreSQL 13), Redis opcional (rate limit, BullMQ) |
| Auth | JWT (`jose`), sessão máxima de 7 dias; no desktop, chave de encriptação local no cofre do sistema (Windows e macOS) |
| IA | Groq API (llama-3.3-70b) |
| Tempo real | SSE; e-mails por fila transaccional em PostgreSQL |

## Operação

- **Deploy da API, landing e painel:** automático em cada push para `main` (workflow
  *Deploy DocID*): gera o bundle, aplica migrações pendentes com o dono das tabelas,
  reinicia e confirma o `/health`, repondo o código anterior se algo falhar.
- **Publicar o desktop:** `bash scripts/bump-desktop-version.sh X.Y.Z` e merge para
  `main`; o workflow *Build & Release* gera os instaladores, publica-os no site e só no
  fim os anuncia ao auto-update ([`apps/desktop/UPDATER.md`](apps/desktop/UPDATER.md)).
- **CI:** typecheck e testes da API e do desktop, testes Rust (Linux e Windows) e E2E.

## Documentação

- [`docs/CLAUDE.md`](docs/CLAUDE.md) — arquitectura e regras do sistema (fonte de verdade técnica)
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — estado por fase
- [`docs/DESCRICAO_TECNICA.md`](docs/DESCRICAO_TECNICA.md) — resumo técnico de 2 páginas (PDF: `bash scripts/docs-to-pdf.sh docs/DESCRICAO_TECNICA.md docs/Descricao_Tecnica_DocID.pdf`)
- [`docs/LICENCAS.md`](docs/LICENCAS.md) · [`docs/NOTIFICACOES_EMAIL.md`](docs/NOTIFICACOES_EMAIL.md) · [`docs/RLS_PRODUCAO.md`](docs/RLS_PRODUCAO.md)
- [`docs/offline-persistence-invariants.md`](docs/offline-persistence-invariants.md) — regras da persistência offline
- [`docs/pesquisa-mercado-docid.md`](docs/pesquisa-mercado-docid.md) — mercado, concorrência e regulamentação

## Estado do projecto

Em desenvolvimento activo e em produção. Pendências principais em
[`docs/BACKLOG.md`](docs/BACKLOG.md): confirmação por um contabilista angolano das
categorias fiscais com numeração sequencial, testes manuais em runtime dos fluxos offline,
monitorização própria (Fase 15) e assinatura do instalador Windows (Authenticode) e do
macOS (Apple Developer).
