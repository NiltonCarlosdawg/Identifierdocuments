# Verano Labs — DocID Platform

Plataforma desktop de gestão de documentos empresariais com rastreabilidade fim-a-fim, multi-tenancy, RBAC e classificação por IA.

> **DocID** resolve um problema real no mercado angolano: documentos empresariais (contratos, propostas, facturas, etc.) circulam sem rastreabilidade, perdem-se, são duplicados, e não têm controlo de acesso por sector.

## Stack

| Camada | Tecnologia |
|---|---|
| Desktop runtime | Tauri v2 |
| Desktop UI | React + Vite + TailwindCSS + shadcn/ui |
| Desktop core | Rust |
| API runtime | Bun |
| API framework | Elysia |
| ORM | Drizzle ORM |
| Base de Dados | PostgreSQL 16+ |
| Cache | Redis 7+ |
| Auth | JWT (jose) |
| IA classificação | Groq API (llama-3.3-70b) |
| Real-time | SSE |

## Repositórios

- **API:** [`apps/api/`](./apps/api) — [README](./apps/api/README.md)
- **Desktop:** [`apps/desktop/`](./apps/desktop)
- **Types:** [`packages/types/`](./packages/types)

## Documentação

- [`CLAUDE.md`](./CLAUDE.md) — Arquitectura completa do sistema
- [`BACKLOG.md`](./BACKLOG.md) — Backlog organizado por fases
- `apps/api/README.md` — Documentação detalhada da API
