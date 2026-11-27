# Licenças das organizações

> Há duas camadas que coexistem: as **licenças** descritas aqui (`license.service`,
> `license-enforcement.service`, `licenseGuard`), que decidem o modo só consulta, e as
> **subscrições** por plano (`subscription.service`, checkout e painel da provedora), que impõem
> os limites de utilizadores, identificadores e números offline. A aprovação de um pedido no
> painel (`issueLicense`) actualiza as duas. As regras de expiração ainda divergem: aqui, só
> consulta; nas subscrições, 1 upload por dia por utilizador. Unificar está no BACKLOG (Fase 16).

Cada organização (tenant) tem um **número de licença** único, por exemplo
`DOCID-2026-A3TB-TE43-2ZPX`, e uma licença que controla o acesso.

## Regras

| Situação | O que acontece |
|---|---|
| Organização nova | Período de teste: **14 dias** e **5 utilizadores activos** no máximo |
| Dentro do prazo | Tudo funciona |
| Até **7 dias** depois do fim | Tudo funciona; a app mostra um aviso para renovar |
| Mais de 7 dias depois do fim | **Só consulta**: entram, vêem e descarregam documentos, mas não criam, carregam, partilham nem gerem utilizadores |
| Licença suspensa | Só consulta, mesmo dentro do prazo |
| Limite de utilizadores | Criar ou activar um utilizador acima do limite é recusado com uma mensagem clara |

Continuam sempre a funcionar, mesmo em só consulta:

- o login e a conta do utilizador;
- as notificações;
- o registo de dispositivos;
- a **sincronização de identificadores fiscais já emitidos offline**: recusá-la deixava faturas emitidas por registar e buracos na numeração legal.

Organizações que já existiam antes desta versão ficam **sem prazo e sem limite**, para não bloquear
clientes actuais. Defina a licença de cada uma com os comandos abaixo.

Os valores do período de teste mudam-se no `.env` do servidor: `LICENSE_TRIAL_DAYS`,
`LICENSE_TRIAL_MAX_USERS` e `LICENSE_GRACE_DAYS`.

## Onde se vê

- **Na app (todos os utilizadores):** uma faixa no topo quando faltam 7 dias ou menos do teste, quando a licença está em tolerância, ou quando está em só consulta.
- **Na app, em Configurações → Organização (administrador):** número de licença, plano, estado, validade e utilizadores usados.

## Gerir licenças (plataforma)

Quem gere as licenças é a plataforma, não o cliente. O administrador da organização **não** consegue
renovar a própria licença: a base de dados recusa a alteração.

1. No `.env` do servidor, defina `PLATFORM_ADMIN_TOKEN` com pelo menos 32 caracteres aleatórios. Guarde esse valor num local seguro: quem o tiver pode gerir todas as licenças.
2. No PowerShell, prepare o acesso (substitua pelo seu token):

```powershell
$h = @{ "x-platform-admin-token" = "COLE-AQUI-O-TOKEN" }
$api = "https://didall.milvendas.ao/platform/licenses"
```

**Ver todas as licenças:**
```powershell
(Invoke-RestMethod "$api" -Headers $h).data | Format-Table name, licenseNumber, plan, state, validUntil, activeUsers, maxUsers
```

**Ver só as expiradas:**
```powershell
(Invoke-RestMethod "$api`?state=expired" -Headers $h).data | Format-Table name, licenseNumber, validUntil
```

**Renovar por 365 dias e passar a um plano pago com 20 utilizadores:**
```powershell
Invoke-RestMethod "$api/DOCID-2026-A3TB-TE43-2ZPX" -Method Patch -Headers $h -ContentType "application/json" -Body '{"extendDays":365,"plan":"profissional","maxUsers":20}'
```
A renovação conta a partir do fim actual da licença, ou de hoje se já tiver expirado.

**Definir uma data de fim exacta:**
```powershell
Invoke-RestMethod "$api/DOCID-2026-A3TB-TE43-2ZPX" -Method Patch -Headers $h -ContentType "application/json" -Body '{"validUntil":"2027-12-31"}'
```

**Tirar o prazo ou o limite de utilizadores:** `{"validUntil":null}` ou `{"maxUsers":null}`.

**Suspender (por exemplo, falta de pagamento) e reactivar:**
```powershell
Invoke-RestMethod "$api/DOCID-2026-A3TB-TE43-2ZPX" -Method Patch -Headers $h -ContentType "application/json" -Body '{"status":"suspended"}'
Invoke-RestMethod "$api/DOCID-2026-A3TB-TE43-2ZPX" -Method Patch -Headers $h -ContentType "application/json" -Body '{"status":"active"}'
```

Cada alteração fica registada na auditoria da organização (acção `LICENSE_UPDATED`), com os
valores antes e depois. Os avisos na app actualizam-se em até 15 minutos; o bloqueio ou
desbloqueio aplica-se logo.

## Detalhes técnicos

- Migrações: `0026_tenant_license_number.sql` (número de licença), `0027_license_enforcement.sql` (validade, limite, estado, triggers e funções da plataforma) e `0028_legacy_license_lookup.sql` (números de licença antigos). Os ficheiros `0024_tenant_license_number.sql` e `0025_license_enforcement.sql` são cópias de referência fora do journal e não correm.
- Regras e cache: `apps/api/src/services/license.service.ts`. O bloqueio em só consulta está em `middleware/licenseGuard.ts`.
- Endpoints da plataforma: `apps/api/src/modules/platform.module.ts`, autenticados pelo cabeçalho `x-platform-admin-token`. Sem `PLATFORM_ADMIN_TOKEN`, ficam desligados (404).
- O limite de utilizadores é aplicado por um trigger na tabela `users` (erro `LIC01`), com lock na organização para dois pedidos simultâneos não passarem ambos.
- A auto-renovação é impedida por um trigger em `organizations` (erro `LIC02`). Só é aceite com `app.license_admin = 'on'`, que é ligado apenas pelos endpoints da plataforma.
- Testes: `license.test.ts`, `license-enforcement.test.ts`, `license.integration.test.ts` (base de dados real, também no CI) e `apps/desktop/src/__tests__/license-banner.test.ts`.
