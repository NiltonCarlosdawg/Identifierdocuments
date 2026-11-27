# Análise dos instaladores Windows — estado atual, requisitos Microsoft e melhorias

> **Análise de 20/11/2026, sobre a versão 1.1.6.** Desde então: o instalador NSIS com WebView2 é
> publicado automaticamente pelo workflow *Build & Release* (versão actual 1.2.7, ~304 MB), o MSI
> é gerado e anexado ao release, e o macOS gera `.dmg`. Continua por fazer a assinatura
> Authenticode. Processo actual em `apps/desktop/UPDATER.md`.

Data: 2026-11-20. Âmbito: instaladores do release `desktop-v1.1.6` (NSIS), build portátil e POC MSIX.
Todas as afirmações sobre código têm evidência `ficheiro:linha`; as afirmações sobre a Microsoft
têm URL de documentação oficial e citação literal. O que não foi encontrado está assinalado.

## 1. Como os instaladores são montados hoje

1. Gatilho: `push` com tag `v*` ou `desktop-v*`, ou `workflow_dispatch` — `.github/workflows/build.yml:2-5`.
2. Matrix: `windows-latest` / `x86_64-pc-windows-msvc`, campo `bundle: nsis` — `build.yml:16-18`.
   **Este campo só é usado no caminho do artifact (`build.yml:64`); não filtra o build.**
3. Steps: checkout (`:25`), Bun (`:27`), Rust + target (`:30`), `bun install` (`:43`), `bun run build` (`:47`),
   `tauri-action@v1` (`:51`), `upload-artifact` (`:60`).
4. O `tauri-action` não recebe `args`, por isso usa os targets de `tauri.conf.json:29-34`
   (`nsis`, `msi`, `deb`, `appimage`); com `createUpdaterArtifacts: true` (`:28`) gera também
   `.sig` e `latest.json` e anexa-os ao release (`GITHUB_TOKEN`, `build.yml:56`).
5. Segredos no passo Tauri: `TAURI_SIGNING_PRIVATE_KEY` e `..._PASSWORD` (`build.yml:57-58`).
   São a chave **minisign do updater**, não Authenticode. A chave pública está embutida em
   `tauri.conf.json:71`.
6. O frontend é compilado **duas vezes**: `build.yml:47-49` e `beforeBuildCommand` em
   `tauri.conf.json:10`.
7. POC MSIX, caminho separado: `.github/workflows/build-msix.yml` — `tauri build --no-bundle`
   (`:36`) → copiar `docid-desktop.exe` como `DocID.exe` + manifesto + ícones (`:42-46`) →
   `makeappx pack` (`:56`) → `unpack` para confirmar o exe (`:59`) → certificado auto-assinado
   `CN=MilVendas` com senha literal `poc` (`:66-72`) → `signtool sign` (`:80`) → artifact
   `docid-msix-poc` (`:91-97`). **Não é anexado ao release.**

## 2. O que cada artefacto carrega

| Artefacto | Tamanho | Conteúdo / porquê |
|---|---|---|
| `DocID_1.1.6_x64-setup.exe` (release e site) | 223 675 805 B | Instalador NSIS + runtime WebView2 **standalone offline**. `webviewInstallMode: { type: "offlineInstaller", silent: true }` (`tauri.conf.json:48-51`); ~215 MB vêm do runtime. |
| `DocID_1.1.6_x64-setup.exe.sig` | 417 B | Assinatura minisign do updater sobre os bytes do instalador. `trusted comment` regista `file:DocID_1.1.6_x64-setup.exe`. Não é assinatura Authenticode. |
| `latest.json` | 1 143 B | `version: 1.1.6`, `pub_date: 2026-11-18T00:00:00Z`, `url: https://docid.milvendas.ao/downloads/DocID_1.1.6_x64-setup-WebView2.exe` (revertido em 22/11; o nome curto desapareceu do servidor), `signature`. |
| Exe portátil antigo | 42 945 219 B | Build de 18/11, anterior ao WebView2 embutido. Removido do release e da landing em `ad36e8c`, e do repo em 20/11. |
| NSIS sem WebView2 | 8 592 635 B | Estava em `dist-windows/` — mostrava o custo real do runtime (~215 MB). Removido do repo em 20/11. |
| MSIX POC | 8 309 720 B | `.exe` cru + `AppxManifest.xml` (full-trust) + 3 ícones; usa WebView2 do sistema. |
| MSI | — | Declarado em `tauri.conf.json:31` e `:59-61`, mas **nunca foi produzido**: ausente do release, de `dist-windows/` e de todo o histórico Git. |

Configuração relevante: `installMode: currentUser` e idioma Portuguese (`tauri.conf.json:52-57`),
updater em modo `passive` (`:75-77`), CSP com `connect-src … https: wss:` (`:23`), dependências
Rust com `rusqlite` bundled e `rustls-tls` (`Cargo.toml:24,26`). `resources`/`externalBin`:
**não encontrados**. Versão mínima de Windows **não declarada** no config do NSIS; só no MSIX
(`AppxManifest.xml:24`, `10.0.17763.0`).

Integridade confirmada em 2026-11-20: o ficheiro servido por `docid.milvendas.ao` foi descarregado
por inteiro (223 675 805 B, 405,9 s a ~551 KB/s) e o SHA-256 bate exatamente com o publicado
(`87076c74…badd9`) e com o asset do GitHub. Downloads interrompidos por timeout deram hashes
diferentes — ou seja, o risco é **transferência longa e interrompida**, não ficheiro trocado.

## 3. O que a Microsoft exige (documentação oficial, atualizada em 2026)

### 3.1 Fora da Store — EXE/NSIS

- Sem assinatura: “⚠️ Warning — ‘Windows protected your PC’; User must choose ‘Run anyway’ …
  Enterprise policy can prevent continuation entirely.”
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation (atual. 2026-08-17)
- A reputação é por hash de ficheiro e **não passa entre versões** sem mesma identidade de
  assinatura: “Reputation cannot transfer from previous versions unless both were signed using
  the same publisher identity.” (mesma página)
- “EV certificates no longer bypass SmartScreen.” A página de opções de assinatura confirma que
  o comportamento foi removido em 2024 e que o prémio EV “is no longer justified”.
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options (atual. 2026-11-10)
- Chaves OV em hardware desde junho de 2023: “the CA/Browser Forum requires private keys for OV
  certificates to be stored on a hardware security module (HSM) or hardware token.” (mesma página)
- Smart App Control (Win11 22H2+): “unknown, unsigned code are blocked by default” e só corre
  código reconhecido pela Microsoft ou assinado com certificado de confiança.
  https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview (atual. 2026-10-06)
- Timestamp RFC 3161: sem `/tr` (ou `/t`) o ficheiro não é timestamped; com `/tr` é preciso
  indicar `/td` (ex.: `/tr http://timestamp.digicert.com /td SHA256`).
  https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool (atual. 2026-10-05)
- Regra literal é **todos os ficheiros PE**: “The binary and all of its Portable Executable (PE)
  files must be digitally signed …” (EXE/MSI na Store, ver 3.2). A palavra “uninstaller” não
  aparece literalmente nas páginas consultadas; um uninstaller PE entra nessa regra por inferência.
- Azure Artifact Signing (ex-Trusted Signing): as listas de países **excluem Angola**. Há
  contradição entre duas páginas oficiais (UE/EUA/CA/UK numa; +AU/NZ/JP/KR/SG/CH/NO/IL noutra),
  mas nenhuma inclui Angola. Páginas: `code-signing-options` (acima) e
  https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart (atual. 2026-11-17).

### 3.2 Microsoft Store — MSIX

- “code signing is free and handled for you automatically — Microsoft re-signs the package after
  certification and you don't need to purchase or manage a certificate.”
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- “The Microsoft Store will automatically re-sign your MSIX/AppX packages with a Microsoft
  certificate during the publishing process after your app passes certification.”
  https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements (atual. 2026-08-24)
- **EXE/MSI na Store não são re-assinados**: “You must Authenticode-sign your MSI/EXE installer
  yourself with a valid code signing certificate before submission.” (mesma página)
- Para EXE/MSI na Store: instalação obrigatoriamente silenciosa (“Initiating the install must not
  display an installation user interface (i.e., silent install is required), however a UAC dialog
  is allowed”) e um URL de download versionado cujos bytes não mudam depois da submissão.
  https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements
- Manifesto: `Identity Name`/`Publisher` têm de vir de Partner Center → *View app identity details*
  e **sensíveis a maiúsculas/espaços**; 4.º campo da versão reservado pela Store (deixar a 0);
  WACK obrigatório antes de submeter; política de privacidade obrigatória para produtos Win32 /
  Desktop Bridge que tratem dados pessoais.
  https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements
  https://learn.microsoft.com/en-us/windows/apps/publish/store-policies (v7.20, vigente 2026-10-22)
- `runFullTrust` é uma *restricted capability*: exige justificação no formulário de submissão e
  revisão; “this process typically takes 5 business days or longer”. Sideload não precisa de
  aprovação. A app não pode pedir elevação de administrador nem UIAccess na Store.
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations (atual. 2026-11-12)
  https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-desktop-bridge-app-tests
- Fora da Store, MSIX auto-assinado exige confiar no certificado no dispositivo — é exatamente
  o que o `instalar-poc.ps1` faz.

### 3.3 WebView2

- “The Evergreen WebView2 Runtime will be included as part of the Windows 11 operating system.”;
  na maioria dos Windows 10 já está, mas “a small number of Windows 10 devices don't have” —
  é esse pequeno número que justifica os 223 MB.
- “A production release of a WebView2 app can only use the WebView2 Runtime as the backing web
  platform, not Microsoft Edge.”
- Bootstrapper online ≈ 2 MB; Standalone offline é o instalador completo; Fixed Version >250 MB
  e não pode ser instalado por installer.
- Em MSIX, “you can specify the WebView2 Runtime as a dependency, to have it be installed with the
  application” via App Installer.
  https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution (atual. 2026-10-02)
  https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version

### 3.4 Não encontrado / incertezas

- Não há página oficial consultada que confirme que instalar da Store exige conta Microsoft —
  não repetir essa afirmação como facto.
- Não foi encontrada regra literal “assinar o uninstaller”; a regra é “todos os PE”.
- Não foi encontrado número de build mínimo para MSIX full-trust com `uap10:TrustLevel="mediumIL"`.
- Não foi confirmado se Angola consta como mercado disponível na Store (a doc diz “Default: All possible markets”).

## 4. Melhorias possíveis ANTES de pagar licença

### P0 — corrigir e verificar (horas)

| # | Acção | Evidência / porquê |
|---|---|---|
| **0** | **Garantir que o utilizador continua a ter "Mais informações → Executar mesmo assim"** | A landing já diz isto (`download-section.tsx:127-130`) e o guia B2B repete na Opção 4. Mas a Microsoft avisa que uma política corporativa pode impedir o override (“Enterprise policy can prevent continuation entirely” — `smartscreen-reputation`) e que no Windows 11 com Smart App Control ativo “unknown, unsigned code are blocked by default” (`smart-app-control`) — **nesses casos o botão não aparece**. Acções: (a) pedir aos IT que não bloqueiem o override do SmartScreen; (b) acrescentar ao guia o diagnóstico “se o botão não aparecer, é Smart App Control ou política corporativa → encaminhar para o canal MSIX/Store”; (c) manter esta via como escape até o MSIX assinado pela Store existir. Isto **não remove o aviso** — só protege o caminho de instalação manual. |
| 1 | ~~Publicar um `SHA256SUMS` ao lado do instalador e ligá-lo na landing e no guia B2B~~ **Aplicado em 20/11** | `https://docid.milvendas.ao/downloads/SHA256SUMS` (confirmado por `sha256sum -c`) e link "Verificar integridade" na secção de downloads da landing. |
| 2 | ~~Alinhar o nome do asset do release com o ficheiro servido e com o `file:` do `.sig`~~ **Revertido em 22/11:** a cópia com nome curto desapareceu do servidor e partiu o download e o updater. A fonte de verdade volta a ser `…-WebView2.exe`, que persiste. Mantém-se uma cópia com nome curto apenas para compatibilidade. | Os bytes são idênticos, por isso a assinatura minisign continua válida; o nome no `trusted comment` é meramente informativo. |
| 3 | ~~Verificação automática no CI~~ **Aplicada em 20/11** | `scripts/verify-installer.sh` + `.github/workflows/verify-download.yml` (dispatch, push nos ficheiros relevantes e cron diário). Run `44755801114` verde: landing e `SHA256SUMS` batem com o ficheiro publicado. |
| 4 | ~~Mover a senha literal `poc` do workflow MSIX para um secret~~ **Aplicado em 20/11** | Secret `MSIX_POC_PASSWORD` criado; `.github/workflows/build-msix.yml` passa a lê-lo. |
| 5 | Fazer o bump para 1.1.7 antes de qualquer alteração ao instalador | Hoje `1.1.6` em três sítios; quem já tem 1.1.6 não recebe update. Atenção: o body do release diz que installs 1.1.5 não atualizam sozinhos por rotação da chave minisign — backup da chave em `~/.tauri/docid-updater.key` não está documentado no repo. |

### P1 — reduzir fricção sem certificado (dias)

| # | Acção | Detalhe |
|---|---|---|
| 6 | Concluir o teste de sideload do MSIX e submeter à Store | É o único caminho sem aviso e sem custo de certificado; a Store re-assina. Exige identity/publisher do Partner Center, `runFullTrust` justificado, WACK, política de privacidade e aprovação (5+ dias úteis). |
| 7 | Oferecer um instalador "leve" como opção secundária | Tauri `downloadBootstrapper` (~2 MB + download do runtime pela Microsoft) para quem tem internet; manter o offline de 223 MB para quem não tem. Reduz o tempo de download de 7 min para segundos na maioria dos casos (decisão a aprovar: dois installers por release). |
| 8 | Intune/Defender/AppLocker conforme `docs/GUIA_WHITELIST_WINDOWS.md` | Resolve 100% nos clientes com IT gerido, sem certificado e sem Store. |
| 9 | ~~Limpar `dist-windows/` e alinhar o body do release~~ **Aplicado em 20/11** | Os 5 ficheiros antigos foram removidos do repo; o body do release passa a apontar para o download e `SHA256SUMS` públicos. |

### P2 — só se for comprar certificado

| # | Acção | Detalhe |
|---|---|---|
| 10 | Certificado **OV** (não EV) de CA internacional, com chave em HSM/token | EV já não escapa ao SmartScreen desde 2024. OV dá publisher verificado e reputação herdada entre versões assinadas pela mesma identidade. |
| 11 | Assinar instalador **e** todos os PE (incl. uninstaller) com `/fd SHA256 /tr <RFC3161> /td SHA256` | Sem timestamp a assinatura morre com o certificado. `signtool verify /pa` num callback. |
| 12 | Configurar `signCommand` + `certificateThumbprint` no Tauri e secrets no CI | Hoje não existe nenhuma assinatura Authenticode em `tauri.conf.json` / `build.yml`. |

**Ordem recomendada:** 1–5 → 6 (que elimina o problema na origem, grátis) → 7–9. Só avançar para
10–12 se a Store não for viável ou se houver clientes com Smart App Control.

## 5. Decisões que precisam de humano

- Aceitar dois installers por release (offline 223 MB + bootstrapper ~2 MB)?
- Submeter à Store com `runFullTrust` (exige justificação e conta Partner Center em nome da MilVendas)?
- Confirmar se a política de privacidade pública já existe e cobre a app desktop (obrigatória na Store).
- Comprar OV: qual CA e quem guarda o HSM/token.

> Nota: a secção 3 usa citações literais de páginas Microsoft; quando uma afirmação não foi
> encontrada na documentação, está assinalada como tal em 3.4. Nenhuma afirmação sobre o WA/CRM
> ou dados reais de clientes entrou neste documento.
