# RLS em produção: utilizador da base de dados

O isolamento entre organizações é feito por Row Level Security no PostgreSQL. **Só funciona
se a API ligar com um utilizador que não seja superutilizador nem tenha `BYPASSRLS`.** Esses
papéis ignoram todas as policies, mesmo com `FORCE ROW LEVEL SECURITY`.

A API verifica isto no arranque (`src/db/role-check.ts`):

- papel com bypass em produção → `logger.error` com `[SEGURANÇA]`;
- com `REQUIRE_RLS_ROLE=true` no `.env` → a API recusa arrancar.

## Confirmar o papel actual

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

Se `rolsuper` ou `rolbypassrls` for `t`, o RLS não está a proteger nada.

## Passar a um papel sem bypass

Correr como superutilizador (no cPanel: o utilizador dono da base). Substituir `docid` pelo
nome da base e gerar uma password forte.

```sql
CREATE ROLE docid_app LOGIN PASSWORD '<password-forte>' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE docid TO docid_app;
GRANT USAGE ON SCHEMA public TO docid_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO docid_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO docid_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO docid_app;
-- Tabelas criadas por migrações futuras (o dono continua a ser quem corre as migrações):
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO docid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO docid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO docid_app;
```

Depois:

1. As **migrações** continuam a correr com o utilizador dono (precisa de `CREATE`/`ALTER`).
2. O `DATABASE_URL` do processo da API passa a usar `docid_app`.
3. Reiniciar a API e confirmar que o log não mostra o aviso `[SEGURANÇA]`.
4. Fazer login, abrir documentos e o painel da provedora (usa o pool `lookupDb`, com
   `app.auth_lookup = on`, que não precisa de bypass).
5. Quando estiver confirmado, pôr `REQUIRE_RLS_ROLE=true` no `.env`.

## O que os testes cobrem

- `rls-coverage.integration.test.ts`: todas as tabelas com `tenant_id` e as tabelas filhas
  (`document_shares`, `user_roles`, `role_permissions`) têm RLS activo e forçado; com um papel
  sem bypass, as linhas de outra organização não aparecem. `orders` é excepção deliberada:
  é uma tabela da plataforma (provedora e checkout público).
- `auth-lookup.integration.test.ts`: login e pool de lookup funcionam sem bypass.

A maioria dos outros testes corre com o utilizador do CI, que é superutilizador: não provam
o isolamento.
