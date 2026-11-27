#!/usr/bin/env bash
# Gera um PDF a partir de um documento Markdown: python3-markdown para HTML e o Chromium do
# Playwright (dependência do projecto) para imprimir. Precisa de `bunx playwright install chromium`.
#   bash scripts/docs-to-pdf.sh docs/DESCRICAO_TECNICA.md docs/Descricao_Tecnica_DocID.pdf
set -euo pipefail

SRC=${1:?uso: scripts/docs-to-pdf.sh <entrada.md> <saida.pdf>}
OUT=$(realpath -m "${2:?uso: scripts/docs-to-pdf.sh <entrada.md> <saida.pdf>}")
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
NAME=$(basename "${OUT%.pdf}")

python3 - "$SRC" "$TMP/$NAME.html" <<'PY'
import sys, markdown
src, dst = sys.argv[1], sys.argv[2]
body = markdown.markdown(open(src, encoding="utf-8").read(), extensions=["tables", "fenced_code", "sane_lists"])
css = """
body { font-family: 'Inter', 'DejaVu Sans', Arial, sans-serif; font-size: 10pt; line-height: 1.45; color: #14213D; }
h1 { font-size: 18pt; color: #0B5BE8; } h2 { font-size: 13pt; color: #0B5BE8; margin-top: 14pt; }
h3 { font-size: 11pt; } code { font-family: 'DejaVu Sans Mono', monospace; font-size: 8.5pt; }
table { border-collapse: collapse; width: 100%; } th, td { border: 0.5pt solid #B8C6E3; padding: 3pt 5pt; vertical-align: top; }
th { background: #E8EEF8; } blockquote { color: #44506A; border-left: 3pt solid #B8C6E3; margin-left: 0; padding-left: 8pt; }
"""
open(dst, "w", encoding="utf-8").write(
    f"<!doctype html><html lang='pt'><head><meta charset='utf-8'><style>{css}</style></head><body>{body}</body></html>")
PY

cd "$(dirname "$0")/.."
node -e '
const { chromium } = require("@playwright/test");
(async () => {
  const [html, pdf] = process.argv.slice(1);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + html);
  await page.pdf({ path: pdf, format: "A4", margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    displayHeaderFooter: true, headerTemplate: "<span></span>",
    footerTemplate: "<div style=\"font-size:8px;width:100%;text-align:center;color:#44506A\"><span class=pageNumber></span> / <span class=totalPages></span></div>" });
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
' "$TMP/$NAME.html" "$TMP/$NAME.pdf"
mv -f "$TMP/$NAME.pdf" "$OUT"
echo "gerado: $OUT"
