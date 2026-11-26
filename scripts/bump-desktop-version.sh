#!/usr/bin/env bash
# Muda a versão do DocID Desktop nos quatro sítios onde ela vive. Depois do merge para
# main, o workflow "Build & Release" vê a versão nova, gera o release e publica os
# instaladores no site sozinho.
#   bash scripts/bump-desktop-version.sh 1.2.7
set -euo pipefail

NEW=${1:?uso: scripts/bump-desktop-version.sh X.Y.Z}
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "versão inválida: $NEW (formato X.Y.Z)" >&2; exit 1; }

cd "$(dirname "$0")/.."
D=apps/desktop
OLD=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$D/src-tauri/tauri.conf.json")
[ "$OLD" != "$NEW" ] || { echo "a versão já é $NEW" >&2; exit 1; }

python3 - "$D" "$NEW" <<'PY'
import json, re, sys
d, new = sys.argv[1], sys.argv[2]

def sub_once(path, pattern, repl):
    text = open(path, encoding="utf-8").read()
    out, n = re.subn(pattern, repl, text, count=1, flags=re.M)
    if n != 1:
        sys.exit(f"não encontrei a versão em {path}")
    open(path, "w", encoding="utf-8").write(out)

sub_once(f"{d}/package.json", r'^(\s*"version":\s*")[^"]+(")', rf'\g<1>{new}\g<2>')
sub_once(f"{d}/src-tauri/tauri.conf.json", r'^(\s*"version":\s*")[^"]+(")', rf'\g<1>{new}\g<2>')
sub_once(f"{d}/src-tauri/Cargo.toml", r'^(version\s*=\s*")[^"]+(")', rf'\g<1>{new}\g<2>')
# No Cargo.lock só a entrada do próprio pacote.
sub_once(f"{d}/src-tauri/Cargo.lock", r'^(name = "docid-desktop"\nversion = ")[^"]+(")', rf'\g<1>{new}\g<2>')
PY

echo "DocID Desktop: $OLD -> $NEW"
bash scripts/check-desktop-version.sh
