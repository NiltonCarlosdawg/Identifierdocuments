# DocID — Estratégia MVP para Claude Code

> Este ficheiro é a fonte de verdade para o desenvolvimento do MVP do DocID.
> Lê o `CLAUDE.md` (contexto técnico completo do produto) antes de ler este ficheiro.
> Este documento define **o que construir**, **em que ordem**, e **porquê** — com base em sessões de product strategy da VERANO Labs.

---

## 1. Contexto Estratégico

### O que é o DocID

Plataforma desktop de gestão documental empresarial para o mercado angolano. O diferencial central é o **identificador único rastreável** (`VL-PROP-2026-0424-001`) que cada documento recebe antes de ser emitido, garantindo rastreabilidade fim-a-fim.

### O problema que resolve

Empresas angolanas gerem documentos pelo WhatsApp, email e drives partilhadas sem controlo de versões, sem rastreabilidade, sem controlo de acesso por sector. O DocID resolve isto com um fluxo estruturado e obrigatório.

### Primeiro cliente alvo

Empresa de investimentos em Luanda (captação de investimento para projectos e startups, investidores nacionais e internacionais). Perfil de documentos críticos: PROP, NDA, MOU, CPS, REL. Conversa de validação agendada em breve.

### Modelo de adopção

A VERANO Labs oferece **serviço de instalação e formação** incluído. A equipa instala o DocID nas máquinas da empresa cliente e forma o pessoal de TI para que possam gerir o sistema de forma autónoma. Isto resolve a fricção de onboarding e cria um aliado interno (o IT como *champion* do sistema).

### Risco principal não-técnico

As pessoas voltam ao WhatsApp se o sistema der mais trabalho. A mitigação não é técnica — é processual: a gestão da empresa tem de definir uma regra clara (*"documentos oficiais só saem com identificador DocID"*) e o DocID tem de ser mais rápido do que o WhatsApp para as tarefas core.

---

## 2. O Que NÃO Entra no MVP

Estes módulos estão definidos na arquitectura mas **não são construídos agora**. Só entram após validação com clientes reais:

- Scanner (integração TWAIN/WIA/SANE)
- File watcher (Rust notify crate)
- Fila offline SQLite (Tauri + sync automático)
- Classificação por IA (Groq API)
- Roles custom e permissões granulares
- Partilha com utilizador individual (só sector por agora)
- Estatísticas avançadas
- App Tauri completa com todas as funcionalidades (começa funcional, não perfeita)

**Porquê excluir agora:** O primeiro cliente (empresa de investimentos em Luanda) tem internet estável no escritório, não usa scanner no fluxo core, e não precisa de IA para começar. Construir estes módulos antes de ter feedback real é desperdício de tempo.

---

## 3. Pré-condição: Fixes de Arquitectura

**Antes de construir qualquer coisa nova**, os dez problemas de arquitectura identificados no documento de fixes consolidado (rate limiting, RBAC, SSE hardening, cross-sector sharing, etc.) têm de estar resolvidos.

Não faz sentido construir partilha e aprovações por cima de uma base com problemas conhecidos.

> **Estado (24 Junho 2026):** Todos os fixes de arquitectura foram implementados e validados:
> - Rate limiting: `middleware/rateLimit.ts`
> - RBAC: `middleware/rbac.ts` + `middleware/auth.ts`
> - Tenant isolation: `middleware/tenant.ts` + `db/rls.ts` (corrigido bug em roles de sistema)
> - Cross-sector sharing: `modules/documents.module.ts`
> - SSE notifications: `services/notification.service.ts`

---

## 4. MVP — Duas Fases

### Fase 1 — Fundação

Tudo isto tem de estar perfeito e estável antes de avançar para a Fase 2. É o esqueleto sem o qual nada funciona.

**Ordem de construção:**

```
1. Auth + JWT
2. Multi-tenancy + RLS PostgreSQL
3. Sectores + Utilizadores
4. RBAC (ORG_ADMIN, SECTOR_SUPERVISOR, MEMBER)
5. Geração de identificador (aperfeiçoar o que já existe)
6. Attach + verificação de texto (aperfeiçoar o que já existe)
7. Consulta + Download (aperfeiçoar o que já existe)
8. Audit logs (aperfeiçoar o que já existe)
```

**Nota:** O DocID v1 já tem geração de identificador, attach, consulta, download e audit. A Fase 1 é essencialmente construir auth + multi-tenancy + RBAC por cima do que já existe — não é do zero.

**Critério de conclusão da Fase 1:** Um utilizador consegue fazer login, gerar um identificador, anexar um documento com esse identificador no texto, e o sistema aceita ou rejeita correctamente. Tudo com isolamento de tenant funcional.

---

### Fase 2 — Produto Vendável

Só começa quando a Fase 1 está estável e testada. Estes módulos são o que torna o MVP vendável ao primeiro cliente.

**Ordem de construção:**

```
1. Partilha de documento por sector
2. Workflow de aprovação (SECTOR_SUPERVISOR aprova/rejeita)
3. Notificações SSE (supervisor recebe alerta de documento pendente)
4. Dashboard básico (documentos recentes, identificadores gerados, pendentes)
5. Painel de administração (gestão de sectores e utilizadores pelo ORG_ADMIN)
6. UI React no Tauri — funcional para demo real (não tem de ser perfeita)
```

**Critério de conclusão da Fase 2 (MVP completo):** É possível instalar o DocID numa empresa, criar o tenant, configurar sectores e utilizadores, e executar o fluxo completo:

```
Login → Gerar identificador → Incluir no documento →
Anexar ficheiro → Partilhar com sector → Supervisor aprova →
Download do documento aprovado → Audit log regista tudo
```

---

## 5. Fluxo Core do MVP (não pode ter quebras)

Este é o fluxo que tem de funcionar sem erros para o MVP estar pronto:

```
1. GERAR IDENTIFICADOR
   Utilizador (sector X) → POST /identifiers/generate
   → { identifier: "VL-PROP-2026-0424-001" }
   → Deve ser rápido: < 2 segundos

2. INCLUIR NO DOCUMENTO
   O ficheiro (PDF/DOCX) deve conter o texto "VL-PROP-2026-0424-001"

3. ANEXAR FICHEIRO
   POST /documents/attach (multipart)
   → API extrai texto → verifica se identificador está presente
   → Se sim: guarda ficheiro, status = "attached"
   → Se não: rejeita com 422 e mensagem clara

4. PARTILHAR
   POST /documents/share
   → { documentId, targetSectorId }

5. APROVAÇÃO
   Sistema cria registo em approvals (status: pending)
   → Supervisor recebe notificação SSE
   → PATCH /approvals/:id { status: "approved" | "rejected" }

6. CONSULTAR / DOWNLOAD
   GET /identifiers/VL-PROP-2026-0424-001
   GET /documents/VL-PROP-2026-0424-001/download
```

---

## 6. Categorias Prioritárias para o Primeiro Cliente

Para a empresa de investimentos, estas são as categorias mais críticas (subset das 45 totais):

| Código | Nome | Porquê é prioritário |
|--------|------|----------------------|
| PROP | Proposta Comercial | Core do negócio — propostas a investidores |
| NDA | Acordo de Confidencialidade | Obrigatório antes de qualquer deal |
| MOU | Memorando de Entendimento | Formalização de intenções |
| CPS | Contrato de Prestação de Serviços | Contratos com clientes/parceiros |
| REL | Relatório Financeiro | Relatórios para investidores |

As restantes 40 categorias já estão definidas no schema e devem estar disponíveis — apenas estas cinco são o foco de validação inicial.

---

## 7. Regras de Qualidade Não-Negociáveis

Estas regras vêm do CLAUDE.md e aplicam-se a todo o código do MVP:

**Segurança:**
- NUNCA retornar `password_hash` em qualquer resposta
- SEMPRE validar `tenant_id` do JWT contra o recurso acedido
- SEMPRE usar prepared statements (Drizzle faz por defeito)
- Audit logs são IMUTÁVEIS — sem UPDATE/DELETE na tabela `audit_logs`

**Performance:**
- Dados buscados na fronteira (módulo/rota), não em cada componente filho
- `Promise.all()` para queries paralelas independentes
- Índices obrigatórios: `tenant_id`, `sector_id`, `identifier`, `status`, `created_at`
- Cache Redis para: categorias (imutáveis), stats, sessões

**API:**
- Respostas sempre: `{ data, meta?, error? }`
- Erros: `{ error: { code, message, details? } }`
- Paginação: `?page=1&limit=20` → `{ data, meta: { total, page, limit } }`
- Datas: ISO 8601 (UTC)

**Geração de identificador:**
- Formato: `{PREFIXO}-{CATEGORIA}-{ANO}-{MMDD}-{SEQ}`
- Exemplo: `VL-PROP-2026-0424-001`
- Sequência com zero-padding de 3 dígitos (001–999 por dia/categoria)
- Em multi-tenant: prefixo `VL` configurável por organização

---

## 8. Decisão sobre eSign

**O DocID não implementa eSign no MVP nem na Fase 2.**

Assinaturas electrónicas com valor jurídico em Angola envolvem ICP-Angola, Lei 23/11, certificados digitais e carimbos temporais — é um produto separado, não um feature. A Assinebwé já opera neste espaço em Angola.

A estratégia correcta é **parceria futura com a Assinebwé** (ou similar) quando o DMS estiver validado, não construir eSign internamente.

---

## 9. Decisão sobre Desktop vs. Web

**O MVP é Tauri desktop**, mas a UI React é a mesma que poderia ser web. A justificação para desktop mantém-se: scanner (TWAIN/WIA), file watcher, offline upload com garantia de entrega.

Para utilizadores que só precisam de **consultar e aprovar** documentos (não de digitalizar nem de trabalhar offline), uma versão web complementar pode ser considerada na Fase 3 — não agora.

---

## 10. Fases Futuras (pós-MVP)

> **Ambiente de desenvolvimento (24 Junho 2026):**
> - Tenant de teste: `verano-test` (Verano Labs Test) — admin@test.ao / test1234
> - Tenant de teste 2: `emp-b` (Empresa B) — admin@b.ao / test1234
> - Todos os testes E2E executados com sucesso: login, identificadores, attach, partilha, aprovações, notifications, audit logs, multi-tenant isolation, 422 para identificador em falta.

Depois de ter o MVP validado com o primeiro cliente, as próximas prioridades são:

**Fase 3 — Diferenciação técnica:**
- Classificação por IA (Groq API — llama-3.3-70b)
- Fila offline SQLite (Tauri + sync automático)
- File watcher com detecção de identificador por regex
- Scanner (TWAIN/WIA no Windows, SANE no Linux)

**Fase 4 — Escala e compliance:**
- Roles custom com permissões granulares
- Partilha com utilizador individual
- Estatísticas avançadas e exportação de audit
- Início do processo de homologação INFOSI (para clientes governo)
- Roadmap ISO 27001

**Fase 5 — Expansão:**
- Integração com ERPs angolanos (Cacimbo, Ryakeza, MetaGest)
- Versão web complementar
- Expansão PALOP (São Tomé, Cabo Verde, Moçambique)

---

## 11. Checklist de Conclusão do MVP

Usa esta lista para confirmar que o MVP está pronto para o primeiro cliente:

### Fase 1
- [x] Auth JWT funcional (login, sessão, refresh, logout) — ✅ testado E2E
- [x] Multi-tenancy com RLS PostgreSQL a isolar dados por tenant — ✅ corrigido bug de RLS em roles de sistema
- [x] Criação de sectores e utilizadores — ✅ testado E2E
- [x] RBAC: ORG_ADMIN, SECTOR_SUPERVISOR, MEMBER a funcionar correctamente — ✅ testado E2E
- [x] Geração de identificador no formato correcto e sem duplicados — ✅ testado E2E
- [x] Attach com verificação de texto do identificador (aceita ou rejeita com 422) — ✅ testado E2E
- [x] Consulta e download de documentos — ✅ testado E2E
- [x] Audit logs imutáveis a registar todas as acções — ✅ testado E2E

### Fase 2
- [x] Partilha de documento por sector — ✅ testado E2E
- [x] Workflow de aprovação (pending → approved/rejected) — ✅ testado E2E
- [x] Notificações SSE ao supervisor quando há documento pendente — ✅ implementado e testado
- [x] Dashboard básico (documentos recentes, pendentes, identificadores gerados) — ✅ implementado
- [x] Painel de administração para ORG_ADMIN (sectores, utilizadores) — ✅ implementado
- [x] UI React no Tauri funcional para demo completa — ✅ compila e integra com API
- [x] Fluxo de ponta a ponta testado sem quebras — ✅ E2E completo executado

### Qualidade
- [x] Nenhuma rota retorna `password_hash` — ✅ verificado no código
- [x] Todos os endpoints validam `tenant_id` do JWT — ✅ middleware/tenant.ts + RLS
- [x] Índices criados nas colunas críticas — ✅ schema.ts com índices
- [x] Testes de isolamento entre tenants (cross-tenant access impossível) — ✅ testado E2E
- [x] 28 testes unitários/integração passam — ✅ `bun test`

### Bugs corrigidos durante validação
- **Seed duplicava roles de sistema** — corrigido com lógica find-or-insert explícita
- **RLS não permitia visibilidade de roles de sistema (tenant_id=NULL)** — corrigido com policy `tenant_id IS NULL OR tenant_id = current_setting(...)`
- **tsconfig do desktop incluía `__tests__` no build** — corrigido com `exclude`

---

> Documento criado em Junho 2026 — VERANO Labs, Luanda, Angola.
> Sessão de product strategy com definição de MVP, modelo de adopção e primeiro cliente alvo.
> **Actualizado em 24 Junho 2026** — MVP validado e completo. Todas as fases testadas E2E com sucesso.
