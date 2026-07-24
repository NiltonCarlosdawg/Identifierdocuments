#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# cross-build.sh — Compilação cruzada do DocID para Windows
# ============================================================
# Uso:  bash scripts/cross-build.sh
#
# Pré-requisitos (Ubuntu/Debian):
#   sudo apt install -y mingw-w64
#   rustup target add x86_64-pc-windows-gnu
#
# Para compilar nativamente noutros SO:
#   macOS: cargo tauri build --target aarch64-apple-darwin --bundles dmg
#   Windows: cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis
#
# ============================================================

TARGET="x86_64-pc-windows-gnu"
BUNDLE_DIR="apps/desktop/src-tauri/target/${TARGET}/release/bundle/nsis"

echo "=== Cross-build DocID para Windows (${TARGET}) ==="

# 1. Verificar toolchain
if ! rustup target list --installed | grep -q "${TARGET}"; then
  echo "A adicionar target ${TARGET}..."
  rustup target add "${TARGET}"
fi

# 2. Instalar dependências do Tauri (Linux)
if ! dpkg -l | grep -q libwebkit2gtk-4.1-dev; then
  echo "A instalar dependências Tauri..."
  sudo apt-get update
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
    patchelf libssl-dev libgtk-3-dev libayatana-appindicator3-dev
fi

# 3. Instalar MinGW (Windows linker)
if ! dpkg -l | grep -q mingw-w64; then
  echo "A instalar MinGW-w64..."
  sudo apt-get install -y mingw-w64
fi

# 4. Configurar cargo para cross-compilation
mkdir -p .cargo
cat > .cargo/config.toml << 'EOF'
[target.x86_64-pc-windows-gnu]
linker = "x86_64-w64-mingw32-gcc"
ar = "x86_64-w64-mingw32-ar"
EOF

# 5. Instalar deps Node
echo "A instalar dependências Node..."
cd apps/desktop
bun install

# 6. Build do frontend
echo "A compilar frontend..."
bun run build

# 7. Build Tauri para Windows
echo "A compilar Tauri para Windows (isto pode demorar alguns minutos)..."
bun tauri build --target "${TARGET}" --bundles nsis

echo ""
echo "=== Build concluído! ==="
echo "Instalador: ${BUNDLE_DIR}/"
ls -lh "${BUNDLE_DIR}/"*.exe 2>/dev/null || echo "Ficheiro .exe não encontrado em ${BUNDLE_DIR}"
