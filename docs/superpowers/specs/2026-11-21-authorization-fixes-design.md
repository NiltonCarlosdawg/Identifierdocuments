# Correção de autorização — três falhas confirmadas no DocID

Data: 2026-11-21. Repo: `~/Documentos/VERANO/Identifierdocuments` (app DocID).

## Intenção e porquê

As regras de negócio declaradas são: (1) admin do tenant vê tudo **dentro do seu tenant**;
(2) supervisor de departamento aprova/nega o acesso de gente de fora ao seu departamento;
(3) funcionário vê o que gera e o que os colegas do mesmo departamento geram — **com a
exceção confirmada pelo dono do produto**: documentos `public` de qualquer sector são
visíveis para todos, e `public` é o valor por omissão. Essa exceção **não** é uma falha
e não muda.

A leitura estática do código mostrou três desvios das regras (1) e (2), plus uma lacuna
de auditoria. O objetivo é corrigir apenas esses três, mantendo os fluxos legítimos.

## Objetivos

1. **Admin do tenant vê documentos `sector_only` de outros sectores**, em listagem,
   metadados e download — sem sair do tenant.
2. **`GET /approvals` deixa de divulgar aprovações alheias**: admin vê todas, supervisor
   vê as que supervisiona (e as que ele próprio pediu), funcionário vê só as que pediu.
3. **Aprovação só por quem pode e não por si próprio**: supervisor responsável (ou admin)
   pode resolver; uploader sem papel de supervisor não pode; requerente não pode aprovar
   nem negar o próprio pedido; decisão fica em `audit_logs`.

## Não objetivos / anti-objetivos

- Não alterar a visibilidade `public` nem o default `public`.
- Não mexer em RLS, migrações, schema, JWT, CORS, uploads, path traversal ou dependências.
- Não corrigir a fuga de metadados em `GET /documents/:id` nem o `register-offline-loose`
  nesta ronda — são achados separados, fora dos três pontos pedidos.
- Não testar, chamar ou alterar produção, contas, credenciais ou serviços externos.
- Não enfraquecer validações nem remover autenticação para fazer testes passar.

## Restrições

- Código, identificadores e commits em inglês; resposta em português.
- Dados sintéticos e recursos locais descartáveis; nada de dados reais de tenants.
- Commits pequenos e convencionais. Segredos nunca em código, logs ou testes.
- A correção deve ficar no servidor (camada de serviço/módulo), nunca só na UI desktop.

## O que já está decidido (evidência no código)

- `tenant_id` vem do JWT e é imposto por `withTenant` + RLS; não precisa de mudança.
- `getFreshRoles(userId, tenantId, executor?)` já existe e aceita o `tx` aberto, evitando
  deadlock por segunda conexão (`src/middleware/auth.ts:86-101`). Toda verificação de role
  nova deve passar o `tx` como terceiro argumento.
- `checkVisibility` em `src/services/identifier.service.ts:74` já dá a admin
  `{ visible: true, restricted: true }` — padrão a seguir, mas para documentos o admin
  deve conseguir **descarregar**, não só ver metadados.
- `canAccessDocument` (`src/services/attachment.service.ts:468-507`) centraliza o controlo
  de download, thumbnail e metadados; `listDocumentsForApi` (`:632-660`) tem uma filtragem
  equivalente em memória. Ambos são o ponto compartilhado a corrigir.
- `GET /approvals` (`src/modules/approvals.module.ts:25-43`) filtra por supervisor apenas
  quando o role é `SECTOR_SUPERVISOR`; `GET /approvals/:id` (`:66-73`) já usa o critério
  correto (`isAdmin || isSupervisor || isRequester`) — a listagem deve ser alinhada com ele.
- `canResolveApproval` (`src/modules/approvals.module.ts:12-20`) não compara
  `requesterId` com `auth.userId`.
- `PATCH /documents/:param/access-requests/:requestId`
  (`src/modules/documents.module.ts:693-788`) autoriza com `isOwner || isSupervisor`,
  sem ler papéis frescos nem impedir auto-aprovação.
- `PATCH /approvals/:id` (`src/modules/approvals.module.ts:82-207`) grava `status`,
  `notes`, `resolvedAt` mas nenhuma linha em `audit_logs`; o padrão de insert já existe
  em `documents.module.ts:741-746`.

## Plano das alterações (para o builder)

### A. Admin vê tudo — `src/services/attachment.service.ts`

- Em `canAccessDocument`, logo após obter `v`, consultar `getFreshRoles(auth.userId,
  auth.tenantId, tx)`; se incluir `ORG_ADMIN`, devolver `{ allowed: true, restricted: false }`.
- Em `listDocumentsForApi`, obter os mesmos papéis frescos com `tx` e, se for admin,
  considerar todas as linhas visíveis (mantendo paginação e o filtro por `identifierId`).
- Atualizar o comentário em `:473-476`, que hoje afirma o contrário.
- Não tocar em `canWriteIdentifier` (admin continua sem escrita cross-sector).

### B. Listagem de aprovações — `src/modules/approvals.module.ts:25-43`

- Substituir o bloco de filtro por:
  - admin → nenhum filtro extra;
  - supervisor → `OR(supervisorId = userId, requesterId = userId)`;
  - demais → `requesterId = userId`.
- Manter `query.status` e `query.sectorId`.
- Usar `getFreshRoles(auth.userId, auth.tenantId, tx)` dentro da transação já aberta.

### C. Decisão de acesso — dois fluxos

1. `canResolveApproval` (`approvals.module.ts:12-20`): exigir `approval.requesterId !==
   auth.userId` para todos os papéis, incluindo `ORG_ADMIN`; manter a exigência de
   `SECTOR_SUPERVISOR` + `supervisorId` para não-admins.
2. `PATCH /documents/:param/access-requests/:requestId` (`documents.module.ts:693-788`):
   substituir `isOwner || isSupervisor` por papéis frescos (`ORG_ADMIN`, ou
   `SECTOR_SUPERVISOR` com `idRow.sector.supervisorId === auth.userId`) **e** exigir
   `req.requesterId !== auth.userId`. O uploader deixa de poder decidir só por ser dono.
3. `PATCH /approvals/:id`: inserir em `audit_logs` dentro da mesma transação, usando
   `clientIp`, `action: APPROVAL_APPROVED | APPROVAL_REJECTED`, `resource: "approvals"`,
   `resourceId: params.id`, `metadata` com `documentId`, `type`, `notes`. Sem migração:
   o autor da decisão fica no campo `userId` do log.

### D. Provas locais (antes e depois)

- Criar `src/__tests__/authorization-fixes.test.ts` seguindo o estilo dos testes
  existentes em `src/__tests__/`, com mocks locais — sem Postgres, Redis ou rede.
- Provas que devem falhar antes da correção e passar depois:
  1. `canAccessDocument` com admin e doc `sector_only` de outro sector → `allowed: true`.
  2. `listDocumentsForApi` com admin inclui o doc `sector_only` de outro sector.
  3. listagem de aprovações para `MEMBER` só devolve linhas com `requesterId = userId`.
  4. `canResolveApproval` nega quando `requesterId === userId`, mesmo sendo admin.
  5. resolução de access-request nega ao uploader sem papel e ao próprio requerente.
- Validar com `bun test` e `bun run typecheck` (ou o script equivalente do `package.json`).

## Critérios de conclusão

- Os cinco testes passam; testes existentes continuam a passar.
- Nenhuma das exceções "não objetivos" foi alterada.
- Diff revisto, sem segredos nem dados de tenants, commitado em commits pequenos.
- Relatório final em português: o que mudou (file:linha), evidência dos comandos,
  o que ficou por fazer, riscos novos.

## Decisões do builder-check

- **Teste antigo contradiz o objetivo 1 (resolvido aqui).**
  `src/__tests__/phase3-4.integration.test.ts:421-428` chama-se "admin não descarrega
  sector_only (403)" e espera `403`/`ACCESS_REQUIRED`. Essa asserção deixa de valer:
  atualizar para `200` e renomear o teste, porque "admin vê tudo" é regra declarada
  pelo dono do produto. O teste `:466-480` ("supervisor aprova → admin descarrega")
  continua a devolver 200, mas deixa de provar a partilha — não alterar, só assinalar.
  Procurar outras asserções com o mesmo pressuposto antes de fechar.
- **Assimetria entre os dois fluxos de pedido (fora de escopo, preservar).**
  `documents.module.ts:603-615` cria um `document_access_requests` e um `approvals` para o
  mesmo pedido; resolver num não atualiza o outro. Alinhar exigiria mexer em mais handlers
  e não está nos três pontos pedidos. Mantém-se como está e regista-se como risco conhecido no
  relatório final.

## Em aberto (decisão do dono do produto)

- Num tenant pequeno, se o requerente for ao mesmo tempo o único `ORG_ADMIN` (ou o único
  supervisor do sector), a proibição de auto-aprovação deixa o pedido sem ninguém que o
  possa resolver. Aceitar que fica pendente, ou existe uma via de escape prevista?

## Entregue ao builder

- A escolha exata do helper de mock e a estrutura do ficheiro de teste.
- Se `clientIp` é lido do ctx ou dos headers no `PATCH /approvals/:id` (o handler já
  desestrutura `headers`).
- Como lidar com `notes` no metadata (presente só quando rejeitado).
