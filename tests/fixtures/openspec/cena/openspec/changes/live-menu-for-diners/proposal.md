## Why

The core value of Cena — a restaurant goes from nothing to a live menu on its tables by itself, and diners don't miss paper — has not been delivered yet: accounts, venues and roles exist, but there is no menu. This change is the earliest end-to-end slice: an owner hand-builds a simple menu and publishes it, and a diner scans a table QR and reads it fast on a phone, even when the connection drops mid-load. Connectivity is the release gate: in Budapest cellars, thick-walled Romanian buildings or with roaming switched off, a menu that shows nothing is worse than paper.

## What Changes

- Owners create, rename, reorder and delete categories, and create, edit, reorder and delete items (name, description, price in the venue currency) across one or more menus per venue (lunch, dinner, drinks…).
- Menus have a draft and a published state; edits never leak to diners until the owner publishes.
- Owners and staff toggle an item sold-out / available; diners see the change within seconds. This is the first user-facing surface for the staff restriction (staff may toggle availability and nothing else), which so far is proven only at the database layer.
- Owners generate and print a QR code per table; scanning it opens that venue's published menu in a mobile browser with nothing to install, and carries table identity.
- The diner menu is server-rendered/static, paints fast on a poor mobile connection, and falls back to the last-good published version when the network or backend fails mid-load.
- Diners browse categories and open an item to see its details.
- The owner-side screens (menu editor, QR printing, sold-out toggle) are built on Astryx; the diner menu is hand-built from Cena and venue tokens and imports no Astryx code.
- The placeholder `rls_test_items` table (and its toggle RPC) is replaced by the real `items` table in the same migration, and every new table joins the role x venue isolation suite.

## Capabilities

### New Capabilities

- `menu-management`: owner authoring of menus, categories and items, draft/publish, and the availability toggle (MENU-01, MENU-02, MENU-08, MENU-10, MENU-11, MENU-12; re-tests ACCT-06 as a user flow).
- `table-qr-codes`: printable per-table QR codes that resolve to the venue's published menu (DINE-01, DINE-02).
- `diner-menu`: the diner-facing menu — fast load, last-good fallback, browsing and item detail (DINE-03, DINE-04, DINE-05).

### Modified Capabilities

(none — the `tenant-isolation` guarantees apply unchanged to the new menu tables; the isolation suite grows to cover them)

## Impact

- Depends on `owner-ui-on-astryx` (owner screens are built once, on Astryx).
- New Supabase migrations: menus, categories, items, tables/QR tokens; the placeholder `rls_test_items` table is dropped in the same migration that introduces `items` (see docs/operations/production-schema-deploy.md).
- New diner route group (server-rendered, no Astryx), owner route(s) for the menu editor and QR printing.
- Uses the diner design vocabulary from `design-system-migration` (last-good/offline state, price formatting per currency).
- Research to apply: static generation + on-demand revalidation with stale-serve on regeneration failure, a service-worker cache of the last-loaded menu, stable per-table URLs (docs/research/README.md, ARCHITECTURE.md, PITFALLS.md). Verify the caching API against the pinned Next.js version.
- Release gate: the last-good fallback is proven by an automated test with the network failing mid-load.
