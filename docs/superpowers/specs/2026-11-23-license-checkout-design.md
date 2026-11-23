# Design — Licenças com checkout self-service

Data: 2026-11-23. Branch: `license-checkout`.

## Intenção

Manter o checkout self-service (escolha de plano → pedido → aprovação manual da provedora),
mas passar a **licença** a ser a fonte única do direito de uso. Os planos continuam a ser o
catálogo de preços/limites; a licença é o estado comercial do tenant.

## Decisões

- `plans` = catálogo; `orders` = pedido pendente; `licenses` = direito de uso.
- Aprovar um pedido cria/atualiza a licença (número, validade, `max_users`, plano).
- Estado mostrado na app e limites impostos pela API derivam da licença.
- Trial: 14 dias e 5 utilizadores; tolerância de 7 dias em só-leitura; suspensão imediata.
- Tenants existentes recebem licença sem prazo e sem limite (não bloquear clientes atuais).
- Renovação/suspensão feita pela provedora no painel, com auditoria.
- Fora de escopo nesta ronda: e-mails transaccionais do patch dos Vídeos e portabilidade
  das correções de segurança (CORS/IP/sessões/keyring/RLS vazio).

## Critérios de conclusão

- Migração aplica-se de zero e em base com dados; RLS na tabela `licenses`.
- Onboarding cria licença trial; aprovar order emite licença; limits derivam da licença.
- Endpoints da provedora para gerir licenças; admin vê a própria licença.
- Testes unitários + integração com Postgres/Redis descartáveis a passar; typecheck limpo.

## Estado final

Implementado na branch `feat/license-checkout`: migração `0022_license`, modelo `licenses`,
serviço de licenças, limite de utilizadores lido da licença, trial no onboarding, emissão
de licença na aprovação do pedido e endpoints da provedora (`/provider/licenses`).

Validação: 193 testes a passar (Postgres + Redis descartáveis), `tsc --noEmit` limpo.
Não portados nesta ronda: e-mails transaccionais e correções de segurança do patch dos Vídeos.
