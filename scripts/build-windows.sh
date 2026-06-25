#!/bin/bash
# Build script para Windows (.exe/.msi) no Linux
# Requer: mingw-w64 (sudo apt install mingw-w64)

set -e

echo "=== DocID v1.0.0 — Build Windows ==="

# 1. Instalar toolchain se necessário
if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
  echo "A instalar mingw-w64..."
  sudo apt-get update && sudo apt-get install -y mingw-w64
fi

# 2. Adicionar target Rust
echo "A adicionar target Windows..."
rustup target add x86_64-pc-windows-gnu

# 3. Build
echo "A compilar DocID para Windows..."
cd "$(dirname "$0")/.."
cd apps/desktop

bunx tauri build --target x86_64-pc-windows-gnu

echo ""
echo "=== Build concluído! ==="
echo "Ficheiros gerados:"
ls -lh src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/ 2>/dev/null || true
ls -lh src-tauri/target/x86_64-pc-windows-gnu/release/bundle/msi/ 2>/dev/null || true
ls -lh src-tauri/target/x86_64-pc-windows-gnu/release/*.exe 2>/dev/null | head -3
