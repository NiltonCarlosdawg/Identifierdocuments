# Actualizações do DocID Desktop

## Assinatura

A pubkey está em `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).

A **chave privada** não entra no repositório. Em builds de release/CI:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat /caminho/seguro/docid-updater.key)"
# opcional:
# export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
bun run tauri build
```

Gere um novo par (se necessário) com:

```bash
bunx tauri signer generate -w ~/.tauri/docid-updater.key
```

Actualize a pubkey em `tauri.conf.json` se regenerar o par.

## ChaveActual

A pubkey em `tauri.conf.json` corresponde à chave privada de `~/.tauri/docid-updater.key`
(gerada em 2026-11-18). Essa chave privada **não está no repositório**; está no teu `~/.tauri/`
e deve ser guardada. Ela permite assinar o `.exe` do updater e publicar instaladores futuros.

Antiga pubkey foi substituída: instalações de versões anteriores (≤1.1.5) não conseguirão
auto-actualizar para 1.1.6 — actualizam manualmente (ver UPDATER.md → Endpoint).

## Endpoint

Por omissão: `https://github.com/NiltonCarlosdawg/Identifierdocuments/releases/latest/download/latest.json`

Publique `latest.json` (e os artefactos `.sig`) no GitHub Release, no formato documentado em https://v2.tauri.app/plugin/updater/

## UI

- Arranque (release): prompt nativo se houver versão nova
- Settings → Servidor → «Procurar actualizações»

## Publicar uma versão nova

1. `bash scripts/bump-desktop-version.sh X.Y.Z` (muda `package.json`, `tauri.conf.json`,
   `Cargo.toml` e `Cargo.lock` de uma vez) e faça merge para `main`.
2. O workflow **Build & Release** faz o resto sozinho:
   - cria o release `desktop-vX.Y.Z` como pré-release e gera os instaladores: Windows leve
     (`DocID_X.Y.Z_x64-setup.exe`, ~9 MB, descarrega o WebView2 só se faltar; é o que o
     auto-update usa), Windows completo (`…_x64-setup-offline.exe`, ~300 MB, com o WebView2
     para instalar sem internet), Linux e macOS (`.dmg` não assinado, não publicado no site);
   - envia os dois `.exe` e o `.deb` para `docid.milvendas.ao/downloads` e regenera o `SHA256SUMS`;
   - actualiza `apps/landing/src/components/ui/download-section.tsx` com um commit em `main`
     e publica a landing;
   - confere o instalador publicado (`scripts/verify-installer.sh`);
   - só então marca o release como *latest*, que é o que o auto-update da app lê.
3. Se algum passo falhar, o release fica como pré-release: as apps instaladas não vêem a
   versão nova e o site continua a apontar para a anterior. Corrija e volte a correr o
   workflow (`workflow_dispatch` na tag `desktop-vX.Y.Z`).

`bash scripts/check-desktop-version.sh` confirma que os quatro ficheiros têm a mesma versão.
