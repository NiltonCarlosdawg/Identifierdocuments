# DocID — landing page

Static marketing site for the DocID desktop app. Published at
<https://docid.milvendas.ao>.

Stack: Vite + React 18 + Tailwind. No router, no backend — one page, all
sections in `src/components/sections`, downloads point straight at the GitHub
release assets.

## Commands

Run from the repository root (the workspace uses bun; npm fails on `apps/api`):

```bash
bun install
cd apps/landing && bun run dev      # http://localhost:5173
cd apps/landing && bun run build    # -> apps/landing/dist
cd apps/landing && bun run preview  # serve dist on :4173
```

## Publishing a new desktop version

1. Build and sign the installer; upload it to the GitHub release.
2. Update `DOWNLOADS` in `src/components/ui/download-section.tsx` (URL, size,
   SHA-256) and the version strings in `Nav`, `Hero`, `Footer`, `index.html`
   (`softwareVersion`, preload/noscript link) and `public/sitemap.xml`.
3. `bun run build`, then upload the contents of `dist/` to the subdomain
   docroot on cPanel.

Quote the SHA-256 from the file you actually published:

```bash
sha256sum dist-windows/DocID_<version>_x64-setup.exe
```

## Deploy (cPanel)

Subdomain `docid.milvendas.ao` → docroot contains the files of `dist/`
(not the `dist` folder itself). `.htaccess` ships in `public/` and sets
charset plus cache headers.

## Assets

Generated from `docid logo.jpg` (repo root) with Python/PIL:

- `public/logo-dark.png` — the lockup for dark backgrounds: original mark on a
  white tile, wordmark recoloured white (transparent PNG, 3×).
- `public/icon.png` (512), `public/apple-touch-icon.png` (180) — mark on a
  white rounded tile.
- `public/og.png` — 1200×630 social card, keeping the original navy-on-white
  lockup.

- `public/fonts/*.woff2` — self-hosted Archivo 600/700, Inter 400/600,
  JetBrains Mono 500 (latin subset, 183 KB total).
