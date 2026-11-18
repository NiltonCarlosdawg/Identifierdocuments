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
