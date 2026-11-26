#!/usr/bin/env bash
# Confirma que a versão do DocID Desktop é a mesma nos quatro ficheiros e imprime-a.
# Uma versão desalinhada já partiu um release (ver commit 3797311).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json, re, sys
d = "apps/desktop"
def grab(path, pattern):
    m = re.search(pattern, open(path, encoding="utf-8").read(), flags=re.M)
    return m.group(1) if m else None
versions = {
    "package.json": json.load(open(f"{d}/package.json"))["version"],
    "tauri.conf.json": json.load(open(f"{d}/src-tauri/tauri.conf.json"))["version"],
    "Cargo.toml": grab(f"{d}/src-tauri/Cargo.toml", r'^version\s*=\s*"([^"]+)"'),
    "Cargo.lock": grab(f"{d}/src-tauri/Cargo.lock", r'^name = "docid-desktop"\nversion = "([^"]+)"'),
}
if len(set(versions.values())) != 1:
    for f, v in versions.items():
        print(f"{f}: {v}", file=sys.stderr)
    sys.exit("versões do desktop desalinhadas")
print(versions["tauri.conf.json"])
PY
