# Plano — Funcionalidades Offline Completas (DocID desktop)

> Contexto: Angola com internet instável. A Fase 7 (cache offline de leitura) está completa e funcional.
> Esta ronda estende o modo offline a mais áreas e corrige a lacuna da geração offline.
> Branch: `fix/safeerror-transaction-rollback`.

---

## Relatório da lacuna de geração offline (CONFIRMADA)

### Estado actual
A infra de geração offline está completa no Rust e no backend, mas **nunca é semeada**. Os comandos de seed estão registados no Tauri mas **não têm nenhuma chamada** no frontend nem no motor de sync:

| Recurso local | Comando Rust | Invocado? | Consequência |
|---|---|---|---|
| `local_category_cache` | `cache_categories` (`identifiers.rs:74`, registado em `lib.rs:44`) | **NÃO** | `generate_offline_identifier` falha: "Categoria não encontrada na cache local. Sincronize categorias enquanto online." (`identifiers.rs:351`) |
| `local_tenant_state` | `cache_tenant_state` (`identifiers.rs:106`, `lib.rs:45`) | **NÃO** | `org_prefix` cai no fallback `"VL"` (não fatal, mas prefixo errado) |
| `local_identifier_lease` | `request_lease` (`identifiers.rs:666`, `lib.rs:53`) | **NÃO** | "Sem lease activo para esta categoria. Use o comando request_lease primeiro." (`identifiers.rs:478`) |

### Evidência
- `useGenerateIdentifier.ts:83` é a única referência frontend ao fluxo offline; consome dados que se assumem já existentes na base local.
- O ciclo de sync (`sync/mod.rs`) **só renova** leases existentes (`renew_exhausted_leases` → `apply_lease_renewal`, `sync/mod.rs:581`); nunca adquire o 1º lease nem popula `local_category_cache`/`local_tenant_state`.
- Os inserts de `local_identifier_lease`/`local_category_cache` em `sync/mod.rs:1882,1892` são **helpers de teste** (`ensure_category`/`ensure_lease`), não código de produção.
- `request_lease` depende de `local_category_cache` já populado (`identifiers.rs:696-700`) → ordem obrigatória: **categorias → tenant state → leases**.
- Backend OK: `POST /identifiers/lease` existe (`apps/api/src/modules/identifiers.module.ts:14`) e devolve `{ data: { id, startSeq, endSeq } }`, compatível com o parsing de `request_lease`.

**Conclusão**: em produção a geração offline está quebrada desde o início — falha sempre, mesmo após períodos online.

---

## FASE 0 — Fix da lacuna de geração offline (pré-requisito)

### Objectivo
Semear a base local enquanto online para que a geração offline funcione no primeiro instante em que a rede cai.

### Decisão de design
- **Seed no motor de sync Rust** (`run_sync_cycle_inner`), não no frontend: o sync já corre periodicamente e tem acesso a `SyncState` (base, token, api_base_url).
- Ordem dentro do ciclo: (1) upsert categorias → (2) upsert tenant state → (3) adquirir leases iniciais.

### Passos
1. **Categorias**: extrair a lógica de `cache_categories` (`identifiers.rs:74`) para uma função partilhada e chamá-la no sync, fazendo fetch de `/categories` (usar o endpoint já existente na API). Upsert em `local_category_cache`.
2. **Tenant state**: extrair `cache_tenant_state` (`identifiers.rs:106`) para função partilhada; fazer fetch do estado do tenant (ex.: `/tenants/me`) e gravar `org_prefix` em `local_tenant_state`.
3. **Leases iniciais**: por cada combinação categoria+sector com utilização activa, se **não existir** lease activo em `local_identifier_lease`, chamar o equivalente de `request_lease` (extrair para função partilhada reutilizável). Respeitar o limite por dispositivo imposto pelo backend.
4. **Frontend (belt & suspenders)**: quando as categorias são carregadas online (`Identifiers.tsx`), invocar `cache_categories` via `invoke` para garantir frescura sem depender do timing do sync.
5. **Renovar a manutenção**: manter `renew_exhausted_leases` como está (já cobre renovação a 80%/esgotado).

### Critérios de aceitação
- Com a app usada online durante alguns minutos e depois offline, `generate_offline_identifier` gera identificadores fiscais e não-fiscais sem erro.
- `useGenerateIdentifier` já mapeia os erros relevantes ("Lote esgotado", "Lease revogado", "OFFLINE_NO_DEVICE").

---

## FASE 1 — Upload offline ligado à UI

### Objectivo
Ao falhar o upload de um documento por falta de rede, enfileirar localmente em vez de apenas mostrar erro.

### Contexto
- A infra de fila já existe: `enqueue_upload`/`enqueue_upload_bytes` (Rust), `TauriSyncAdapter.enqueueFromFile`, `SyncService.enqueueFromFile` — mas **nenhuma página a usa**.
- `Documents.tsx:124-143` usa `attach_document_native` (Tauri, HTTP directo) ou `FormData` (browser) — ambos falham offline.
- `OfflineQueuePanel.tsx` só lista/retenta/remove, não enfileira.

### Decisões de design
- Se o erro de rede ocorrer (`mapError`), tentar `enqueueFromFile`; se enfileirar, mostrar feedback "Guardado offline — será enviado quando houver rede".
- Não enfileirar erros de negócio (validação, permissões) — só erros de rede.

### Passos
1. Em `Documents.tsx`, no catch de rede do `attach_document_native`, invocar `SyncService.enqueueFromFile(file, docId?, metadata)`.
2. Confirmar que o `OfflineQueuePanel` mostra os itens enfileirados e permite retry/remove (já o faz).
3. Ligar o flush: verificar que o `run_sync_cycle` processa a fila automaticamente quando a rede volta (validar `sync_upload_queue`).

### Critérios de aceitação
- Offline: anexar documento enfileira com feedback explícito; item aparece no painel.
- Online: o item é enviado automaticamente e sai da fila.

---

## FASE 2 — Cache de endpoints auxiliares

### Objectivo
Levar a cache offline de leitura (Fase 7) aos endpoints que ainda a não usam.

### Contexto
Já não estão na cache: `/categories`, `/sectors/:id/members`, `/sectors`+`/users` usados em dropdowns, exports.

### Decisões de design
- Reutilizar `useOfflineCache` e `OfflineCache` (TTL por endpoint em `CACHE_TTLS`, chave `cache:v1:{tenant}:{user}:{endpoint}:{params}`).
- Adicionar entradas de TTL novas em `CACHE_TTLS` para `/categories` e `/sectors/:id/members`.

### Passos
1. `/categories`: ligar `useOfflineCache` na carga de categorias (já usada em Identifiers — estender).
2. `/sectors/:id/members` e dropdowns de sectores/utilizadores: aplicar o mesmo hook onde os dados são carregados.
3. Atualizar `CACHE_TTLS` no `OfflineCache.ts` com os novos endpoints.

### Critérios de aceitação
- Offline: dropdowns e listagens auxiliares mostram dados da cache (com `isStale` indicado quando aplicável).

---

## FASE 3 — Download offline de documentos

### Objectivo
Permitir abrir/baixar documentos já sincronizados sem rede.

### Contexto
- `Documents.tsx:55/194` usa `window.open(fileUrl)` — sem cache local; falha offline.
- O watcher já guarda ficheiros localmente (100% offline) — reutilizar a infra de armazenamento local.

### Decisões de design
- Comando Rust `download_document_offline`: verifica cache local de ficheiros; se ausente e online, descarrega e guarda; devolve caminho local.
- Cache em disco (reutilizar dirs já usados pelo watcher/uploads), com limite de tamanho/idade.

### Passos
1. Implementar comando Rust para obter/guardar o ficheiro localmente (reutilizar `download_document` da API quando online).
2. Frontend: ao clicar em download, invocar o comando; abrir o caminho local se offline.
3. Indicar no UI quando o documento está disponível offline.

### Critérios de aceitação
- Documentos previamente abertos/baixados abrem offline.
- Documentos nunca vistos offline mostram estado "não disponível offline".

---

## FASE 4 — Fila de escritas offline

### Objectivo
Enfileirar mutações (sectores, users, aprovações, cancelar identificador, etc.) para aplicação posterior quando a rede voltar.

### Contexto
- Lista completa de endpoints de escrita não enfileirados obtida na exploração (sectores, users, approvals, cancel, devices/deactivate, tenants/me, auth/me, notifications-preferences, classifier/feedback, documents/share, force-release).
- Alta complexidade: idempotência, ordem, conflitos, expiração de tokens no replay.

### Decisões de design (a validar com o utilizador antes de implementar)
- **Âmbito mínimo**: apenas as mutações mais críticas (aprovações e cancelamento de identificador) numa 1ª iteração; alargar depois.
- **Idempotência**: chave de idempotência por operação (padrão já usado na fila de uploads).
- **Ordem**: FIFO por recurso; sem paralelismo no replay.
- **Conflitos**: última-escrita-vence com aviso; rejeitar replay de aprovações já processadas (estado no servidor manda).
- **Auth**: se o token expirar durante o replay, pausar e pedir re-login.

### Passos
1. Definir schema da fila de escritas (nova tabela, semelhante a `upload_queue`).
2. Adaptador Rust + comando de enqueue; wrapper frontend que enfileira no erro de rede.
3. Replay no `run_sync_cycle_inner` com idempotência e tratamento de conflitos.
4. UI: painel análogo ao `OfflineQueuePanel` para escritas pendentes.

### Critérios de aceitação
- Offline: mutação crítica fica pendente com feedback.
- Online: replay automático; operações duplicadas não criam registos duplicados.

---

## Ordem de execução e riscos

| Ordem | Fase | Risco | Mitigação |
|---|---|---|---|
| 1 | **0 — Fix lacuna geração offline** | Médio (toca no sync) | Extrair lógica para funções partilhadas com testes existentes; validar com testes Rust |
| 2 | **1 — Upload offline UI** | Baixo (infra existe) | Reutilizar `enqueueFromFile`; testes manuais offline/online |
| 3 | **2 — Cache endpoints auxiliares** | Baixo (padrão Fase 7) | Reutilizar `useOfflineCache`/`CACHE_TTLS` |
| 4 | **3 — Download offline docs** | Médio (novo comando Rust) | Reutilizar storage do watcher; limite de tamanho |
| 5 | **4 — Fila de escritas offline** | Alto (conflitos/idempotência) | Âmbito mínimo 1ª iteração; design validado antes |

### Verificações obrigatórias em cada fase
- `tsc --noEmit` limpo (Regra 7).
- Releitura do resultado de cada edição (Regra 8).
- `cargo test` no `src-tauri` para mudanças Rust.
- Actualizar `docs/BACKLOG.md` (nova Fase 8) no fim.

## Regras de projecto
- Regra 4: "Ausência de X" = negação (dados vazios), nunca ausência de filtro.
- Regra 11: decisões de negócio não especificadas → parar e perguntar ao utilizador.
- Ler `docs/CLAUDE.md` integralmente antes de escrever código.
