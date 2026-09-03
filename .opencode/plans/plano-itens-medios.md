# Plano — Itens Médios do Backlog (ronda 2)

> Contexto: o utilizador aprovou a implementação dos 11 itens de dificuldade média
> restantes no backlog (Fase 13 concluída com os itens fáceis).
> Branch: `fix/safeerror-transaction-rollback`.

---

## Itens abrangidos (referências em `docs/BACKLOG.md`)

| # | Backlog | Item | Onde toca |
|---|---|---|---|
| M1 | 664 | Logs estruturados na API (pino) | API |
| M2 | 135 | Ecrã de "Esqueci a password" (API + UI) | API + Login |
| M3 | 261 | Configuração de scanner padrão (persistido) | scannerStore + Settings |
| M4 | 153 | Histórico de eventos do identificador | API + Identifiers |
| M5 | 146 | Gráfico de actividade no Dashboard | Dashboard + stats |
| M6 | 254 | Importar utilizadores via CSV | API + Users/Settings |
| M7 | 223 | Lista de ficheiros "adicionados mais tarde" (lembretes) | watcher Rust + UI |
| M8 | 224 | Relatório de detectados vs ignorados | watcher Rust + UI |
| M9 | 165 | Página de perfil dedicada por utilizador | API + Users |
| M10 | 124 | Notificações nativas (tauri-plugin-notification) | Tauri + watcher |
| M11 | 158 | Pré-visualização inline de PDFs | Documents |

**Decisões de negócio confirmadas (Regra 11)**
- **M2**: entrega do token via **infra SMTP** (variáveis de ambiente
  `SMTP_HOST/PORT/USER/PASS/FROM`). Em dev, se SMTP não estiver configurado,
  o token é impresso no log do servidor (fallback) — nunca devolvido na resposta.
- **M6**: password inicial **gerada aleatoriamente e devolvida no relatório de
  importação** para o admin distribuir (credenciais nunca na resposta de listagem).

---

## M1 — Logs estruturados na API (pino)

### Objectivo
Substituir `console.error`/`console.log` por logs estruturados (JSON) com contexto
de request (tenant, user, duração).

### Passos
1. Adicionar `pino` às dependências de `apps/api/package.json`.
2. Criar `apps/api/src/lib/logger.ts` — instância pino com nível por env
   (`LOG_LEVEL`), serializadores de erro.
3. No `apps/api/src/index.ts`: middleware de logging (método, path, status,
   duração, `x-tenant-id`/`userId` quando presente) + `onError` a usar o logger.
4. Manter os logs de auditoria (tabela `audit_logs`) intactos — são negócio,
   não logging.

### Critérios de aceitação
- Requests e erros aparecem como JSON estruturado no stdout.
- `bunx tsc --noEmit` e `bun test` continuam verdes.

---

## M2 — Ecrã de "Esqueci a password" (API + UI)

### Objectivo
Recuperação de password sem depender de infra de email existente.

### Decisões de negócio (a confirmar)
- Entrega do token: (a) token de uso único devolvido ao admin/anon? (b) token
  impresso no log do servidor e entregue fora de banda? (c) infra de email SMTP?
- Definição de segurança: expiração curta (15 min), single-use, sem revelar se o
  email existe (resposta uniforme).

### Passos
1. Nova tabela `password_reset_tokens` (email, token_hash, expires_at, used_at)
   + migração. Token guardado só como hash (SHA-256), nunca em claro.
2. `POST /auth/forgot-password` { email } → gera token, entrega conforme decisão,
   responde sempre 200/202 genérico.
3. `POST /auth/reset-password` { token, newPassword } → valida expiração/uso único,
   actualiza `password_hash`, invalida tokens do utilizador.
4. UI: ligar o botão "Esqueceu a senha?" em `Login.tsx:41` a um ecrã de 2 passos
   (pedido → token + nova password).

### Critérios de aceitação
- Fluxo completo funcional; token de uso único; resposta uniforme para email
  existente/inexistente.

---

## M3 — Configuração de scanner padrão (persistido)

### Objectivo
Guardar a escolha de dispositivo entre sessões (item 261).

### Passos
1. Estender `configStore.ts` com `defaultScanner: string | null` +
   `setDefaultScanner`, persistido no mesmo store (`docid-config`).
2. `scannerStore.ts`: `loadDevices` passa a usar `defaultScanner` como preferido
   (fallback para `devices[0]`); selecção do utilizador grava o default.
3. Settings → "Dispositivos": selector de scanner padrão a partir da lista.

### Critérios de aceitação
- Escolhido um scanner uma vez, reabre a app e continua seleccionado.

---

## M4 — Histórico de eventos do identificador

### Objectivo
Timeline de eventos de um identificador no modal de detalhe (item 153).

### Passos
1. Confirmar que `GET /audit` aceita filtro por `resource=identifiers` +
   `resourceId=<id>` (padrão já usado; adicionar se faltar).
2. `Identifiers.tsx` DetailModal: nova secção "Histórico" que carrega os eventos
   e renderiza timeline (criação, attach, partilha, aprovação, cancelamento).

### Critérios de aceitação
- Modal de um identificador mostra a timeline de eventos ordenada por data.

---

## M5 — Gráfico de actividade no Dashboard

### Objectivo
Gráfico de identificadores/documentos por dia (últimos 14 dias) no Dashboard
(item 146).

### Decisão técnica
- Sem dependência nova (sem recharts): bar-chart SVG simples (máx. ~40 linhas)
  em `Dashboard.tsx` ou componente `ActivityChart.tsx`.

### Passos
1. API: estender stats com séries temporais (ex.: `GET /tenants/me/stats`
   ganha `activity: [{ date, identifiers, documents }]` para 14 dias) ou novo
   endpoint `GET /stats/activity`.
2. Dashboard: componente que renderiza as barras + tooltip nativo (title).
3. Fallback offline: reutilizar `useOfflineCache` se aplicável, senão estado vazio.

### Critérios de aceitação
- Dashboard mostra 14 dias de barras; offline não quebra a página.

---

## M6 — Importar utilizadores via CSV

### Objectivo
Bulk create de utilizadores por CSV na organização (item 254).

### Decisões de negócio (a confirmar)
- Colunas esperadas: `email,full_name,sector,role` (sector por nome/código).
- Password inicial: (a) gerada aleatoriamente e devolvida no relatório para o
  admin distribuir; (b) default comum definido pelo admin no upload.

### Passos
1. API: `POST /users/import` (apenas ORG_ADMIN). Recebe CSV (texto ou multipart),
   valida linha a linha (email válido, sector existe no tenant, role permitida),
   ignora emails duplicados, cria com `is_active=true`. Devolve
   `{ data: { created, skipped, errors: [{ row, reason }] } }`.
2. Rate limit 5/hora como os restantes endpoints de exportação.
3. UI: Settings → Organização (ou Users) com botão "Importar CSV", diálogo nativo
   de ficheiro, preview do relatório (criados/pulados/erros).

### Critérios de aceitação
- CSV válido cria utilizadores; CSV com erros reporta por linha sem criar parciais
  fora das regras.

---

## M7 — Lembretes de ficheiros "adicionados mais tarde"

### Objectivo
Persistir os ficheiros detectados e permitir a acção "Adicionar mais tarde"
(item 223; completa o item 215 parcial).

### Passos
1. Rust: nova tabela SQLite `watcher_files` (path, mtime, status
   [detected|pending|added|ignored], kind [identifier_found|file_detected],
   identifier?, created_at). Em vez de só emitir eventos, o watcher regista cada
   ficheiro (upsert por path+mtime).
2. Comandos Tauri: `watcher_get_files`, `watcher_set_file_status(path, status)`,
   `watcher_get_reminders`.
3. `watcherStore.ts`: expor lista de ficheiros detectados + lembretes + acções.
4. UI: WatcherTab → lista de ficheiros detectados com acções "Adicionar agora /
   Mais tarde / Não pertence"; secção "Lembretes" com os pendentes.

### Critérios de aceitação
- Ficheiro marcado "Mais tarde" persiste entre reinícios e aparece em "Lembretes".

---

## M8 — Relatório de detectados vs ignorados

### Objectivo
Relatório além do contador simples (item 224).

### Passos
1. Rust: comando `watcher_get_report` → contagens por status/kind do dia/semana
   (detectados, com identificador, ignorados, adicionados).
2. UI: WatcherTab mostra o relatório (pequenas métricas/tabela).

### Critérios de aceitação
- Relatório reflecte o estado persistido do watcher.

---

## M9 — Página de perfil dedicada por utilizador

### Objectivo
Perfil completo por utilizador a partir da gestão de utilizadores (item 165).

### Passos
1. Confirmar `GET /users/:id` (ou adicionar) com roles e sector; estender com
   métricas simples (documentos/identificadores criados) se trivial.
2. UI: `Users.tsx` → abrir modal/página detalhada por utilizador com dados,
   roles e estado.

### Critérios de aceitação
- Clicar num utilizador mostra o perfil completo com roles.

---

## M10 — Notificações nativas (tauri-plugin-notification)

### Objectivo
Notificações de SO para eventos do watcher e uploads (item 124).

### Passos
1. `apps/desktop/package.json`: adicionar `@tauri-apps/plugin-notification`.
2. `apps/desktop/src-tauri/Cargo.toml`: adicionar `tauri-plugin-notification`.
3. `tauri.conf.json` capabilities: permissão `notification:default`.
4. `src-tauri/src/lib.rs`: registar o plugin.
5. React: `isPermissionGranted`/`requestPermission` no arranque (watcher activo) e
   `sendNotification` nos eventos `watcher:file_detected`/`identifier_found` e
   quando um upload da fila termina.

### Critérios de aceitação
- Ficheiro detectado pelo watcher com a app em segundo plano gera notificação do SO.

---

## M11 — Pré-visualização inline de PDFs

### Objectivo
Preview inline de PDFs em Documentos (item 158; fecha parcial do 230).

### Passos
1. Documents: ao abrir o detalhe de um PDF, usar `download_document_offline`/fetch
   → Blob URL → `<iframe>`/`<object>` com o preview.
2. Indicar limitações da WebView (Linux/WebKit pode não renderizar PDF no iframe;
   marcar como best-effort e mostrar fallback "Abrir no SO").

### Critérios de aceitação
- PDF abre inline quando a WebView suporta; fallback para abrir no SO.

---

## Ordem de execução e riscos

| Ordem | Item | Risco | Mitigação |
|---|---|---|---|
| 1 | M1 pino | Baixo (isolado) | Logger em lib; sem tocar em negócio |
| 2 | M10 notificações | Baixo-Médio (config Tauri) | Capacidades mínimas; testar dev |
| 3 | M3 scanner padrão | Baixo | Reutilizar configStore |
| 4 | M4 histórico | Baixo | Reutilizar audit já filtrado |
| 5 | M5 gráfico | Médio (nova query) | Query agregada simples; offline-safe |
| 6 | M2 reset password | Médio (segurança) | Token com hash + expiração; validar decisão |
| 7 | M6 import CSV | Médio (validação) | Validação linha-a-linha; rate limit |
| 8 | M7 lembretes | Médio (Rust + DB local) | Nova tabela local; upsert path+mtime |
| 9 | M8 relatório | Baixo (reusa M7) | Comando de leitura |
| 10 | M9 perfil | Baixo | Reutilizar users |
| 11 | M11 preview PDF | Médio (WebView) | Fallback para abrir no SO |

### Verificações obrigatórias em cada item
- `tsc -b` (desktop) ou `bunx tsc --noEmit` (API) limpos (Regra 7).
- Releitura do resultado de cada edição (Regra 8).
- `cargo test` no `src-tauri` para mudanças Rust (watcher/notificações).
- `bun test` na API para mudanças de módulos (M2, M4, M5, M6, M9).
- Actualizar `docs/BACKLOG.md` e comitar por item (ou por grupo lógico).

## Regras de projecto
- Regra 4: "Ausência de X" = negação (dados vazios), nunca ausência de filtro.
- Regra 11: decisões de negócio não especificadas → parar e perguntar (M2/M6).
- Ler `docs/CLAUDE.md` integralmente antes de escrever código.
