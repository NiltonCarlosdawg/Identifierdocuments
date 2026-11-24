# All Pending Ports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port every remaining feature from the 2026-11-23 corrected tree into `main` (email notifications, license enforcement/trial/grace/platform API, Windows native keyring + Windows hardening) and prove a Windows install can talk to the production API.

**Architecture:** The source tree is an older v1.1.6 fork; copy its self-contained modules verbatim and apply only targeted hunks to shared files. Keep our `plans`/`orders`/`licenses`/provider modules. Avoid name collisions: new enforcement service is `license-enforcement.service.ts`, new checkchar helper is `lib/license-check.ts`. The `licenses` table stays the source of truth; `issueLicense()` bridges it into the new organization-level `license_*` fields.

**Tech Stack:** TypeScript/Elysia/Drizzle/Bun API, React/Zustand desktop, Rust/Tauri 2, PostgreSQL, NSIS.

**Spec:** `/home/niltoncosta/Vídeos/DocID-correcoes-seguranca/Identifierdocuments-main` (source tree), `CORRECOES_SEGURANCA_2026-11-23.md`, `NOTIFICACOES_EMAIL.md`, `LICENCAS.md`.

## Global Constraints

- Commits small/conventional, English; replies in Portuguese; no secrets in code/commits.
- Migration numbering continues from our `0024_rls_empty_tenant`: email = `0025_email_notifications`, tenant license number = `0026_tenant_license_number`, enforcement = `0027_license_enforcement`. Append journal entries only; no snapshots (repo convention).
- New RLS policies must use `NULLIF(current_setting('app.current_tenant', true), '')` from the start (our `0024` fix).
- The 4 existing production Free orgs keep `license_valid_until NULL`, `license_max_users NULL`, `license_status 'active'` — no backfill with trial values (would lock them out after 21 days).
- CORS for Windows origin `http://tauri.localhost` already deployed; never remove it.

## Review Focus

- Reused pooled connection with empty `app.current_tenant` → new email/license RLS policies must not throw (`NULLIF`).
- Writing `/email/settings` without `EMAIL_SECRETS_KEY` → 500 with clear code, not silent data loss.
- Expired/suspended tenant → `licenseGuard` blocks writes but never `/auth/*`, `/devices`, offline sync or `/platform/*`.
- Platform PATCH with wrong token → 401, never changes license.
- Windows Rust code must compile for `x86_64-pc-windows-gnu` (CI never did); `Cargo.lock` must be regenerated.

---

### Task 1: Email notifications backend

**Files:**
- Create: `apps/api/src/db/migrations/0025_email_notifications.sql`, `jobs/email-worker.ts`, `lib/secret-box.ts`, `lib/signed-link.ts`, `lib/smtp-guard.ts`, `services/email/{templates,transport,tenant-email.service}.ts`, `modules/email.module.ts`, `__tests__/email-notifications.test.ts`, `docs/NOTIFICACOES_EMAIL.md`
- Modify: `db/schema.ts`, `db/migrations/meta/_journal.json`, `index.ts`, `modules/documents.module.ts`, `modules/approvals.module.ts`, `.env.example`, `.github/workflows/ci.yml`

**Interfaces:** consumes `db`, `withTenant`, `getRedis`; produces `enqueueEmail`, `onDocumentApproved`, `onDocumentShared`, `emailModule`, `emailLinksModule`, `startEmailWorker`.

- [ ] Copy source files into place; in the SQL rename migration to `0025_email_notifications` and change both tenant-isolation policies to use `NULLIF(..., '')`.
- [ ] Add `tenantEmailSettings`/`emailLogs` tables to `schema.ts`; append journal idx 25.
- [ ] Wire `emailLinksModule` (public) and `emailModule` into `index.ts`; call `startEmailWorker()`; add Swagger tag.
- [ ] Add `onDocumentShared`/`onDocumentApproved` calls to the two modules' handlers (approved/active only).
- [ ] Append email + SMTP env block to `.env.example`; add test file to CI list.
- [ ] Verify: `bunx tsc --noEmit`, `bun test src/__tests__/email-notifications.test.ts`, full `bun test`, then commit `feat(api): add tenant email notifications`.

### Task 2: License enforcement + platform API

**Files:**
- Create: `db/migrations/0026_tenant_license_number.sql`, `0027_license_enforcement.sql`, `lib/license-check.ts`, `services/license-enforcement.service.ts`, `middleware/licenseGuard.ts`, `modules/platform.module.ts`, `__tests__/license-enforcement.test.ts`, `__tests__/license.integration.test.ts`, `docs/LICENCAS.md`
- Modify: `db/schema.ts`, journal, `index.ts`, `lib/errors.ts`, `services/license.service.ts` (bridge in `issueLicense`), `.env.example`, CI, desktop `LicenseBanner.tsx`, `Settings.tsx`, new `apps/desktop/src/__tests__/license-banner.test.ts`

**Interfaces:** produces `getTenantLicense`, `computeLicenseState`, `invalidateLicenseCache`, `licenseGuard`, `platformModule`; `issueLicense()` also writes `organizations.license_*` and invalidates cache.

- [ ] Copy SQL with renumbering; adapt `plan` → `plan_id` in triggers/guard (or guard only `license_*` columns); keep NULLIF policies.
- [ ] Add 6 `license_*` fields to `organizations` in `schema.ts`; append journal idx 26/27.
- [ ] Copy source service as `license-enforcement.service.ts` (renamed exports where they collide with ours); copy `lib/license.ts` as `lib/license-check.ts`.
- [ ] Bridge `issueLicense()` to write organization license fields; map trial→active, suspended→suspended, expired/read_only→expired.
- [ ] Wire `licenseGuard` after `tenantMiddleware` and `platformModule` with other modules; add LIC01/LIC02 passthrough in `lib/errors.ts`.
- [ ] Desktop: merge banner/settings with our subscription UI (do not delete our subscription view).
- [ ] Verify: tsc (api+desktop), targeted + full tests; commit `feat(api): add license enforcement and platform API`.

### Task 3: Windows keyring + Windows hardening

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/secure_key.rs`, `src-tauri/src/win_shell.rs`
- Modify: `Cargo.toml` (keyring 3 windows-native/apple-native), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/{printer,scanner}.rs`, `src-tauri/src/sync/mod.rs`, `apps/desktop/src/infrastructure/storage/SecureStorageAdapter.ts`, `src/infrastructure/stores/scannerStore.ts`, CI `rust-windows` job, `Cargo.lock`

**Interfaces:** produces Tauri command `secure_key_get_or_init`; consumes `keyring` crate, `tauri` store.

- [ ] Copy Rust/TS files and hunks; add `printer_name_ok` check to the `printer` argument before `ShellExecuteW`.
- [ ] Regenerate `Cargo.lock` online (`cargo generate-lockfile`/`cargo check`).
- [ ] Verify: `cargo check --target x86_64-pc-windows-gnu --manifest-path apps/desktop/src-tauri/Cargo.toml`; `cargo test --lib` (Linux parts); commit `feat(desktop): move secure key into OS credential store`.

### Task 4: Windows build + production communication proof

- [ ] `bun install --frozen-lockfile` in `apps/desktop`; `bun run build` (frontend).
- [ ] `bunx tauri build --target x86_64-pc-windows-gnu --bundles nsis`; publish the NSIS installer to the existing downloads area if build succeeds.
- [ ] Deploy API bundle with new modules; apply migrations 0025–0027 in production with the owner/GUC conventions used for 0023/0024; restart via `run.sh`.
- [ ] Prove Windows-origin communication: CORS preflight + actual login with `Origin: http://tauri.localhost` against `https://didall.milvendas.ao/auth/login`; verify API base URL constants point at production; browser verification of panel/landing; close browser.
- [ ] Commit docs/release notes; report what could not be executed (MSIX/Store) and risks.

## Self-review

- Spec coverage: all 6 security corrections (already done) + email + license/platform + Rust/Windows + build/deploy.
- Conflicts resolved: migration numbering, `LicenseState` name collision, `plan` vs `plan_id`, dual license source of truth, trial backfill, RLS NULLIF.
- Review focus tests: email unit suite, license enforcement suite, Windows cargo check, production CORS/login probe.
