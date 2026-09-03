# Ponto de Situação (PDS) — DocID Platform

> **Período coberto:** 20 de Julho a 3 de Agosto de 2026 (2 semanas)
> **Objectivo deste documento:** apresentar, em linguagem simples, tudo o que foi feito neste período.
> **Data do documento:** 03-08-2026

---

## 1. Resumo em 30 segundos

Nestas duas semanas a equipa **concluiu a funcionalidade mais importante do produto**: a capacidade de **gerar números de documentos válidos (identificadores) mesmo sem ligação à internet**.

Isto significa que um colaborador que esteja numa zona sem rede consegue continuar a emitir facturas, recibos e outros documentos com numeração oficial, sem risco de duplicar números entre computadores. Quando a internet volta, o sistema envia tudo automaticamente para o servidor, sem que ninguém tenha de fazer nada.

Além disso, foram feitas melhorias de usabilidade e segurança no dia-a-dia da aplicação.

---

## 2. O que isto significa para o negócio

| Antes | Agora |
|---|---|
| Sem internet → não era possível gerar números de documentos | Sem internet → continua tudo a funcionar normalmente |
| Risco de dois computadores emitirem o mesmo número | Sistema reserva lotes de números por computador, eliminando duplicados |
| Colaborador tinha de esperar pela rede para trabalhar | Trabalho não pára, independentemente da ligação |

**Benefício prático:** mais produtividade e zero falhas na numeração de documentos fiscais (exigência legal em Angola), mesmo em cenários de má ou nenhuma ligação.

---

## 3. Cronologia simples do que foi feito

### Semana 1 (20 a 26 de Julho)

| Dia | O que foi feito |
|---|---|
| **20 Jul** | Construída a base da nova funcionalidade: o sistema passou a conseguir "reservar" números por computador e registar documentos gerados sem internet. |
| **21 Jul** | O computador passou a conseguir guardar números e dados localmente (no próprio disco), para quando não houver rede. |
| **22 Jul** | Reforço de segurança e registo de tudo o que acontece (auditoria) para não haver perdas nem duplicações. |
| **23 Jul** | Concluída a parte mais complexa: a sincronização automática. Quando a internet volta, os documentos feitos offline são enviados ao servidor sozinhos, mesmo que tenham sido criados por vários computadores. |
| **24 Jul** | Actualização da aplicação (interface): ecrã de geração de documentos com opção online/offline, ecrã de "documentos pendentes", melhoria do perfil do utilizador, gestão de supervisores de sector, painel com estatísticas (dashboard) e preparação da versão instalável com pipeline de testes automáticos. |
| **26 Jul** | Fechamento do circuito: o sistema passou a identificar e registar cada computador (dispositivo), garantindo que cada um tem o seu lote de números exclusivo. |

### Semana 2 (27 de Julho a 3 de Agosto)

| Dia | O que foi feito |
|---|---|
| **27–31 Jul** | Ajustes finais na aplicação (versão 1.1.5) e melhoria de estabilidade: se o servidor de apoio (Redis) estiver em baixo, a aplicação continua a funcionar normalmente em vez de bloquear. |
| **3 Ago** | Preparação deste ponto de situação. |

---

## 4. O que ficou pronto para os utilizadores

1. **Gerar documentos sem internet** — ecrã indica claramente se o número é "definitivo" ou "provisório até sincronizar".
2. **Painel de pendentes** — se um documento não conseguir sincronizar, o utilizador vê exactamente qual é, o motivo, e pode tentar de novo com um clique.
3. **Gestão de computadores** — o administrador vê que computadores existem, quantos números cada um reservou, e pode libertar números de um computador perdido.
4. **Configuração flexível** — o administrador define o tamanho dos lotes de números por computador (10 a 500).
5. **Painel de estatísticas (dashboard)** — números rápidos de documentos, categorias e utilizadores.
6. **Pedidos de acesso a documentos** — fluxo claro de pedido e aprovação entre sectores, com controlos por sector.

---

## 5. Melhorias de segurança e estabilidade

- Reforço da protecção de dados entre organizações (nenhuma empresa vê dados de outra).
- Prevenção de duplicação de números, mesmo em momentos de grande utilização simultânea.
- Se um serviço de apoio falhar, a aplicação continua a funcionar (sem bloqueios).
- Registo (auditoria) legível de todas as acções importantes.

---

## 6. Números do período

- **29 entregas (commits)** realizadas.
- **Cerca de 14 000 linhas** de código novo ou alterado.
- **Trabalho técnico concluído a 100%** nas 3 grandes frentes desta funcionalidade (servidor, aplicação de computador e interface).
- **Testes automatizados:** mais de 90 testes a passar, garantindo qualidade e poucos erros.

---

## 7. O que ainda falta / próximos passos

| Item | Estado |
|---|---|
| Validação das categorias fiscais por um contabilista angolano | ⏳ A aguardar confirmação profissional (decisão de negócio, não de programação) |
| Guardar o trabalho destas semanas (commit final) | ⏳ A fazer |
| Melhorias de longo prazo já planeadas | 📋 Ver plano geral (`BACKLOG.md`) |

---

## 8. Conclusão

O período foi **muito produtivo e atingiu o objectivo central**: a DocID agora funciona **mesmo sem internet**, com segurança e sem duplicação de números — uma capacidade essencial para o mercado angolano, onde a ligação nem sempre é estável.

**Próximo marco:** confirmação fiscal das categorias e publicação da nova versão da aplicação.
