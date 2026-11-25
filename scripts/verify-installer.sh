#!/usr/bin/env bash
# Confere que o instalador publicado bate com o hash anunciado na landing e no SHA256SUMS.
set -euo pipefail

BASE="${BASE:-https://docid.milvendas.ao/downloads}"
SOURCE="apps/landing/src/components/ui/download-section.tsx"
FILE=$(python3 - "$SOURCE" <<'PY'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
print(re.search(r'/downloads/([^"]+)', src).group(1))
PY
)

expected=$(python3 - "$SOURCE" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
print(re.search(r'sha256:\s*"([a-f0-9]{64})"', text).group(1))
PY
)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL --retry 3 --max-time 900 -o "$tmp/$FILE" "$BASE/$FILE"
actual=$(sha256sum "$tmp/$FILE" | cut -d' ' -f1)

echo "landing:   $expected"
echo "descarregado: $actual"

test "$expected" = "$actual" || { echo "ERRO: hash do instalador publicado não bate com a landing" >&2; exit 1; }

curl -fsSL --retry 3 --max-time 30 -o "$tmp/SHA256SUMS" "$BASE/SHA256SUMS"
grep -Fx "$actual  $FILE" "$tmp/SHA256SUMS" || { echo "ERRO: SHA256SUMS publicado não bate" >&2; exit 1; }

echo "OK: instalador e SHA256SUMS conferidos"
