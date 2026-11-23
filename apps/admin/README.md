# DocID Admin — painel da provedora

Frontend da empresa provedora: pedidos de subscrição, planos, organizações e licenças.

## Arranque

```bash
cd apps/admin
bun install
VITE_API_URL=http://127.0.0.1:3000 npm run dev
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
