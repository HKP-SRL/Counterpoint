## Why

Cena "looks like every AI-generated app". Asked to break that down, the owner named three causes:

1. **Layout and composition** — sidebar + card grid + stacked forms + centred auth cards.
2. **Component feel** — shadcn shapes and states still show through the Cena colours.
3. **Lack of polish** — motion, micro-interactions, density, finish.

The palette (tisza teal-greys, the single szeged azure accent) and the typefaces (Newsreader, Instrument Sans, IBM Plex Mono) are **not** the problem and are kept.

[Astryx](https://github.com/meta/astryx) — Meta's open-source design system (MIT, v0.7 beta, React 19 + StyleX, 150+ components) — fixes causes 2 and 3 directly. It does **not** fix cause 1: its page templates are built for agents to reach for and would become the next generic look. Composition is fixed only by designing each owner surface deliberately, which `docs/design/ui-contract-owner-ui-on-astryx.md` does region by region.

This is an **enabling change**: it delivers no requirement ID. It must land before the owner-side UI of every later change (`live-menu-for-diners` menu editor, QR printing and sold-out toggle; `menu-theming-and-templates` brand controls; `multilingual-menu` translation review; `cookieless-analytics` dashboard; `ai-menu-ingestion` correction UI), because they are all composed inside the shell and page grammar decided here, and the menu editor is the largest owner surface still to be built.

The diner menu is **out of scope** and stays hand-built, server-rendered from Cena and venue tokens, with zero Astryx bytes: Astryx ships one ~42 KB-gzipped stylesheet for every component and marks 560 of 1,164 shipped JS files `'use client'` (down to `Text`), which conflicts with a static, CDN-served page held to a poor-mobile-data budget (decision A-2 in `docs/notes/astryx-adoption-decisions.md`). The route-isolation spikes (`docs/spikes/MANIFEST.md`, spikes 001–003, passed 2026-11-10) proved the split works; their Requirements section is binding on this change.

## What Changes

- **Install Astryx, exact-pinned**: `@astryxdesign/core`, `@astryxdesign/theme-neutral` (extends base only) and `@stylexjs/stylex@0.19.1` as dependencies, `@astryxdesign/cli` as a devDependency — all at one exact version (0.7.12, or the 0.7.11 fallback) that has cleared pnpm's 24h minimum-release-age guard with no exclusion entry, approved by the owner at a blocking supply-chain checkpoint.
- **Wire Astryx into the owner route groups only**: `app/owner.css` and `OwnerProviders` (`Theme` + `LinkProvider`) enter through `app/(auth)/layout.tsx`, `app/(dashboard)/layout.tsx` and `app/(tablet)/layout.tsx`; `app/globals.css` gains only the `@layer` order line; `app/layout.tsx` imports nothing Astryx.
- **Ship one built Cena Astryx theme** (`components/astryx/theme/cena.theme.ts` → committed `cena.css`/`cena.js`/`cena.d.ts`, `theme:check` in CI): every value references `--cena-*`/`--font-*`/`--radius`; every rendered colour role mapped; Astryx's type scale collapsed onto Cena's four roles and two weights; controls visibly 44px under a coarse pointer and Astryx's 32/36px under a fine pointer; motion capped at 240ms and zeroed under reduced motion; all 29 icon slots overridden with Lucide at stroke 1.75; `mode="light"` only.
- **Add machine guards**: a build-output guard proving every non-owner route ships zero Astryx CSS/JS (with `/login` as the positive control); a static import-boundary and usage-discipline guard; a theme-output test; an Astryx role-pair contrast sweep (39 measurements, 0 failures); a shared-variable clash test; a GitHub Actions workflow running them with no secrets.
- **Run a computed-style regression audit** (Playwright, owner stylesheet on vs off) over all 11 existing owner surfaces before any surface is recomposed.
- **Recompose every owner surface** per the UI contract, Stripe-Dashboard-quiet:
  - dashboard shell: Astryx `AppShell` with a slim 240px sunken `SideNav` (wordmark, venue menu, grouped sections, disabled Settings) and, below 768px, a drawer behind a 56px top bar naming the active venue;
  - the venue name at the top of the sidebar is **always a menu** (0, 1, many venues, and on a read error) ending in "Create venue" — **supersedes** multi-tenant-foundation D-15's "switcher only with 2+ venues";
  - page grammar: serif `h1` page header with one context line and at most one primary action, full-width ruled sections, rows not cards, two-column settings rows for edit/create forms, side sheets for create forms, fixed-order `Dialog` (not `AlertDialog`) for destructive confirms;
  - auth screens on a shared paper layout (wordmark band, top-anchored 400px column, no card, no grey field);
  - the shared tablet keeps its kiosk scale (tiles ≥ 128×96px, PIN keys ≥ 64px) on Astryx primitives, with a safe-centred 480px utility column.
- **Build the shared owner kit**: `Glyph`, `SaveButton` (on-control "Added" settle), `useActionFields` + `fieldStatus` (controlled fields that never echo a secret), `NativeSelect`, `PageTitle`/`PageHeader`/`OwnerPage`/`PageSection`, `KioskColumn`, plus the jsdom polyfill module `tests/support/astryx-dom.ts`.
- **Extend the copy deck** (`lib/copy.ts`) with the new rows N1–N13, the changed rows C1–C2 ("Back to names", "Retry loading staff") and the folded inline strings, and make `tests/lib/copy-contract.test.ts` read `docs/design/ui-contract-owner-ui-on-astryx.md` as a second contract source.
- **Replace stale phase-number references in code comments with OpenSpec change names.**
- **BREAKING (internal UI kit)**: delete `components/ui/*` (19 files), `components/field-error.tsx`, `components.json`, and the `radix-ui`, `shadcn`, `sonner` and `tw-animate-css` dependencies; move the diner's `Tag` verbatim to `components/diner/tag.tsx`.
- **Deliberate behaviour changes** (recorded, never slipped in as selector edits): venue menu at every venue count; sidebar-bottom "Create venue" link removed; device-enrolment CTA becomes a page-header side-sheet trigger; consent legal links open in a new tab; disabled controls are `aria-disabled`; no toasts; language checkboxes submit through hidden inputs; owner `h2`–`h6` render in Instrument Sans; owner control size adapts to the pointer instead of a universal visual 44px floor.

## Capabilities

### New Capabilities

- `owner-ui`: how every owner-side surface (auth, dashboard shell, venues, staff, devices, shared tablet) is built and composed on Astryx wearing the one Cena theme — route isolation from the diner, the theme's colour/type/size/motion/icon contract, the shell and venue menu, the page grammar, per-surface behaviour, and the guards that hold it.

### Modified Capabilities

- `design-system`: the 44px touch floor becomes pointer-adaptive on owner surfaces (diner unchanged, kiosk scale kept); Newsreader narrows to the wordmark and page title on owner screens; the glyph rule extends to the theme icon registry; toasts leave the dark-mode rule; reduced motion is stated for components generally; the "nineteen primitives on Radix" requirement is removed.
- `venues`: the venue switcher is no longer hidden below two venues; it renders at every venue count and on a read error, ending with "Create venue".
- `shared-tablet`: "Enable staff mode" stays reachable as a page-header action that opens the enrolment sheet, instead of a link below the registry.

## Impact

- **Dependencies added**: `@astryxdesign/core`, `@astryxdesign/theme-neutral`, `@astryxdesign/cli` (dev) at one exact version (0.7.12 or 0.7.11), `@stylexjs/stylex@0.19.1`, `playwright@1.64.1` (dev, exact). `pnpm-workspace.yaml`: `ignoredBuiltDependencies` gains `@astryxdesign/core` and `@astryxdesign/cli` (and `playwright` if pnpm asks); no `minimumReleaseAgeExclude`.
- **Dependencies removed**: `radix-ui`, `shadcn`, `sonner`, `tw-animate-css`; `components.json`. Kept: `class-variance-authority`, `clsx`, `tailwind-merge` (the diner `Tag` and `lib/utils.ts`), `lucide-react`.
- **New files**: `app/owner.css`; `app/(auth)/layout.tsx`, `app/(tablet)/layout.tsx`; `components/astryx/{owner-providers.tsx, glyph.tsx, save-button.tsx, use-action-fields.ts, native-select.tsx, page-header.tsx}`; `components/astryx/theme/{cena.theme.ts, cena-icons.tsx}` + generated `cena.css`/`cena.js`/`cena.d.ts`; `components/owner-side-nav.tsx`; `components/diner/tag.tsx`; `app/(tablet)/components/kiosk-column.tsx`; `app/(dashboard)/venues/[venueId]/staff/components/{add-staff-sheet.tsx, staff-roster.tsx}`; `app/(dashboard)/venues/[venueId]/staff/devices/components/{enrol-device-sheet.tsx, device-registry.tsx}`; `scripts/owner-style-audit.mjs`; `.github/workflows/verify.yml`.
- **Modified files**: `package.json` (scripts `theme:build`, `theme:check`, `test:static`, `verify:build`, `audit:owner-styles`), `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `app/globals.css` (layer line added; `tw-animate-css` and `shadcn/tailwind.css` imports removed; root `h1`–`h6` serif rule untouched), `lib/copy.ts`, the dashboard layout and every owner page/form under `app/(auth)`, `app/(dashboard)`, `app/(tablet)`, `components/venue-form.tsx`, comment-only edits in ~19 files.
- **Deleted files**: `components/ui/*` (Tag moved), `components/field-error.tsx`, `components/dashboard-nav.tsx`, `components.json`.
- **Tests added**: `tests/support/{scan-route-assets.ts, astryx-dom.ts}`; `tests/theme/{astryx-route-isolation, astryx-import-boundary, astryx-theme-output, astryx-contrast-guardrail, astryx-variable-clash}.test.ts`; `tests/kit/{save-button, use-action-fields, native-select, page-header}.test.tsx`; `tests/auth/{login-form, password-reset-forms, consent-implicit-submit}.test.tsx`; `tests/tablet/name-grid-pin-pad.test.tsx`; `tests/staff/staff-sheet.test.tsx`; `tests/devices/enrol-device-sheet.test.tsx`.
- **Tests changed** (selector/attribute-level or recorded behaviour change only): `tests/lib/copy-contract.test.ts` (second source), `tests/lib/unconditional-cta-coverage.test.ts` (rows re-pointed, marker match added), `tests/lib/create-venue-affordance.test.tsx` (rebuilt; 0-venue case now expects the menu), `tests/venues/multi-venue.test.ts` (rationale), `tests/venues/venue-form-languages.test.tsx`, `tests/venues/venue-eur-submission.test.tsx`, `tests/auth/google-affordance.test.tsx` (`aria-disabled`, `.checked`), `tests/theme/touch-targets.test.ts` (rebuilt on the theme mechanism), `tests/theme/design-system-discipline.test.ts` (glyph wrapper, icon registry, retired animated primitives).
- **Unchanged and must stay green**: the RLS release gate (`tests/rls`), the action and auth suites, ACCT-01…ACCT-08 behaviour, every Server Action and Zod schema, the dashboard layout's gate logic, `lib/allergens.ts`, `lib/diner-copy.ts`, the diner contrast sweep.
- **Environment**: `test:static` and `verify:build` need no Docker, Supabase CLI or `.env.local`; the computed-style audit (task group 5) and the final full suite (task group 13) need the local Supabase stack. Playwright browsers go to `/Volumes/Dock/Dev/Caches/ms-playwright` (never the internal disk).
