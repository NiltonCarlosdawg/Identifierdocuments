# DocID Admin — painel da provedora

Frontend da empresa provedora: pedidos de subscrição, planos, organizações e licenças.

## Arranque

```bash
cd apps/admin
bun install
VITE_API_URL=http://127.0.0.1:3000 bun run dev
```

A app abre em `http://127.0.0.1:5174`.

## Credenciais

Crie um utilizador do painel na base usada pela API:

```bash
cd ../api
bun run provider:create -- <email> <password> [nome]
```

O painel não guarda credenciais no repositório; o token fica no `localStorage` do browser.

## Variáveis

- `VITE_API_URL` — URL da API (por omissão `http://127.0.0.1:3002`).
- Na API, `ADMIN_ORIGIN` — origem do painel em produção (ex.: `https://admin.docid.milvendas.ao`).

## Produção

Publicado em `https://docid.milvendas.ao/admin/`, automaticamente em cada push para `main`
(workflow *Deploy DocID*, construído com `VITE_API_URL=https://didall.milvendas.ao`).

## Testes E2E

```bash
# com a API em http://127.0.0.1:3002 e o utilizador admin@docid.local / testpass123
bun run test:e2e:admin   # a partir da raiz; arranca o preview do painel em :5174
```

