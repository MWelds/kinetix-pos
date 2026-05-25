import os

content = """# Dev Log — Fixes & Corrections

> Part of [[Kinetix POS — Project Overview]]

---

## Session 1 — Initial Build

### Foundation
- Scaffolded Electron + React 18 + TypeScript project with Vite + Electron Forge
- Set up SQLite via better-sqlite3 with Drizzle ORM
- Established IPC bridge pattern via contextBridge (no direct Node.js exposure to renderer)
- Implemented WAL mode and `PRAGMA foreign_keys = ON` at DB connection time
- Created all 10 core tables: products, product_variants, categories, inventory, customers, orders, order_items, payments, staff, shifts, settings

### Architecture Decisions
- Feature-based folder structure (`/features/cart`, `/features/products`, etc.)
- All DB access through service layer — never queried SQLite directly from components
- Zustand for client-side state (cart, auth, currency, ui, logo stores)
- Drizzle ORM for type-safe queries; raw `better-sqlite3` used only where Drizzle was insufficient

---

## Session 2 — Core Features

### POS & Checkout
- Built two-panel layout: product grid (left) + cart panel (right)
- Category filter tabs across the top of product grid
- Barcode scanner support via keyboard wedge (HID) — listens for rapid keystrokes ending in Enter
- Hold/park orders stored in SQLite, retrieved via held orders modal
- Split payment support across cash, card, store credit, gift card

### Payment Processing
- Cash payment with change calculation
- Card payment stub (integration-ready for Stripe Terminal / PAX)
- Store credit and gift card deduction from customer balance
- Layaway / partial payment recorded with `status: 'layaway'`

### Receipt Printing
- ESC/POS thermal printer support via Electron's native print dialog
- Receipt rendered as HTML, sent to `webContents.print()`
- 1 MB hard cap on receipt HTML payload to prevent abuse

---

## Session 3 — Reports, Settings, QBO

### Reports Screen
- KPI cards: Orders, Revenue, Avg Order Value, Discounts Given
- Top 10 products by units sold
- Payment methods breakdown
- Sales by staff member
- Date presets: Today, This Week, This Month

### Export Formats
- Sales Summary CSV (product-level totals)
- Transactions CSV (full order detail, one row per line item)
- Daily Summary CSV (revenue grouped by calendar day)
- QuickBooks IIF (TRNS/SPL/ENDTRNS format for QB Desktop)

### QuickBooks Online Integration
- OAuth2 flow: Client ID + Client Secret entered in Settings
- Redirect URI: `http://localhost:8085/qbo-callback`
- Pushes completed orders as Sales Receipts
- Pushes customer records to QBO Customers
- `qboLastSyncAt` timestamp prevents duplicate pushes
- QBO sync button appears in Reports header only when connected

### Settings Screen
- Store info (name, address, phone) saved to SQLite settings table
- Tax settings: enable/disable, rate (decimal), name
- Currency: USD or KYD with configurable exchange rate
- Logo upload: PNG/JPG/SVG/WebP, 500 KB UI cap, 2 MB main process cap
- Logo stored as base64 in settings table
- Categories manager: add/rename/delete, 12 color presets or custom hex
- Peripheral config: printer port, cash drawer port, second screen, network display port

---

## Session 4 — Security Audit & Fixes

### Issues Found

**1. Plaintext PIN storage**
- **Problem**: Staff PINs stored as plaintext in SQLite
- **Fix**: Created `src/main/lib/pin.ts` using SHA-256(pinSalt + pin)
  - `pinSalt` = `crypto.randomBytes(32).toString('hex')`, generated once per install
  - Salt stored in settings table, never returned to the renderer process
  - `SENSITIVE_KEYS` in settings service strips `pinSalt` from `getAll()` responses
- **Impact**: All existing plaintext PINs became invalid
- **Migration**: Delete `%APPDATA%\\Kinetix POS\\database\\pos.db` and restart to re-seed

**2. OAuth CSRF vulnerability in QBO flow**
- **Problem**: No `state` parameter validation in OAuth2 callback
- **Fix**: `crypto.randomBytes(16).toString('hex')` as `state` in `startAuth()`, stored as `pendingOAuthState`; callback rejects on mismatch
- **Location**: `src/main/services/qbo.service.ts`

**3. Missing Content Security Policy**
- **Problem**: No CSP headers — renderer had unrestricted script execution
- **Fix**: CSP injected via `session.defaultSession.webRequest.onHeadersReceived` in `src/main/index.ts`

**4. Sensitive values exposed via `settings.getAll()`**
- **Problem**: `getAll()` returned all rows including internally-generated sensitive values
- **Fix**: `SENSITIVE_KEYS = new Set(['qboAccessToken', 'qboRefreshToken', 'qboTokenExpiry', 'pinSalt'])` — filtered before IPC serialization
- **Note**: `qboClientSecret` and `syncApiKey` intentionally excluded from SENSITIVE_KEYS — user-entered values that must round-trip to the settings form

**5. Receipt HTML payload unbounded**
- **Fix**: 1 MB hard cap added in IPC handler before `webContents.print()`

**6. Settings values unbounded**
- **Fix**: `MAX_VALUE_BYTES = 2 * 1024 * 1024`; `set()` rejects oversized values

---

## Settings Save Button Regression

### Bug
After the security audit, the Settings **Save Changes** button stopped working silently.

### Root Cause
`handleSave()` calls `api.settings.set(k, v)` for all form keys including `syncApiKey` and `qboClientSecret`, which were initially in `SENSITIVE_KEYS`. The `Promise.all()` rejected silently — no `.catch()` block.

### Fixes
1. Narrowed `SENSITIVE_KEYS` to only internally-generated values
2. Added `catch` block to `handleSave()` — shows error toast on failure
3. Fixed `SettingsScreen.tsx` file truncation (closing tags missing due to bash heredoc cutoff)

---

## App Rename: POS System → Kinetix POS

### Changes
- `package.json`: `name`, `productName`, `appId`, `shortcutName`, `menuCategory` all updated
- `src/main/index.ts`: window title and AppUserModelId updated

### Side Effect
Electron userData path changed from `%APPDATA%\\POS System\\` to `%APPDATA%\\Kinetix POS\\` — app starts fresh on first run after rename, which also resolved any plaintext PIN issues on existing installs.

---

## Toast Position Change

Moved from bottom-right to top-center in `src/renderer/src/components/ui/Toast.tsx`:
- **Before**: `fixed bottom-4 right-4`
- **After**: `fixed top-4 left-1/2 -translate-x-1/2`

---

## End of Day Feature

### `src/renderer/src/features/staff/EndOfDayModal.tsx` (new)
3-step modal: Cash Count → Day Summary → Confirm & Close.

On close: `api.shifts.close()` with closing cash + variance note → `logout()` → navigate to PIN screen.

Shift record stores: `closingCash`, `closedAt`, `notes`, `status: 'closed'`.

Print EOD report sends monospace HTML receipt to thermal printer.

### Sidebar
Added amber "End of Day" button above shift button in `Sidebar.tsx`.

---

## CSV Bulk Import/Export

### `src/main/services/csv-import-export.service.ts` (new)
Custom parser — no external dependency. Handles quoted fields, embedded commas, double-quote escaping, CRLF/LF line endings.

- Products: upsert by SKU; auto-creates category; creates inventory record for new products
- Customers: upsert by email; fallback match by first+last name

### `src/renderer/src/components/ui/CsvImportExportBar.tsx` (new)
Import / Export / Template toolbar. Result banner shows added/updated/failed counts with per-row errors.

### IPC plumbing
`channels.ts` + `handlers.ts` + `preload/index.ts` + `api.ts` all extended with 4 CSV operations.

### Bug: JSX embedded quotes
Template CSV strings with `"123 Main St"` inside JSX props caused esbuild parse error. Fixed by moving templates to `const` variables before `return`.

---

## Known Issues & Workarounds

**File writes**: Large files written via Python through bash mount path to avoid null byte corruption on cross-mount writes.

**DB reset after PIN hash change**:
```
Remove-Item "$env:APPDATA\\Kinetix POS\\database\\pos.db" -Force
```

**Windows build**: `emptyOutDir: false` in `electron.vite.config.ts` prevents EPERM on cross-mount builds.

---

## Obsidian Vault Layout

```
MMindset/Kinetix POS/
├── Kinetix POS — Project Overview.md
├── Architecture/
│   ├── Architecture — Tech Stack.md
│   ├── Architecture — Database Schema.md
│   └── Architecture — Security.md
├── Features/
│   ├── Features — POS & Checkout.md
│   ├── Features — Products & Inventory.md
│   ├── Features — Customers & Loyalty.md
│   ├── Features — Staff & Shifts.md
│   ├── Features — End of Day.md
│   ├── Features — Reports & Exports.md
│   ├── Features — QuickBooks & Accounting Sync.md
│   ├── Features — Settings & Peripherals.md
│   └── Features — CSV Import & Export.md
└── Dev Log/
    └── Dev Log — Fixes & Corrections.md
```
"""

dest = r"C:\Users\Mavrick Welds\OneDrive - GrandPhilTech\Documents\MMindset\Kinetix POS\Dev Log\Dev Log — Fixes & Corrections.md"
os.makedirs(os.path.dirname(dest), exist_ok=True)
with open(dest, 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
