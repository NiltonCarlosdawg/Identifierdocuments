# DocID Platform — Descrição Técnica

Gestão de documentos empresariais com identificador único, acesso por sector e numeração fiscal
válida mesmo sem internet. Verano Labs, Luanda · Novembro de 2026 · app desktop 1.2.7.

## Componentes

| Componente | Tecnologia | Onde corre |
|---|---|---|
| App desktop | Tauri v2, React 18 + Vite + Tailwind, Rust, SQLite local | Windows e Linux (macOS gera `.dmg`, ainda não distribuído) |
| API | Elysia + Drizzle ORM; Bun em desenvolvimento, Node 22 em produção | `didall.milvendas.ao` (cPanel/CloudLinux) |
| Base de dados | PostgreSQL com Row Level Security; Redis opcional | servidor da API |
| Painel da provedora | Vite + React | `docid.milvendas.ao/admin/` |
| Site e checkout | Vite + React + Tailwind | `docid.milvendas.ao` |
| IA | Groq API (llama-3.3-70b) para sugerir a categoria | serviço externo |

## Como funciona

- **Identificador:** `PREFIXO-CATEGORIA-AAAA-MMDD-NNN` (ex.: `VL-PROP-2026-0424-001`). O prefixo é da
  organização (1–6 letras, fixo depois do primeiro identificador); a sequência é por organização e
  categoria e nunca recomeça; a data é a da emissão, no fuso de Luanda.
- **Documento:** gerar o identificador → incluí-lo no documento → anexar o ficheiro (a API procura o
  identificador no texto e regista o resultado) → versões e anexos → partilhar por sector ou
  utilizador (noutro sector exige aprovação do supervisor) → consulta, download e auditoria.
- **Acesso:** roles por sector (`ORG_ADMIN`, `SECTOR_SUPERVISOR`, `MEMBER`) e roles custom;
  visibilidade pública ou só do sector, com pedidos de acesso.
- **Várias organizações:** cada pedido corre numa transacção com `SET LOCAL app.current_tenant`; o
  RLS isola os dados mesmo que o código tenha um bug. O utilizador da BD em produção não tem
  `BYPASSRLS`.
- **Offline:** as 6 categorias fiscais (FAT, REC, NOT, NDB, GUE, ORD) usam lotes de números
  reservados por computador; as restantes usam números provisórios. Leitura a partir de cache
  encriptada (AES-GCM), filas de uploads e de escritas com idempotência, downloads em cache. Ao
  voltar a rede tudo sincroniza sozinho, sempre com a sessão de quem criou cada item.
- **No desktop:** vigilância de pastas que reconhece identificadores, scanner (TWAIN no Windows,
  SANE no Linux), impressoras, notificações nativas, actualização automática assinada.
- **Comercial:** planos em Kwanzas, período de teste de 14 dias, licença com modo só consulta,
  checkout na landing com validação manual do pagamento, painel da provedora.
- **Notificações:** tempo real (SSE) e e-mail por organização, por fila transaccional em PostgreSQL.

## Modelo de dados

- **Servidor:** organizações, sectores, utilizadores e roles; 42 categorias (flag
  `requiresSequential`); identificadores; documentos, versões, partilhas, pedidos de acesso e
  aprovações; dispositivos, lotes de números e números devolvidos; notificações e e-mails;
  auditoria imutável; feedback da IA; planos, pedidos e licenças.
- **Computador (SQLite):** lotes locais, contadores, identificadores pendentes, filas de uploads e
  de escritas, cache de categorias e da organização, ficheiros detectados. É um buffer de
  sincronização, não uma réplica.

## Qualidade e operação

- **Testes:** `bun test` na API (incluindo testes com um utilizador de BD sem bypass do RLS) e no
  desktop, `cargo test` no Rust (Linux e Windows), Playwright E2E contra uma API real.
- **Deploy:** cada push para `main` publica API, painel e site; as migrações correm com o dono das
  tabelas e, se a API nova não responder, o código anterior é reposto.
- **Releases:** subir a versão e fazer merge publica os instaladores, o site e o auto-update.
- **Segurança:** auditoria com 52 falhas corrigidas, correcções de 23/11/2026 (sessões, limites de
  pedidos, chave local no cofre do sistema), Swagger desligado em produção.

## O que falta

- Confirmação por um contabilista angolano das categorias com numeração sequencial.
- Testes manuais em runtime dos fluxos offline e do computador partilhado.
- Monitorização e alertas próprios (hoje: watchdog por cron e UptimeRobot).
- Assinatura Authenticode do instalador Windows e Apple para macOS.
- Unificar as peças de licenciamento e automatizar o pagamento Multicaixa.
