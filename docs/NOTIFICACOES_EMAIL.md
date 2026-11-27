# Notificações por e-mail por tenant

Data: 23/11/2026, revisto a 27/11/2026. Âmbito: API (`apps/api`) e desktop (Configurações › E-mail, só `ORG_ADMIN`).

## 1. O que faz

| Evento | Quando dispara | Quem recebe |
|---|---|---|
| **Documento aprovado** (`document_approved`) | `PATCH /approvals/:id` com `approved`, ou `PATCH /documents/:param/access-requests/:id` com `approved` | Quem carregou o documento, mais os interessados (requerente do pedido de acesso, autor da partilha). Nunca o próprio aprovador. |
| **Documento enviado** (`document_shared`) | Partilha **activa**: directa (mesmo sector) ou depois da aprovação cross-sector | O utilizador destino, ou todos os membros activos do sector destino, excepto quem partilhou. |

Uma partilha em `pending_approval` **não** envia e-mail: o destinatário só recebe o link quando já tem acesso.

### Acções que pedem atenção (desde 27/11/2026, migração `0031_attention_emails.sql`)

Usam um template genérico (`renderAttention`): título, etiqueta colorida, resumo em tabela, motivo destacado e o que fazer a seguir. Os handlers ficam em `tenant-email.service.ts` e correm dentro da transacção da acção, como os anteriores.

| Evento | Quando dispara | Quem recebe |
|---|---|---|
| **Aprovação pendente** (`approval_requested`) | Partilha entre sectores fica em `pending_approval` | O supervisor do sector destino |
| **Pedido de acesso** (`access_requested`) | `POST /documents/:param/access-requests` | O supervisor do sector do documento |
| **Pedido recusado** (`document_rejected`) | `PATCH /approvals/:id` com `rejected`, ou recusa de um pedido de acesso | Partilha: quem partilhou. Acesso: quem pediu. Nunca quem recusou. Inclui o motivo. |
| **Password alterada** (`password_changed`) | `PATCH /auth/me/password` e `POST /auth/reset-password` | O próprio utilizador. **Obrigatório**: sai mesmo com os e-mails desligados. |
| **Nova função** (`role_granted`) | `POST /users/:id/roles` | O utilizador que recebeu a função (não quando se atribui a si próprio) |
| **Novo computador** (`device_registered`) | `POST /devices` | Os administradores (`ORG_ADMIN`), excepto quem registou |
| **Identificador anulado** (`identifier_cancelled`) | `PATCH /identifiers/:identifier/cancel` | Os administradores, excepto quem anulou. Inclui o motivo. |

Ainda por fazer: avisos de licença ou subscrição a terminar para os administradores. Dependem da verificação diária, que hoje corre no Redis (BullMQ) e não corre em produção.

### Preferências

O utilizador escolhe em Configurações › Notificações › "Avisos por e-mail" (separador visível a todos os utilizadores, não só aos administradores). Na API ficam em `notification_preferences`: `email: false` desliga tudo, e `email_<evento>: false` desliga um tipo (ex.: `email_approval_requested`). `password_changed` ignora as preferências. As chaves aceites estão em `NOTIFICATION_PREFERENCE_KEYS` (`auth.module.ts`); chaves desconhecidas são descartadas.

## 2. Arquitectura: fila transaccional em PostgreSQL (outbox)

```
pedido HTTP ─┐
             ├─ withTenant(tx) ── aprova/partilha ── INSERT email_logs (status=queued) ── COMMIT
             │
worker ──────┴─ email_outbox_claim()  (FOR UPDATE SKIP LOCKED, lease 120 s)
                  └─ por e-mail: withTenant(tenant_id) → carrega config + dados
                                 → render template → envia (fora da transacção)
                                 → sent | queued (+backoff) | failed | skipped
```

Porquê PostgreSQL e não Redis/BullMQ:
- **Atómico:** o e-mail entra na mesma transacção do evento. Se a aprovação fizer rollback, o e-mail desaparece também. Se fizer commit, o e-mail fica garantido.
- **Funciona sem Redis**, que no cPanel nem sempre está disponível. O projecto já tinha a regra de não pôr segredos no Redis.
- **Seguro com várias instâncias:** `SKIP LOCKED` impede que dois processos enviem o mesmo e-mail.
- **Sem duplicados:** índice único `(tenant_id, dedupe_key)`, por exemplo `approved:<approvalId>:<userId>`.

O worker arranca com a API (`startEmailWorker()` em `index.ts`), corre a cada `EMAIL_WORKER_INTERVAL_MS` (10 s por defeito) e é acordado logo após cada novo e-mail.

### Tentativas
- Falha temporária (rede, SMTP 4xx, HTTP 429/5xx): volta à fila com espera de 1 min, 5 min, 25 min, ~2 h e 6 h (máx. 5 tentativas).
- Falha definitiva (SMTP 5xx, HTTP 4xx, destinatário inválido): `failed` de imediato, com a mensagem em `last_error`.
- Processo morto a meio do envio: a lease expira e a linha volta a ser reclamada. Se já esgotou as tentativas, passa a `failed`.
- Sem configuração (`EMAIL_FALLBACK_MODE=block`) ou envio desactivado: `skipped`.
- Um admin pode repor na fila: `POST /email/logs/:id/retry`.

## 3. Modelo de dados (migração `0025_email_notifications.sql`)

**`tenant_email_settings`** (1 linha por tenant, PK = `tenant_id`): `provider` (`smtp` | `resend` | `sendgrid`), `from_email`, `from_name`, `reply_to`, `smtp_host`, `smtp_port`, `smtp_security` (`ssl` | `starttls` | `none`), `smtp_user`, `secret_encrypted`, `enabled`, `verified_at`, `last_test_at`, `last_test_error`, `updated_by`, datas.

**`email_logs`** (histórico e fila): `tenant_id`, `event_type`, `recipient_email`, `recipient_user_id`, `document_id`, `subject`, `template_data` (variáveis, nunca segredos nem links), `status` (`queued` | `sending` | `sent` | `failed` | `skipped`), `attempts`, `max_attempts`, `next_attempt_at`, `locked_until`, `provider`, `sender`, `message_id`, `last_error`, `dedupe_key`, `created_at`, `sent_at`.

## 4. Isolamento multi-tenant

1. **RLS com FORCE** nas duas tabelas (`tenant_id = app.current_tenant`).
2. O worker só vê a fila de todos os tenants dentro de `email_outbox_claim()` (SECURITY DEFINER), que liga e desliga o GUC `app.email_worker` na própria função. O processamento de cada e-mail corre em `withTenant(tenant_id do e-mail)`, por isso a configuração carregada é sempre a desse tenant.
3. **Encriptação ligada ao tenant:** AES-256-GCM com `EMAIL_SECRETS_KEY`, usando o `tenant_id` como dado autenticado (AAD). Um segredo copiado para a linha de outro tenant não desencripta.
4. A API nunca devolve o segredo, só `hasSecret: true/false`.

Verificado com PostgreSQL real (papel sem BYPASSRLS): com o contexto do tenant B, zero linhas do tenant A. O histórico, a configuração e o reenvio de B não vêem nem tocam em A.

## 5. Remetente e fallback

- Com configuração própria: `From: "<from_name>" <from_email>` pelo SMTP ou pela API do próprio tenant.
- Sem configuração e `EMAIL_FALLBACK_MODE=platform` (defeito): envia pelo `SMTP_*` da plataforma com `From: "<Organização> via DocID" <SMTP_FROM>`. O domínio é o da plataforma, por isso SPF e DKIM batem certo e o e-mail não cai no spam.
- `EMAIL_FALLBACK_MODE=block`: não envia e regista `skipped: NOT_CONFIGURED`.

## 6. Segurança

- **SSRF:** o host SMTP é escolhido pelo tenant. Só são aceites as portas 25, 465, 587 e 2525, e só endereços públicos (bloqueia 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, IPv6 privado...). A ligação é feita ao IP já validado, com SNI para o nome original, o que evita DNS rebinding. `EMAIL_ALLOW_PRIVATE_SMTP=true` só em desenvolvimento.
- **Templates:** todas as variáveis passam por escape HTML, links só `http(s)` e assunto sem quebras de linha (evita injecção de cabeçalhos).
- **Links de download:** token HMAC (`EMAIL_LINK_SECRET`, ou derivado do `JWT_SECRET`) que liga tenant, documento e destinatário, válido `EMAIL_LINK_TTL_HOURS` (72 h). O token é gerado só no envio e nunca é guardado na BD. Em `GET /email-links/download` o servidor volta a confirmar que o utilizador está activo e tem acesso (partilha revogada = link morto), regista `DOWNLOAD_EMAIL_LINK` na auditoria e aplica um limite de 30 pedidos/min por IP.
  - Limite assumido: quem tiver acesso à caixa de correio do destinatário consegue descarregar o ficheiro durante o prazo. Para documentos sensíveis, reduzir `EMAIL_LINK_TTL_HOURS`.
- O ficheiro **não** vai em anexo, de propósito: o acesso é revogável e não cria cópias fora do sistema.

## 7. Endpoints (só `ORG_ADMIN`, sempre do próprio tenant)

| Método | Rota | Função |
|---|---|---|
| GET | `/email/settings` | Configuração actual (sem segredo), modo de fallback |
| PUT | `/email/settings` | Guardar (o segredo é opcional; omitir mantém o actual; mudar de fornecedor exige um novo) |
| DELETE | `/email/settings` | Remover (volta ao fallback) |
| POST | `/email/settings/test` | `{ "to": "..." }` envia logo um e-mail de teste e marca `verified_at` se correr bem (5 testes / 10 min) |
| GET | `/email/logs?status=&eventType=&page=&limit=` | Histórico (sem `template_data`) |
| POST | `/email/logs/:id/retry` | Repor na fila um e-mail `failed`/`skipped` |
| GET | `/email-links/download?token=` | Público, link assinado dos e-mails |

Exemplo SMTP:
```json
PUT /email/settings
{ "provider": "smtp", "fromEmail": "notificacoes@empresaA.com", "fromName": "Empresa A",
  "smtpHost": "smtp.empresaA.com", "smtpPort": 587, "smtpSecurity": "starttls",
  "smtpUser": "notificacoes@empresaA.com", "secret": "<password>" }
```

### Fornecedores
- **Resend:** `{ "provider": "resend", "fromEmail": "notificacoes@empresaA.com", "secret": "re_..." }`. O domínio tem de estar verificado no painel da Resend (registos DNS SPF/DKIM).
- **SendGrid:** `{ "provider": "sendgrid", ..., "secret": "SG...." }`, com Domain Authentication feita no SendGrid.
- **Amazon SES:** usar `provider: "smtp"` com o endpoint SMTP da região (`email-smtp.<região>.amazonaws.com`, porta 587, `starttls`) e as credenciais SMTP do SES. O domínio tem de estar verificado no SES.
- Em todos os casos, carregar em "Testar" (`POST /email/settings/test`) depois de guardar.

## 8. Variáveis de ambiente

`EMAIL_SECRETS_KEY` (**obrigatória** para guardar credenciais: `openssl rand -base64 32`; guardar fora da BD), `EMAIL_LINK_SECRET`, `EMAIL_LINK_TTL_HOURS`, `PUBLIC_API_URL`, `EMAIL_FALLBACK_MODE`, `EMAIL_NOTIFICATIONS_ENABLED`, `EMAIL_WORKER_ENABLED`, `EMAIL_WORKER_INTERVAL_MS`, `EMAIL_TIMEZONE`, `EMAIL_ALLOW_PRIVATE_SMTP` (só dev) e `SMTP_*` da plataforma. Ver `apps/api/.env.example`.

Perder a `EMAIL_SECRETS_KEY` não afecta mais nada, mas cada tenant tem de voltar a introduzir a password ou a chave de e-mail.

## 9. Ficheiros

- `src/db/migrations/0025_email_notifications.sql`, tabelas em `src/db/schema.ts` (o ficheiro `0022_email_notifications.sql` é uma cópia de referência fora do journal)
- `src/lib/secret-box.ts` (encriptação), `src/lib/signed-link.ts` (links), `src/lib/smtp-guard.ts` (SSRF)
- `src/services/email/templates.ts` (2 templates de documento, o aviso genérico `renderAttention` e o teste), `transport.ts` (SMTP/Resend/SendGrid), `tenant-email.service.ts` (config, fallback, fila, handlers)
- `src/jobs/email-worker.ts` (worker), `src/modules/email.module.ts` (endpoints)
- Gatilhos: `src/modules/approvals.module.ts`, `src/modules/documents.module.ts`, `src/modules/users.module.ts`, `src/modules/devices.module.ts`, `src/modules/identifiers.module.ts`, `src/services/auth.service.ts`

## 10. Testes

- `src/__tests__/email-notifications.test.ts`: 21 testes unitários (encriptação/AAD, links, SSRF, escape nos templates, aviso genérico, política de tentativas, preferências). Incluído no CI.
- `src/__tests__/attention-emails.integration.test.ts`: com PostgreSQL real, destinatários de cada aviso (administradores, excepto o autor), preferências, aviso de password obrigatório e dedupe.
- `src/__tests__/phase3-4.integration.test.ts`: os fluxos de partilha, pedido de acesso e recusa correm com os novos avisos na mesma transacção.
- Teste ponta-a-ponta feito em 23/11/2026 com PostgreSQL 17 real, papel sem BYPASSRLS, e dois servidores SMTP de teste: **25/25 verificações**. Cobre a configuração e a encriptação na BD, o e-mail de teste pelo SMTP do tenant (com as credenciais dele), a partilha com e-mail e um link que descarrega, o link adulterado recusado, a partilha pendente sem e-mail, a aprovação com aprovador, data/hora e observações, os membros do sector a receber depois da aprovação, a ausência de duplicados, o 451 a voltar à fila, o 550 a ficar `failed`, o fallback da plataforma para o tenant sem configuração, e o isolamento entre tenants (histórico, configuração, reenvio e RLS directo na BD).

## 11. Próximos passos

1. ~~UI no desktop~~ — feito (`920f82c`): Configurações › E-mail com a configuração, botão "Testar" e histórico com "Reenviar".
2. Opção, por evento, de destinatários extra definidos pela organização (lista de interessados).
3. Métricas e alertas: número de `failed` por tenant e por dia.
4. Limpeza periódica de `email_logs` com mais de N meses (retenção).
5. Logótipo e cor da organização nos templates.
