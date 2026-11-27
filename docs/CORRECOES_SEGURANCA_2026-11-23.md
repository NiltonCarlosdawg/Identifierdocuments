# Correções de segurança — 23/11/2026

Quatro falhas encontradas numa revisão posterior à auditoria `AUDITORIA_SEGURANCA.md`.

## 1. Sessões que nunca expiravam

**Problema:** `/auth/refresh` aceitava o próprio access token e emitia outro igual, sem limite. Um token roubado podia ser renovado para sempre, e mudar a password não o invalidava.

**Correção:**
- Novo claim `authTime` (instante do último login com password), mantido em cada renovação. A renovação falha ao fim de `SESSION_MAX_AGE_HOURS` (por defeito 168 h = 7 dias).
- Nova coluna `users.tokens_valid_after` (migração `0023_session_hardening`; o ficheiro `0021_session_hardening.sql` é uma cópia de referência fora do journal). Mudar ou repor a password actualiza-a, e qualquer token emitido antes deixa de renovar.
- `PATCH /auth/me/password` devolve agora `{ message, token }`. A app desktop guarda esse token, por isso quem mudou a password continua com sessão iniciada.

**Limite conhecido:** um token roubado ainda funciona até expirar (máximo 15 min + 60 s), porque o middleware não consulta a BD em cada pedido. Para o cortar logo, seria preciso verificar `tokens_valid_after` no `authMiddleware`.

**Impacto no deploy:** os tokens antigos não têm `authTime`, por isso **todos os utilizadores têm de entrar de novo uma vez** depois da actualização.

## 2. Limite de tentativas contornável

**Problema:** o IP do cliente vinha do **primeiro** valor do `X-Forwarded-For`, que é escrito pelo próprio cliente. Bastava mudar esse cabeçalho a cada pedido para fugir ao limite de login. O `index.ts` ainda sobrepunha `clientIp` sem validação. Além disso, sem Redis o limite desligava-se por completo.

**Correção:**
- `getClientIp` usa o valor que o proxy de confiança acrescenta no **fim** da lista (`TRUSTED_PROXY_HOPS`, por defeito 1, que corresponde ao LiteSpeed do cPanel). O `index.ts` passou a usar a mesma função.
- Sem Redis, o limite passa a funcionar em memória em vez de se desligar.
- O login tem um segundo limite por email em qualquer IP (20 tentativas / 15 min) e normaliza o email para minúsculas.

**Confirmar no servidor:** que o LiteSpeed acrescenta o IP real ao `X-Forwarded-For`. Se houver Cloudflare ou outro proxy à frente, aumentar `TRUSTED_PROXY_HOPS`.

## 3. Chave de encriptação ao lado dos dados

**Problema:** a chave AES da store `docid-secure` estava guardada no mesmo ficheiro que os dados que protegia.

**Correção:** novo comando Rust `secure_key_get_or_init` (crate `keyring`), que guarda a chave no Gestor de Credenciais do Windows ou na Keychain do macOS. Nas instalações existentes, a chave antiga é migrada para o cofre e apagada do ficheiro, sem perder a sessão. No Linux mantém-se o comportamento antigo.

**Feito:** compila no Windows (job `Desktop Rust (Windows)` do CI e builds de release desde a 1.2.2).

## 4. Configuração perigosa por defeito

- `.env.example`: `ALLOW_PUBLIC_ONBOARDING=false`, `ENABLE_SWAGGER=false` e `JWT_SECRET` vazio.
- Em produção, a API recusa arrancar com um `JWT_SECRET` com menos de 32 caracteres ou igual a `change-me-in-production`.
- Em produção, aparece um aviso no log se o Swagger ou o onboarding público estiverem ligados.

**Antes de publicar, confirmar no `.env` do servidor:** `JWT_SECRET` forte, `ALLOW_PUBLIC_ONBOARDING=false` e `ENABLE_SWAGGER` ausente ou `false`.

## Verificação feita

- `tsc --noEmit` sem erros na API e na app desktop.
- Novo teste `session-hardening.test.ts`: 10/10 a passar (adicionado ao CI).
- Testes unitários existentes: os mesmos resultados que antes das alterações. As 2 falhas que existem já falhavam antes, porque precisam de PostgreSQL.
- **Verificado depois:** compilação Rust no CI (Linux e Windows), migrações aplicadas em produção e teste `session-hardening` no CI.

## 5. App Windows não conseguia falar com a API (CORS)

**Problema:** no Windows, o Tauri 2 serve a interface em `http://tauri.localhost` (`useHttpsScheme` está `false` por defeito). A API só autorizava `https://tauri.localhost` e `tauri://localhost`, por isso o WebView2 bloqueava todos os pedidos, incluindo o login, e a app mostrava "Sem ligação ao servidor". No macOS e no Linux funcionava, porque usam `tauri://localhost`.

Confirmado a 23/11/2026 contra a produção, com um pedido preflight a `https://didall.milvendas.ao/auth/login`: `Origin: http://tauri.localhost` → sem `Access-Control-Allow-Origin`.

**Correção:** a lista de origens passou para `src/lib/cors.ts` e inclui agora `http://tauri.localhost`. Teste novo: `cors-origins.test.ts` (adicionado ao CI).

**Não exige instalador novo:** basta publicar a API. As instalações 1.1.6 existentes passam a funcionar sozinhas. Não se deve mudar `useHttpsScheme` na app, porque isso mudaria a origem e faria perder os dados guardados no WebView.

**Instalador publicado (verificado a 23/11/2026):** `DocID_1.1.6_x64-setup-WebView2.exe` disponível em docid.milvendas.ao (223 675 805 B), SHA256SUMS coerente com a landing, `latest.json` assinado pela mesma chave que está embutida na app, API `/health` OK. O instalador não tem assinatura Authenticode, por isso o SmartScreen mostra um aviso (ver `GUIA_WHITELIST_WINDOWS.md`).

## 6. Login e onboarding falhavam depois do primeiro pedido (RLS com tenant vazio)

**Problema:** o `withTenant()` define `app.current_tenant` só dentro da transacção. Quando ela termina, o PostgreSQL deixa o parâmetro com o valor `''` (string vazia) nessa ligação, em vez de o apagar. A pool reutiliza a ligação, e as queries sem `withTenant` (o lookup do login, o onboarding) avaliavam as policies com `''::uuid`, o que dava erro: `invalid input syntax for type uuid: ""`.

Reproduzido em 23/11/2026 **no código original**, com PostgreSQL 17 real e um papel sem BYPASSRLS: o 1.º onboarding funciona; a partir daí, login e onboarding falham sempre com esse erro.

**Correcção:** migração `0024_rls_empty_tenant.sql` (a cópia `0023_rls_empty_tenant.sql` está fora do journal). Reescreve todas as policies públicas (21) para usarem `NULLIF(current_setting('app.current_tenant', true), '')`. Um tenant vazio passa a ser tratado como "nenhum tenant": devolve zero linhas, sem erro e sem fuga de dados. É idempotente.

**Verificação:** depois da migração, o teste ponta-a-ponta (dois tenants, vários logins e onboardings seguidos) passa 25/25.

**Nota (actualizada a 26/11/2026):** confirmado em produção que o utilizador da API (`milvendas_MV`) não é superutilizador nem tem BYPASSRLS, por isso o RLS está a proteger os dados. A API avisa no arranque se isso mudar (ver `docs/RLS_PRODUCAO.md`).
