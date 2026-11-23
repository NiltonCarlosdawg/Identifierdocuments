# DocID Admin — painel da provedora

Frontend da empresa provedora: pedidos de subscrição, planos, organizações e licenças.

## Arranque

```bash
cd apps/admin
bun install
VITE_API_URL=http://127.0.0.1:3002 npm run dev
```

A app abre em `http://127.0.0.1:5174`.

## Credenciais locais

Utilizador de teste criado na base local: `admin@docid.local` / `testpass123`.
Em produção, criar com `bun run provider:create -- <email> <password>`.

## Variáveis

- `VITE_API_URL` — URL da API (por omissão `http://127.0.0.1:3002`).
- Na API, `ADMIN_ORIGIN` — origem do painel em produção (ex.: `https://admin.docid.milvendas.ao`).
