# Design: Sistema de Licenças e Subscrições (DocID)

**Data:** 2026-11-23
**Estado:** Implementado e em produção (ver `docs/BACKLOG.md`, Fase 16). Diferenças: coexiste com
as licenças por organização (`docs/LICENCAS.md`), que trazem o período de teste de 14 dias e o
modo só consulta.

## 1. Intenção

A empresa provedora (doravante "provedora") vende licenças anuais às empresas clientes ("tenants"). Cada tenant começa no plano **free** com limites rígidos; ao precisar de mais, faz um pedido de subscrição pelo checkout na landing page, a provedora valida o pagamento à mão no painel admin, e o tenant passa a plano pago. Os planos são dados dinâmicos — criados e editados inteiramente pelo painel, sem alterações de código.

## 2. Objectivos

- Planos dinâmicos (nome, preço em kwanzas, limites) geridos 100% pelo painel admin.
- Limites impostos pela API: nº de utilizadores, identificadores online/mês, números offline por máquina.
- Fluxo de checkout com pedido pendente → aprovação manual da provedora → ativação → email ao criador do tenant.
- Renovação anual com alertas e campanhas automáticas.
- Poder manual da provedora de suspender/reativar tenants.
- Migração suave dos tenants existentes para free.

## 3. Não-objetivos (YAGNI)

- Pagamento automático/integração com gateway (Multicaixa API etc.) — a validação é manual.
- Marketplace de planos, trial pago, faturação/recibos automáticos, IVA.
- Multi-moeda — tudo em kwanzas (AOA).
- Painel de provedora dentro do desktop Tauri.

## 4. Arquitetura

| Peça | Onde | Notas |
|---|---|---|
| Tabela `plans` | `apps/api` (PostgreSQL) | Fonte única dos limites |
| Tabela `orders` | `apps/api` | Pedidos de subscrição pendentes |
| Tabela `provider_users` | `apps/api` | Auth própria do painel, fora do contexto de tenant |
| Painel admin | `apps/admin` (novo, Vite+React como a landing) | Vistas: pedidos, planos, tenants |
| Checkout + secção de planos | `apps/landing` (`/checkout`, secção Plans) | Busca planos por endpoint público |
| Imposição de limites | API (ponto único de verdade) | Desktop e landing apenas mostram/avisam |
| Estado da subscrição na app | Desktop: Definições → Organização | Estado, plano, data de fim, botão upgrade/renovação |

**Auth do painel:** JWT de escopo próprio (`provider`), validado sem contexto de tenant — é o único caminho que lê e escreve em todos os tenants. Nada do painel segue no instalador Tauri.

**Identificação do tenant no checkout:** o aviso dentro da app gera link `/checkout?pedido=<token>` com JWT assinado de utilização única, expira em 1–2 dias, embute o `tenantId`. A landing mostra "Empresa: X" e submete já associado. Fallback: quem chegar sem token escreve slug ou email da organização — a API valida que o tenant existe antes de criar o pedido.

## 5. Modelo de plano

Campos do plano (todos editáveis no painel):

- `name`, `price` (AOA, por ano)
- `maxUsers` — nº máximo de utilizadores/emails do tenant
- `monthlyOnlineIdentifiers` — teto mensal de identificadores online
- `offlineBudgetPerMachine` — números offline totais por máquina (orçamento gasto por reservas/leases)

**Plano free (fixo, seed):**

| Limite | Valor |
|---|---|
| Utilizadores | 1 |
| Identificadores online | 10/mês |
| Números offline | 10 por máquina — **uma única vez, só para o admin** em free, nunca se repõem |

- Free ativo: o único limite é o de identificadores online (10/mês). Não há limites de uploads nem de nº de documentos enquanto a subscrição está ativa.
- Geração offline em free: **apenas o admin**, com os 10 números iniciais. Esgotou, não volta mais (nem ao passar para pago).

**Planos pagos:**

- Limites (utilizadores, identificadores online/mês, números offline por máquina) definidos no painel.
- Números offline **repõem-se mensalmente**.
- Geração offline disponível a qualquer utilizador do tenant (orçamento do plano).

**Tamanho de lote (lease):** o plano é a fonte única. O campo `organizations.identifierLeaseBatchSize` desaparece de Definições → Organização; o valor passa a vir do plano ativo. As reservas (leases) existentes gastam o orçamento offline do tenant.

## 6. Ciclo de vida do tenant

Estados: `free` → `paid` → `expired`; mais `suspended` (manual da provedora).

**Renovação/upgrade:** plano substituído de imediato na aprovação, data de fim recalculada a partir da data de aprovação (+1 ano). Não soma ao que restava do período anterior.

**Suspensão manual:** a provedora suspende/reativa no painel; suspendido = **mesmas condições de expirado**. Ação registada em auditoria.

## 7. Condições de expiração (e suspensão manual)

Quando a subscrição acaba ou é suspensa:

- Todos os utilizadores entram, veem e mexem no que já existe (abrir, editar, download, partilhar).
- **Sem dados novos:** uploads limitados a **1 documento/dia por utilizador**; sem novos utilizadores; criação de identificadores **bloqueada para não-admins**.
- Lotes já reservados pelas máquinas (leases) continuam consumíveis offline até zerarem.
- **Sem novas reservas** de lotes até renovação.
- Itens enfileirados **antes** da expiração sobem normalmente depois (sem retenção).

## 8. Fluxo de pedido (checkout)

1. Utilizador no free atinge o limite de utilizadores → aviso na app com link para checkout (token do tenant).
2. Na landing, `/checkout`: escolha do plano + forma de pagamento:
   - **Referência Multicaixa**
   - **Transferência**
   - **Enviar pedido** — plano, forma de pagamento pretendida, telefone e email de contacto.
3. Pedido criado com estado **pendente**.
4. Email automático à provedora para verificar o pagamento.
5. No painel: **aprovar** ou **rejeitar** (com motivo).
   - **Aprovado:** tenant `free` → `paid`, plano atribuído, data de fim = aprovação + 1 ano. O sistema verifica a ativação — em produção confirma só a transição free→pago; em dev o teste cobre também a geração de identificador sem bloqueio. Depois, email ao criador do tenant: "subscrição concluída".
   - **Rejeitado:** tenant mantém-se free; email ao criador com o motivo; pode submeter novo pedido pelo checkout.

## 9. Renovação anual

Alertas disparados a **30, 14 e 2 dias** do fim (e no próprio dia da expiração, para a provedora):

- **Provedora:** alerta (email) para contactar o cliente.
- **Criador do tenant:** campanha automática de renovação → mesmo fluxo de checkout.

## 10. Migração (arranque em produção)

1. Todos os tenants existentes → plano free.
2. Tenants com mais utilizadores do que o limite free (ex.: 8 vs 1): **mantêm** os que têm; não adicionam mais.
3. Cada admin de tenant em free recebe a reserva única de 10 números offline por máquina (uma vez, não repõe).
4. `identifierLeaseBatchSize` removido das Definições; valor passa do plano.

## 11. Painel admin (`apps/admin`)

Vistas (por agora):

1. **Pedidos** — lista de pendentes, aprovar/rejeitar (com motivo), histórico.
2. **Planos** — criar/editar: nome, preço AOA, maxUsers, monthlyOnlineIdentifiers, offlineBudgetPerMachine. O plano **free não é editável** no painel (fixo pelo seed para não quebrar a migração).
3. **Tenants** — lista de todos os tenants, estado (free/paid/expired/suspended), plano, data de fim; ações suspender/reativar (auditoria).

## 12. Segurança

- Endpoints de limites impostos sempre na API (nunca só no UI).
- Token de checkout: assinado, single-use, expira em 1–2 dias.
- JWT do painel com escopo `provider`, sem acesso a dados de conteúdo dos tenants além do necessário (estado/plano/limites).
- Ações da provedora (aprovar, rejeitar, suspender, reativar, editar planos) registadas em auditoria.
- Fallback do checkout valida slug/email do tenant antes de criar pedido.

## 13. Testes

- **Produção:** ao aprovar pedido, verifica-se apenas a transição free→pago + email enviado.
- **Dev:** teste adicional — geração de identificador após ativação sem bloqueio.
- Testes de imposição: convite acima do limite bloqueado; identificadores online acima do teto mensal bloqueados; lease acima do orçamento bloqueado; expiração → 1 upload/dia, sem criação de identificadores (não-admin), sem novas reservas; fila pré-expiração sincroniza.
- Migração: seed do plano free + atribuição única dos 10 offline ao admin.

## 14. Decisões em aberto para o implementador

Nenhuma — todas as decisões de negócio estão tomadas neste documento. O implementador deve seguir os padrões existentes (Drizzle schema em `apps/api/src/db/schema.ts`, rotas Elysia, landing Vite/Tailwind, RLS por tenant) e recorrer a `writing-plans` para o plano de implementação.
