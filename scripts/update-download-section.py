#!/usr/bin/env python3
"""Aponta a secção de downloads da landing para os instaladores de uma versão.

Muda, em apps/landing/src/components/ui/download-section.tsx, o link, o tamanho e o
SHA-256 do instalador Windows e do pacote Linux, e o nome do .deb no texto de ajuda.
O scripts/verify-installer.sh lê este mesmo ficheiro para conferir o que está publicado.

  update-download-section.py <versão> <exe> <deb>   (os ficheiros já descarregados)
"""
import hashlib
import os
import re
import sys

SOURCE = "apps/landing/src/components/ui/download-section.tsx"


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
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    version, exe, deb = sys.argv[1:]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        sys.exit(f"versão inválida: {version}")
    exe_name, deb_name = os.path.basename(exe), os.path.basename(deb)
    if version not in exe_name or version not in deb_name:
        sys.exit(f"os ficheiros não são da versão {version}: {exe_name}, {deb_name}")

    text = open(SOURCE, encoding="utf-8").read()
    text = replace_block(text, "installer", f"/downloads/{exe_name}", size_label(exe), sha256(exe))
    text = replace_block(text, "linux", f"/downloads/{deb_name}", size_label(deb), sha256(deb))
    text, n = re.subn(r"sudo apt install \./DocID_[0-9.]+_amd64\.deb", f"sudo apt install ./{deb_name}", text)
    if n != 1:
        sys.exit("não encontrei o comando de instalação do .deb")
    open(SOURCE, "w", encoding="utf-8").write(text)
    print(f"landing aponta para {exe_name} e {deb_name}")


if __name__ == "__main__":
    main()
