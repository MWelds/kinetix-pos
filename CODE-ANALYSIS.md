# Code Analysis Report — Kinetix POS

Date: 2026-07-09 · Scope: full repository (`src/`, `server/`, CI workflows, dependencies) · Version reviewed: 1.0.106

## Executive Summary

Kinetix POS is a well-structured offline-first point-of-sale application. The core architecture is sound: clear layering, safe database access, and a locked-down Electron configuration that avoids the most common desktop-app mistakes. The three areas that need attention are: (1) the Electron runtime is past end-of-life, meaning known browser-engine security holes are unpatched; (2) staff PINs are protected with a fast hash that could be cracked quickly if someone copied the database file; and (3) there are no automated tests at all, which is risky for software that handles money and inventory. All three are fixable without redesigning the system. A prioritized action plan is at the end of this report.

## 1. Project Understanding

Electron 29 + React 18 + TypeScript desktop POS for Windows, offline-first with a local SQLite database (better-sqlite3 + Drizzle ORM). ~31,000 lines of TypeScript across 93 files.

Structure: renderer (React screens per feature) → preload bridge (whitelisted IPC) → main-process IPC handlers → services layer → SQLite. Multi-terminal support via several sync mechanisms: an embedded LAN HTTP server, sync v1 (legacy HTTP), sync v2 (sequence-based), file-share sync, and cloud sync — plus a QuickBooks export, an email service, a customer-facing network display, and auto-updates via electron-updater.

Critical modules (everything below is prioritized against these): `order.service.ts` (money, refunds, stock deduction), `inventory.service.ts` (pack/unit stock math), `sync/embedded-server.ts` (network-exposed HTTP server), staff auth / PIN handling (`handlers.ts`, `lib/pin.ts`), and `product.service.ts` (pack/individual product linkage).

## 2. Architecture & Best Practices

Strengths: clean separation of concerns; the renderer never touches the database or Node APIs directly; services are cohesive per domain; migrations are versioned with an explicit schema-version table; sensible SQLite pragmas (WAL, FK enforcement).

Findings:

- **Four parallel sync implementations** (v1, v2, file, cloud) plus the embedded server all duplicate table-whitelist/column-intersection logic. Every schema change must be reflected in up to five places. Once v2 is proven, the legacy paths should be retired.
- **Oversized files**: `SettingsScreen.tsx` (~3,000 lines), `embedded-server.ts` (~1,100), `handlers.ts` (~1,000+), `ProductsScreen.tsx` (~1,300). These are the files where regressions keep happening; splitting them by section/domain would pay for itself.
- **Duplicated receipt HTML builders** exist in three renderer files with copy-pasted `esc()` helpers and near-identical templates (the invoice path was recently consolidated into `lib/invoice-template.ts`; receipts should follow the same pattern).
- **Repo hygiene**: 41 stray generated `electron.vite.config.<timestamp>.mjs` files sit in the repository root. They should be deleted and the pattern added to `.gitignore`.

## 3. Testing Assessment

**There are no tests and no test framework installed.** No `*.test.*` files, no vitest/jest in devDependencies, and no test step in CI.

This matters most for the money- and stock-handling logic, which is exactly the code that is hard to verify by clicking around: currency conversion and rounding (`round2`, KYD/USD), refund math (`refundedQuantity` accounting), pack ↔ individual quantity conversion, discount calculation, and sync conflict resolution (LWW logic).

Testability today is moderate: services are plain objects over a module-level DB singleton. better-sqlite3 supports in-memory databases, so service-level tests need only a small seam to inject a `:memory:` connection — no big refactor required. Recommended starting point: vitest + in-memory SQLite covering `order.service`, `inventory.service`, and `product.service` pack transitions.

## 4. Code Quality & Correctness

- **`npm run typecheck` currently fails** with roughly 40 pre-existing errors (unused imports, missing type exports such as `ProductComponent` and `PaymentMethod` from `types/`, null-safety issues in `SettingsScreen.tsx`, a scoping bug where `SyncServerSection` references `cloudSyncState` from another component). The app still builds because electron-vite transpiles without type-checking — but it means the CI type-check gate cannot be passing, and type errors no longer stop bad code.
- **Silent error swallowing** is common (`catch {}` / `catch { /* non-fatal */ }`). Reasonable for print/display paths, but some swallow sync and payment-adjacent failures where at minimum a log entry is warranted.
- **No linter**: ESLint is not installed, so unused code and common bug patterns accumulate unchecked.
- Money is handled as JS floats with explicit 2-dp rounding helpers. Acceptable at POS scale, but rounding is implemented in several places (`round2`, `perUnit`, inline `Math.round(x*100)/100`) — centralize into one utility to keep behavior consistent.

## 5. Security Review

What's already done right (worth stating — this is a stronger posture than most Electron apps): `contextIsolation: true`, `nodeIntegration: false`, DevTools disabled in production, a whitelisted preload bridge (no generic `invoke` passthrough), parameterized queries throughout (no injectable SQL found — dynamic table names are constrained to the `SYNC_TABLES` whitelist and column names are intersected against `PRAGMA table_info`), PIN login rate-limiting with lockout, a timing-safe API-key comparison, auto-generated sync API keys when none is configured, and receipt/invoice HTML escaping user data.

Findings, ordered by severity:

1. **Electron 29 is end-of-life (High).** Support ended in late 2024; the bundled Chromium and Node carry publicly known, unpatched CVEs. For a payment-adjacent app this is the single most important upgrade. Target the current supported major (expect native-module rebuild and minor API churn).
2. **PIN hashing is a single salted SHA-256 (High if the DB file is exposed).** SHA-256 is fast by design; a stolen `pos.db` yields the salt alongside the hashes, and 4–6 digit PINs fall to brute force in well under a second. `bcryptjs` is already a dependency — switch `lib/pin.ts` to bcrypt with per-PIN salts and migrate hashes transparently on next successful login. On-device risk is already mitigated by the lockout; this is about database-file theft.
3. **Vulnerable dependencies (High/Moderate, easy fix).** `npm audit` reports 6 issues: nodemailer ≤ 9.0.0 (four advisories incl. CRLF header injection — high) and react-router 6.x open-redirect (moderate; limited impact inside a packaged app). Both have non-breaking fixes: run `npm audit fix` and re-test email + navigation.
4. **LAN sync runs over plain HTTP (Medium).** The sync API key, admin PIN (dashboard login), and customer/order data transit the LAN unencrypted. On a small trusted store network this is a contained risk, but document it; longer-term options are TLS with a self-signed pinned cert or restricting the listener to specific interfaces rather than `0.0.0.0`.
5. **Inconsistent role enforcement on IPC (Medium).** 59 of 138 handlers call `requireRole`. Some sensitive ones don't: `ORDERS_CREATE`/`ORDERS_COMPLETE`/`ORDERS_UPDATE_AND_COMPLETE`, `SHIFTS_OPEN`, and notably `AUDIT_LOG`, which lets any renderer code write arbitrary audit entries (an integrity problem for cash controls — audit rows should be written by the main process from session context, not accepted from the renderer).
6. **SMTP password stored in plaintext** in the settings table (Low/Medium). Use Electron's `safeStorage` (DPAPI on Windows) to encrypt at rest, and confirm `emailPassword` is in the machine-specific exclusion set so it never syncs to other terminals.
7. **No Content-Security-Policy** meta in the renderer HTML (Low, defense-in-depth given context isolation).
8. **No automated database backup** routine was found (Low as a security item, High as an operational one — WAL protects against crashes, not disk loss).

No exploit details are included above by design; each item lists the class of issue and the remediation.

## 6. Performance Analysis

Generally well-considered: SQL-side pagination for product/inventory lists, list virtualization in the renderer, WAL + 64 MB page cache + mmap, lazy loading of base64 images via a sentinel to keep IPC payloads small, and batched `hasVariants`/pack-quantity lookups instead of per-row subqueries.

Watch items:

- **Base64 images in the products table** bloat the DB file, the page cache, and every sync payload that touches `products`. Moving images to files on disk (path in DB) is the highest-value performance change as catalogs grow.
- `listWithInventory` (POS grid) loads the entire active catalog per category switch — fine to ~2–3k products, worth revisiting beyond that.
- Variant saves execute sequential awaited IPC calls per variant; harmless at current scale.
- Full-table `SELECT *` pulls in sync v1 (`baselineSettings`, per-table since-scans) are the slowest path; v2's sequence protocol is the right direction.

## 7. CI/CD & Continuous Feedback

Exists: GitHub Actions `build.yml` and `release.yml` on version tags — dependency install, native rebuild, a TypeScript type-check step, installer build, and publishing via electron-updater.

Gaps: the type-check gate is failing against the current tree (see §4), so it isn't actually gating anything; no lint step (and no linter installed); no test step (nothing to run); no `npm audit`/Dependabot/Renovate for dependency alerts — the current nodemailer advisories would have been flagged months ago; CI only runs on tags, so nothing checks day-to-day commits or PRs; no mention of Windows code signing, which affects both SmartScreen friction and update integrity.

## 8. Prioritized Roadmap

**Quick wins (this week)**

1. `npm audit fix` → clears the nodemailer and react-router advisories; smoke-test email receipts afterwards (§5.3).
2. Delete the 41 stray `electron.vite.config.*.mjs` files; add the pattern to `.gitignore` (§2).
3. Fix the ~40 type errors so `npm run typecheck` passes, then make CI run it on every push, not just tags (§4, §7).
4. Confirm `emailPassword` (and API keys) are excluded from settings sync (§5.6).

**High-impact fixes (next 2–4 weeks)**

5. Upgrade Electron to a supported major; rebuild better-sqlite3; regression-test printing, sync, and the updater (§5.1).
6. Switch PIN hashing to bcrypt with transparent migration on next login (§5.2).
7. Move audit-log writes into the main process using session context; add `requireRole` to the unprotected order/shift handlers (§5.5).
8. Encrypt the SMTP password with `safeStorage` (§5.6).
9. Add an automated daily SQLite backup (better-sqlite3 has a native `.backup()` API) with simple rotation (§5.8).

**Technical debt (1–3 months)**

10. Introduce vitest + in-memory SQLite; first targets: order/refund math, inventory pack conversions, product pack transitions (§3).
11. Add ESLint with a minimal ruleset; wire lint + typecheck + tests into CI on every PR (§4, §7).
12. Consolidate the three receipt HTML builders into a shared template module, as was done for invoices (§2).
13. Split `SettingsScreen.tsx` and `handlers.ts` into per-domain modules (§2).

**Long-term**

14. Retire sync v1 and file-sync once all terminals run v2; keep one LAN path and one cloud path (§2).
15. Move product images out of the database to files on disk (§6).
16. Evaluate TLS (or interface binding) for the embedded LAN server, and Windows code signing for the installer (§5.4, §7).
