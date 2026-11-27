# DocID — landing page

Static marketing site for the DocID desktop app. Published at
<https://docid.milvendas.ao>.

Stack: Vite + React 18 + Tailwind. One page, all sections in
`src/components/sections`. The plan table and the checkout call the API
(`VITE_API_URL`, `https://didall.milvendas.ao` in production). Downloads are
served by the site itself from `/downloads/` (installer, `.deb`, `SHA256SUMS`).

## Commands

Run from the repository root (the workspace uses bun; npm fails on `apps/api`):

```bash
bun install
cd apps/landing && bun run dev      # http://localhost:5173
cd apps/landing && bun run build    # -> apps/landing/dist
cd apps/landing && bun run preview  # serve dist on :4173
```

## Publishing a new desktop version

Automatic. Bump the version with `bash scripts/bump-desktop-version.sh X.Y.Z` and
merge to `main`: the *Build & Release* workflow builds the installers, uploads
them to `/downloads/`, rewrites `SHA256SUMS`, updates `DOWNLOADS` in
`src/components/ui/download-section.tsx` and the version and link in
`index.html` (`scripts/update-download-section.py`), commits that to `main`,
deploys the landing and verifies the published installer
(`scripts/verify-installer.sh`). See `apps/desktop/UPDATER.md`.

## Deploy (cPanel)

Automatic on every push to `main` (*Deploy DocID* workflow): `dist/` is
extracted into the `docid.milvendas.ao` docroot and the admin panel into
`admin/`. `.htaccess` ships in `public/` and sets charset plus cache headers.

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
