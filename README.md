# POS System

A full-featured, offline-first Point of Sale system for Windows, built with Electron + React + TypeScript.

## Features

| Module | What's included |
|--------|----------------|
| **Point of Sale** | Product grid, category tabs, barcode scanning, cart with quantity controls, line-item & order discounts, hold/park orders |
| **Checkout** | Cash (change calc), credit/debit card stub, store credit, gift cards, layaway, split payments |
| **Products** | Full CRUD, SKU/barcode, categories, cost/price/tax, inventory tracking |
| **Customers** | Profiles, purchase history, loyalty points, store credit |
| **Inventory** | Stock levels, low-stock alerts, receive/loss/transfer/adjustment log |
| **Orders** | History, search, void, refund |
| **Reports** | Sales summary, by product, by staff, payment breakdown — CSV export |
| **Staff** | PIN login, roles (admin/manager/cashier), shift open/close, audit log |
| **Settings** | Store info, tax rate, receipt footer, printer ports, sync config |

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Windows 10 / 11 / Server 2019 / Server 2022

### Install

```bash
cd POS
npm install
npm run rebuild    # rebuilds better-sqlite3 for your Electron version
```

### Run in development

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

## Demo Credentials (PIN Login)

| Role | PIN | Access |
|------|-----|--------|
| Admin | `1234` | Full access — all screens |
| Manager | `5678` | POS + products/inventory/reports |
| Cashier | `0000` | POS + orders + customers |

## Architecture

```
src/
├── main/                  # Electron main process (Node.js)
│   ├── database/          # SQLite connection, migrations, seed data
│   │   ├── connection.ts  # WAL-mode SQLite + Drizzle ORM singleton
│   │   ├── migrate.ts     # Idempotent DDL migrations (schema v1)
│   │   ├── schema/        # Drizzle table definitions
│   │   └── seed.ts        # Demo products, staff, customers
│   ├── ipc/
│   │   ├── channels.ts    # All IPC channel names (single source of truth)
│   │   └── handlers.ts    # ipcMain.handle() registrations
│   ├── lib/id.ts          # Crypto random ID generator
│   └── services/          # Business logic (all DB access here)
│       ├── product.service.ts
│       ├── order.service.ts
│       ├── customer.service.ts
│       ├── inventory.service.ts
│       ├── staff.service.ts
│       ├── report.service.ts
│       └── settings.service.ts
│
├── preload/
│   └── index.ts           # contextBridge — exposes window.api to renderer
│
└── renderer/src/          # React 18 frontend
    ├── App.tsx            # Router + auth guards
    ├── components/
    │   ├── layout/        # Sidebar with role-filtered nav
    │   └── ui/            # Button, Input, Modal, Card, Badge, Toast, Spinner
    ├── constants/         # No magic numbers — all constants here
    ├── features/          # Feature-based folders
    │   ├── pos/           # POS screen, cart, product grid, payment, held orders
    │   ├── products/      # Product CRUD
    │   ├── customers/     # Customer CRUD + purchase history
    │   ├── inventory/     # Inventory adjustments
    │   ├── orders/        # Order history + refunds
    │   ├── reports/       # Sales reports + CSV export
    │   ├── staff/         # Login, staff CRUD, shift modal
    │   └── settings/      # Settings form
    ├── lib/               # api.ts (IPC bridge), currency.ts, dates.ts
    ├── stores/            # Zustand: cart, auth, UI (toasts/modals)
    └── types/             # Shared TypeScript domain types
```

## Key Design Decisions

- **Offline-first**: All data lives in SQLite (`%APPDATA%/pos-system/database/pos.db`). No internet required for any feature.
- **WAL mode**: SQLite runs in WAL journal mode — safe on abrupt termination.
- **IPC boundary**: The renderer *never* touches the database or filesystem directly. All data flows through `window.api` → `contextBridge` → `ipcMain` handlers → service layer.
- **Service layer**: Components call `api.*` (the IPC bridge), never raw SQL. Business logic lives exclusively in `src/main/services/`.
- **Role guards**: Routes are protected by minimum role level (`cashier=1, manager=2, admin=3`). The `RequireAuth` component redirects unauthorized access.
- **Barcode scanning**: Keyboard-wedge scanners are supported via a global `keydown` listener that accumulates characters and fires on `Enter` within 100ms gaps.

## Extending the App

### Add a new IPC endpoint
1. Add the channel name to `src/main/ipc/channels.ts`
2. Add the handler in `src/main/ipc/handlers.ts`
3. Expose it via `contextBridge` in `src/preload/index.ts`
4. Add the typed wrapper in `src/renderer/src/lib/api.ts`

### Add a new screen
1. Create `src/renderer/src/features/<name>/<Name>Screen.tsx`
2. Add a route in `App.tsx`
3. Add a nav item in `Sidebar.tsx` with appropriate `minRole`

### Schema changes
1. Add DDL to `src/main/database/migrate.ts` → `applyV1()` (or a new `applyV2()`)
2. Increment `SCHEMA_VERSION` in `migrate.ts`
3. Update `src/main/database/schema/index.ts` with Drizzle table definitions

## Receipt Printing

The app is wired for ESC/POS thermal printing. To activate:
1. Set `receiptPrinterPort` in Settings (e.g. `COM3` or `\\.\USB001`)
2. Implement the print command in `src/main/ipc/handlers.ts` → `IPC.RECEIPT_PRINT`
   using `electron-pos-printer` or the `escpos` npm package

## Sync

The sync layer is architected but not yet implemented. To enable:
1. Set `syncUrl` and `syncApiKey` in Settings
2. Implement a background sync worker in `src/main/` that reads orders with `syncStatus = 'pending'` and POSTs them to your server
3. Update `syncStatus` to `'synced'` or `'error'` after each attempt
