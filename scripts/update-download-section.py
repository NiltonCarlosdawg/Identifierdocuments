#!/usr/bin/env python3
"""Aponta a landing para os instaladores de uma versão.

- apps/landing/src/components/ui/download-section.tsx: link, tamanho e SHA-256 do
  instalador Windows (leve), do instalador completo (com o WebView2) e do pacote Linux,
  e o nome do .deb no texto de ajuda. O
  scripts/verify-installer.sh lê este ficheiro para conferir o que está publicado.
- apps/landing/index.html: versão e link nos dados estruturados (motores de busca) e no
  link de download para quem não tem JavaScript.

  update-download-section.py <versão> <exe> <deb> <exe-offline>   (ficheiros já descarregados)
"""
import hashlib
import os
import re
import sys

SOURCE = "apps/landing/src/components/ui/download-section.tsx"
INDEX_HTML = "apps/landing/index.html"
SITE = "https://docid.milvendas.ao"


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def size_label(path: str) -> str:
    return f"{max(1, round(os.path.getsize(path) / 1_000_000))} MB"


def replace_block(text: str, key: str, href: str, size: str, digest: str) -> str:
    pattern = re.compile(
        rf'({key}:\s*\{{\s*href:\s*")[^"]*(",\s*size:\s*")[^"]*(",\s*sha256:\s*")[^"]*(")'
    )
    out, n = pattern.subn(rf"\g<1>{href}\g<2>{size}\g<3>{digest}\g<4>", text)
    if n != 1:
        sys.exit(f"não encontrei o bloco '{key}' em {SOURCE}")
    return out


def main() -> None:
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    version, exe, deb, offline = sys.argv[1:]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        sys.exit(f"versão inválida: {version}")
    exe_name, deb_name, off_name = os.path.basename(exe), os.path.basename(deb), os.path.basename(offline)
    if any(version not in n for n in (exe_name, deb_name, off_name)):
        sys.exit(f"os ficheiros não são da versão {version}: {exe_name}, {deb_name}, {off_name}")

    text = open(SOURCE, encoding="utf-8").read()
    text = replace_block(text, "installer", f"/downloads/{exe_name}", size_label(exe), sha256(exe))
    text = replace_block(text, "installerOffline", f"/downloads/{off_name}", size_label(offline), sha256(offline))
    text = replace_block(text, "linux", f"/downloads/{deb_name}", size_label(deb), sha256(deb))
    text, n = re.subn(r"sudo apt install \./DocID_[0-9.]+_amd64\.deb", f"sudo apt install ./{deb_name}", text)
    if n != 1:
        sys.exit("não encontrei o comando de instalação do .deb")
    open(SOURCE, "w", encoding="utf-8").write(text)

    html = open(INDEX_HTML, encoding="utf-8").read()
    exe_url = f"{SITE}/downloads/{exe_name}"
    for pattern, repl in [
        (r'("softwareVersion":\s*")[^"]*(")', rf"\g<1>{version}\g<2>"),
        (r'("downloadUrl":\s*")[^"]*(")', rf"\g<1>{exe_url}\g<2>"),
        (r'(<noscript>.*?<a href=")[^"]*(">\s*Descarregar o instalador )[^<]*?(\s*</a>)',
         rf"\g<1>{exe_url}\g<2>{version} ({size_label(exe)})\g<3>"),
    ]:
        html, n = re.subn(pattern, repl, html, count=1, flags=re.S)
        if n != 1:
            sys.exit(f"não encontrei {pattern[:30]}… em {INDEX_HTML}")
    open(INDEX_HTML, "w", encoding="utf-8").write(html)
    print(f"landing aponta para {exe_name} e {deb_name}")


if __name__ == "__main__":
    main()
