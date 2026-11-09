---
phase: 01-multi-tenant-foundation
plan: 01
subsystem: database
tags: [nextjs, supabase, postgres, rls, security-definer, zod, vitest, shadcn, tailwind, pnpm]

# Dependency graph
requires: []
provides:
  - "Next.js 16 + React 19 + Tailwind v4 + TypeScript scaffold at the repo root, pnpm-managed"
  - "shadcn design system (Radix primitives, neutral base, CSS variables) carrying the UI-SPEC token layer"
  - "public.accounts / public.venues / public.venue_members tables + public.venue_role enum"
  - "private.get_venue_role(venue_id, user_id) SECURITY DEFINER helper — the sole role-resolution mechanism"
  - "public.ensure_account(terms_version) — records Terms & Privacy consent at account creation"
  - "public.create_venue(...) — atomic venue + owner-membership bootstrap RPC, the only venue write path"
  - "RLS enabled with dual venue+role policies on all three tables"
  - "lib/supabase/{server,client,admin}.ts typed client factories; admin.ts server-only guarded"
  - "proxy.ts session revalidation via getUser()"
  - "lib/database.types.ts generated from the live local schema and wired into every client"
  - "Vitest integration harness (serialized) + tests/rls/setup.ts fixtures + expectWriteDenied"
  - "Owner signup -> first venue -> venue dashboard slice (the walking skeleton)"
affects:
  - "01-02 owner auth completion (Google one-tap, login, password reset)"
  - "01-03 staff PIN provisioning"
  - "01-04 device provisioning and revoke"
  - "01-05 role x venue RLS matrix"
  - "every later phase — all venue-scoped tables FK to venues.id and route RLS through private.get_venue_role"

# Tech tracking
tech-stack:
  added:
    - "next 16.2.12"
    - "react 19.2.4 / react-dom 19.2.4"
    - "typescript 5.9.3"
    - "tailwindcss 4.3.3 + @tailwindcss/postcss"
    - "@supabase/supabase-js 2.110.8"
    - "@supabase/ssr 0.12.3"
    - "zod 4.4.3"
    - "vitest 4.1.10 + @vitejs/plugin-react 6.0.4"
    - "shadcn 4.15.0 + radix-ui 1.6.7 + lucide-react + sonner + next-themes + tw-animate-css"
    - "Supabase CLI 2.109.1 (host tool, not an npm dependency)"
  patterns:
    - "RLS enabled in the same migration that creates the table (D-23)"
    - "Every policy calls private.get_venue_role(venue_id, (select auth.uid())) — never an inline join"
    - "auth.uid() always wrapped as (select auth.uid()) so it evaluates once per query, not per row"
    - "SECURITY DEFINER RPC as the only insert path; `authenticated` holds no INSERT or DELETE grant"
    - "Business-rule raises use the plpgsql default SQLSTATE P0001 so PostgREST forwards the message"
    - "Zod schemas live in lib/validation/ and are shared by Server Actions and tests — one definition of valid input"
    - "Denial is asserted by zero-rows-affected plus an unchanged re-read, never by a truthy `error`"
    - "Service-role client confined to fixture setup and labelled negative controls; assertions go through the anon key"
    - "Generated database types wired into every client factory so schema drift is a type error"

key-files:
  created:
    - "supabase/migrations/0001_core_tenancy.sql"
    - "supabase/seed.sql"
    - "supabase/config.toml"
    - "lib/supabase/server.ts"
    - "lib/supabase/client.ts"
    - "lib/supabase/admin.ts"
    - "lib/database.types.ts"
    - "lib/validation/auth.ts"
    - "lib/validation/venue.ts"
    - "lib/copy.ts"
    - "actions/auth.ts"
    - "actions/venues.ts"
    - "proxy.ts"
    - "app/(auth)/signup/page.tsx"
    - "app/(dashboard)/layout.tsx"
    - "app/(dashboard)/venues/[venueId]/page.tsx"
    - "components/dashboard-nav.tsx"
    - "app/globals.css"
    - "vitest.config.ts"
    - "tests/setup-env.ts"
    - "tests/rls/setup.ts"
    - "tests/rls/venue-isolation.test.ts"
    - "tests/auth/signup.test.ts"
    - ".env.example"
  modified: []

key-decisions:
  - "pnpm is the project package manager (pnpm 10.18.2 / Node 24.14.1) — plans 01-02..01-05 must translate their literal npm/npx commands"
  - "The app lives at the REPO ROOT, scaffolded via the official create-next-app installer into a temp dir then moved up; no src/ directory"
  - "Next 16 deprecated the `middleware` file convention and renamed it to `proxy`, so the session-revalidation file is proxy.ts, not middleware.ts"
  - "shadcn's `new-york` style no longer exists in the current CLI; components.json records style `radix-nova` with baseColor neutral + cssVariables true"
  - "shadcn's react-hook-form `form` component is an empty stub in the current registry; forms use React 19 useActionState + server-side Zod instead"
  - "Explicit table and function GRANTs are load-bearing — Supabase no longer auto-exposes new public entities to the Data API roles"
  - "`authenticated` gets no INSERT or DELETE grant on any table; every insert flows through a SECURITY DEFINER RPC"
  - "create_venue's country_code/timezone default to null in SQL because EUR spans twenty countries and cannot be derived"
  - "Business-rule raises use SQLSTATE P0001 because PostgREST suppresses the message for 5xx-mapped codes"
  - "The private.get_venue_role revokes are knowingly no-ops; PostgREST schema exposure is the real protection, and revoking from PUBLIC would break policy evaluation"

patterns-established:
  - "Tenant isolation: accounts -> venues -> venue_members with a private-schema SECURITY DEFINER role helper"
  - "Bootstrap RPC pattern: a SECURITY DEFINER function resolves the RLS deadlock where a first-time owner has no membership row to satisfy an owner-only INSERT policy"
  - "Client-SDK-only RLS testing through the anon key as a real signed-in user (D-25)"
  - "Copywriting contract centralised in lib/copy.ts, with the literal contract strings annotated in each page for direct diffing against UI-SPEC"

requirements-completed: [ACCT-01, ACCT-02, ACCT-03, ACCT-08]

coverage:
  - id: D1
    description: "An owner signs up with email + password and explicit Terms & Privacy consent, with no email-verification gate, and the accepted version + timestamp are recorded on their account"
    requirement: "ACCT-01"
    verification:
      - kind: integration
        ref: "tests/auth/signup.test.ts#stamps the accepted terms version and timestamp on the account"
        status: pass
      - kind: integration
        ref: "tests/auth/signup.test.ts#refuses to create an account without a terms version"
        status: pass
      - kind: unit
        ref: "tests/auth/signup.test.ts#rejects signup input at the Zod boundary before any auth call"
        status: pass
    human_judgment: false
  - id: D2
    description: "A signed-in owner creates a venue through the real anon-key write path; the create_venue RPC inserts the venue and exactly one owner venue_members row atomically, resolving the RLS bootstrap deadlock"
    requirement: "ACCT-02"
    verification:
      - kind: integration
        ref: "tests/rls/venue-isolation.test.ts#creates the venue and its owner membership atomically via create_venue"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation.test.ts#refuses a direct client INSERT into venues — the RPC is the only write path"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation.test.ts#refuses to create a venue for a user with no account row"
        status: pass
    human_judgment: false
  - id: D3
    description: "Venue input is constrained: blank/whitespace names rejected at the Zod boundary, currency limited to RON/HUF/EUR, default language must be one of the enabled languages, names stored trimmed with RO/HU diacritics preserved, duplicate names allowed as distinct rows"
    requirement: "ACCT-02"
    verification:
      - kind: unit
        ref: "tests/rls/venue-isolation.test.ts#createVenue input validation (ACCT-02 empty / domain) — 6 assertions"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation.test.ts#stores the venue name trimmed, and preserves RO/HU diacritics"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation.test.ts#treats two identically named venues as distinct rows (name is not a key)"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation.test.ts#rejects an unsupported currency and a blank name at the DB layer"
        status: pass
    human_judgment: false
  - id: D4
    description: "One owner holds multiple venues and reads all of them in deterministic created_at order"
    requirement: "ACCT-03"
    verification:
      - kind: integration
        ref: "tests/rls/venue-isolation.test.ts#owner A sees both of their venues in created_at order; owner B sees none of them"
        status: pass
    human_judgment: false
  - id: D5
    description: "Cross-owner tenant isolation holds at the RLS layer: a second owner reads zero of the first owner's venues and zero of their venue_members rows, while still being able to create their own venue"
    requirement: "ACCT-08"
    verification:
      - kind: integration
        ref: "tests/rls/venue-isolation.test.ts#owner A sees both of their venues in created_at order; owner B sees none of them"
        status: pass
      - kind: integration
        ref: "tests/auth/signup.test.ts#does not let another owner read the first owner's account row"
        status: pass
    human_judgment: false
  - id: D6
    description: "An owner with zero staff and zero devices still fully manages their venue"
    requirement: "ACCT-03"
    verification:
      - kind: integration
        ref: "tests/rls/venue-isolation.test.ts#an owner with zero staff and zero devices still fully manages their venue (ACCT-07)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Migration 0001 applies cleanly to the live local stack with RLS enabled on all three tables, no blanket permit-all policy, and TypeScript types generated from the applied schema"
    verification:
      - kind: automated_ui
        ref: "supabase db reset && supabase gen types typescript --local && pnpm exec tsc --noEmit && pnpm exec next build"
        status: pass
      - kind: other
        ref: "psql: pg_tables.rowsecurity = t for accounts/venues/venue_members; 5 policies, none with a `true` predicate"
        status: pass
    human_judgment: false
  - id: D8
    description: "The signup form (UI-SPEC E1) and venue creation form (E3) render per the design contract: consent unchecked by default and blocking submit, inline Zod field errors plus a top-level alert, spinner and disable during the round-trip, values preserved across a rejected submit, contract CTA copy"
    verification:
      - kind: integration
        ref: "pnpm exec next build — /signup compiles and prerenders"
        status: pass
    human_judgment: true
    rationale: "Visual hierarchy, focal anchor, spacing rhythm, the accent colour appearing only on the primary CTA, and the spinner/disable transition are judgments a build cannot make. `pnpm dev` was deliberately not run (it never exits); the user smoke-tests it after the wave."
  - id: D9
    description: "The dashboard shell (UI-SPEC E4) renders a server-rendered sidebar nav + header, the sidebar scrolls on short viewports without clipping nav items, and a venue name beyond ~28 characters truncates with ellipsis in the header"
    verification:
      - kind: integration
        ref: "pnpm exec next build — /venues/[venueId] compiles as a dynamic route"
        status: pass
    human_judgment: true
    rationale: "UI-SPEC records the long-text truncation as `verification: backstop` — an explicitly held-out visual check. Sidebar overflow behaviour also needs a real short viewport."

# Metrics
duration: 35min
completed: 2026-07-27
status: complete
---

# Phase 1 Plan 01: Multi-Tenant Foundation Summary

**A working owner-signs-up-with-consent → creates-a-venue → reads-it-back-through-RLS slice on Next.js 16 + Supabase, with tenant isolation proven by 18 client-SDK integration assertions against a live local Postgres.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-27T07:03Z (approx)
- **Completed:** 2026-07-27T07:38Z
- **Tasks:** 4 of 4 (Task 1 was a human-approved gate producing no commit)
- **Files modified:** 52 files, 12,126 insertions

## Accomplishments

- **The security boundary every later phase inherits is in place and proven.** `accounts → venues → venue_members` with a `private.get_venue_role()` SECURITY DEFINER helper, RLS enabled in the creation migration, and dual venue+role policies that call the helper rather than joining inline. A second owner reads zero of the first owner's venues, zero of their `venue_members` rows, and zero of their `accounts` row — asserted through the anon key as a real signed-in user, not through the SQL editor or the service-role client.
- **The RLS bootstrap deadlock is resolved rather than worked around.** A brand-new owner has no membership row, so the owner-only INSERT policy on `venues` can never be satisfied from the client. `public.create_venue()` inserts the venue and the owner membership in one transaction under definer privilege, re-checking `auth.uid()` and account ownership internally. A direct client INSERT into `venues` is proven to fail, so the RPC is structurally the only write path — and its atomicity is what guarantees no venue can exist without exactly one owner membership, however many times the button is double-clicked.
- **Consent is recorded at account creation, not on a later screen.** `ensure_account()` stamps the accepted Terms & Privacy version and timestamp in the same round-trip that creates the account, and refuses a blank version outright.
- **Verification runs against the schema as actually applied**, not a type shim: `supabase db reset` → `supabase gen types typescript --local` → 18/18 tests → `tsc --noEmit` → `next build`. The generated types are wired into all three client factories, so a future migration that changes a column becomes a type error rather than a runtime surprise.
- **The design system carries the UI-SPEC contract as code**: a 4-multiple spacing scale, four typography roles at exactly two weights, and the accent `#16A34A` mapped to `--primary`/`--ring` only — deliberately *not* to shadcn's `--accent` token, which stays neutral so the accent remains reserved for primary CTAs, the active nav item and the focus ring.

## Task Commits

1. **Task 1: Package legitimacy glance before first install** — no commit (blocking-human gate, approved by the user before dispatch; see Deviations)
2. **Task 2: Foundation — scaffold, Supabase clients, design system, Vitest harness, migration 0001** — `0ee6891` (feat)
3. **Task 3: End-to-end owner signup → venue → dashboard tracer (TDD)** — `f1709a8` (test, RED) then `0dddf5e` (feat, GREEN)
4. **Task 4: Apply schema to the live local stack + generate types** — `dd48e81` (feat)

**Plan metadata:** committed with this SUMMARY.

## Files Created/Modified

**Database**
- `supabase/migrations/0001_core_tenancy.sql` — the whole tenancy boundary: `private` schema, `venue_role` enum, three tables with their CHECK constraints and indexes, `private.get_venue_role()`, `ensure_account()`, `create_venue()`, RLS + 5 policies, and the explicit Data API grants
- `supabase/seed.sql` — local-dev owner (`owner@cena.local` / `cena-dev-password`) with two venues (RO + HU), namespaced `@cena.local` so it can never collide with the `@cena.test` fixtures
- `supabase/config.toml` — `project_id = "cena"`, `minimum_password_length = 8`, raised local signup rate limit

**Supabase clients + session**
- `lib/supabase/server.ts` — cookie-bound RLS client for RSC/Server Actions
- `lib/supabase/client.ts` — browser client
- `lib/supabase/admin.ts` — secret-key client behind `import 'server-only'`
- `lib/database.types.ts` — generated from the live schema, wired into all three
- `proxy.ts` — session revalidation with `getUser()` (Next 16's renamed `middleware.ts`)

**Application**
- `lib/validation/auth.ts`, `lib/validation/venue.ts` — Zod schemas shared by actions and tests
- `lib/copy.ts` — the UI-SPEC Copywriting Contract
- `actions/auth.ts` — `signUpOwner` (signup + consent)
- `actions/venues.ts` — `createVenue` (Zod → `create_venue` RPC → redirect)
- `app/(auth)/signup/page.tsx` — combined signup → first-venue flow
- `app/(dashboard)/layout.tsx`, `components/dashboard-nav.tsx` — server-rendered shell
- `app/(dashboard)/venues/[venueId]/page.tsx` — venue dashboard via a real RLS read
- `app/globals.css`, `app/layout.tsx`, `components.json` — UI-SPEC token layer, Inter at 400/600

**Tests**
- `vitest.config.ts` — serialized within *and* across files; `@/*` alias
- `tests/setup-env.ts` — loads `.env.local` into the worker
- `tests/rls/setup.ts` — inline service-role fixtures, `expectWriteDenied`
- `tests/rls/venue-isolation.test.ts` — 14 assertions (the D-25 release gate)
- `tests/auth/signup.test.ts` — 4 assertions (consent evidence)

## Decisions Made

Beyond the user-directed deviations below:

- **`authenticated` holds no INSERT or DELETE grant on any table.** Combined with Supabase no longer auto-exposing new `public` entities, this makes "every insert goes through a SECURITY DEFINER RPC" a structural property rather than a convention a later plan can forget. A later phase needing a new insert adds an RPC, not a grant — and a missing grant fails loudly with `permission denied for table`, not silently with zero rows.
- **`venues` carries a `member_select` policy alongside `owner_all`**, deliberately widening read access from the owner-only default, because the shared tablet holds a staff-role session and must read its own venue's name and currency to render anything. `venue_members` gets the opposite treatment — `select_own` only — so a staff device can learn its own role but cannot enumerate the owner's `user_id`.
- **The `private.get_venue_role` revokes are documented as knowingly no-ops.** `anon` and `authenticated` inherit EXECUTE from PUBLIC and were never granted it directly, so revoking from them removes nothing. Revoking from PUBLIC — the one revoke that would bite — would break every policy, because RLS predicates are evaluated with the querying user's privileges. The real protection is that PostgREST only exposes `public` and `graphql_public`, so no URL reaches the helper. The migration says so in a comment positioned as a tripwire if `private` is ever added to that list. This was the implementation-time verification the plan asked for, and the answer is: the plan's reasoning was correct.
- **Business-rule raises use the plpgsql default SQLSTATE P0001.** The semantically precise codes (`22023`, `P0002`) land in PostgREST's 5xx bucket where the message is suppressed and the caller gets a bare "Something went wrong". Found by a failing test, not by reading docs.

## Deviations from Plan

### User-directed (approved at the Task 1 checkpoint)

**1. [User-directed] pnpm, not npm**
- Every `npm install X` → `pnpm add X`, `npm install -D X` → `pnpm add -D X`, `npx X` → `pnpm dlx X`. `pnpm-lock.yaml` is committed; no `package-lock.json` exists anywhere.
- **This is now the project-wide convention.** Plans 01-02 … 01-05 still contain literal `npm install` / `npx` text and must be read with this translation applied.
- **Sharp edge worth carrying forward:** `pnpm dlx tsc` resolves to a **deprecated squatter package named `tsc`**, not the TypeScript compiler — it prints "This is not the tsc command you are looking for". Use `pnpm exec tsc` (the locally installed binary). The same applies to `pnpm dlx vitest`: prefer `pnpm exec`. Only use `pnpm dlx` for genuine one-shot scaffolders (`create-next-app`, `shadcn`).

**2. [User-directed] Official Next.js installer, not a hand-written package.json**
- `pnpm create next-app@latest` with explicit flags. Versions therefore come from the template: `typescript 5.9.3` (not RESEARCH's 7.0.2) and `react 19.2.4` (not 19.2.8). `next`, `@supabase/*`, `zod` and `vitest` all match RESEARCH exactly.

**3. [User-directed] App at the repo root, no subdirectory**
- Scaffolded into a temp dir, moved up, temp dir deleted. Verified: no `src/`, `app/globals.css` present at the repo root, no leftover scaffold directory.

**4. [User-directed] Explicit flags, not `--yes`**
- `--ts --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-pnpm --disable-git`.

**5. [User-directed] `pnpm dev` not run**
- Verification used `pnpm exec tsc --noEmit`, `pnpm exec vitest run`, `supabase db reset`, plus `pnpm exec next build` (added — see below).

### Auto-fixed issues

**6. [Rule 3 - Blocking] Temp scaffold directory renamed `.cena-scaffold` → `cena`**
- **Found during:** Task 2
- **Issue:** `create-next-app` refuses a directory name starting with a period: "name cannot start with a period" (npm package-name rules).
- **Fix:** Scaffolded into `cena` instead, which also yields the correct `"name": "cena"` in `package.json`. Moved up and deleted.
- **Verification:** `ls -a` shows no leftover directory.
- **Committed in:** `0ee6891`

**7. [Rule 1 - Bug] `middleware.ts` → `proxy.ts` (Next.js 16 renamed the convention)**
- **Found during:** Task 2
- **Issue:** The plan and plans 01-02 … 01-05 all specify `middleware.ts`. Next 16 **deprecated** that file convention and renamed it to `proxy`, with the exported function renamed `middleware` → `proxy` (`node_modules/next/dist/docs/.../proxy.md`: "v16.0.0: Middleware is deprecated and renamed to Proxy"). Shipping `middleware.ts` would build on a deprecated path.
- **Fix:** Created `proxy.ts` at the repo root with `export async function proxy(request)`, same matcher semantics. `next build` confirms it registers ("ƒ Proxy (Middleware)").
- **Carry forward:** plans 01-02 … 01-05 should read `middleware.ts` as `proxy.ts`.
- **Committed in:** `0ee6891`

**8. [Rule 1 - Bug] `supabase init` wrote the worktree directory name as `project_id`**
- **Found during:** Task 2
- **Issue:** `project_id = "agent-a5b5cdb0952311883"` — derived from the worktree directory. It would have been committed and named every local Docker container after a throwaway worktree.
- **Fix:** Set `project_id = "cena"`. Containers are now `supabase_*_cena`.
- **Committed in:** `0ee6891`

**9. [Rule 2 - Missing Critical] Explicit Data API GRANTs added to migration 0001**
- **Found during:** Task 2
- **Issue:** `supabase/config.toml` documents that `auto_expose_new_tables` is unset, "matching the new cloud default", meaning **new `public` entities are NOT reachable by `anon`/`authenticated`/`service_role` without explicit GRANTs**. The plan's migration spec covered RLS but not grants. Without them every query would have returned `permission denied for table`, and — more dangerously — a future reader could have mistaken that for RLS working.
- **Fix:** Explicit narrow grants: `select, update` on `accounts` and `venues`, `select` on `venue_members`, `all` to `service_role`, nothing to `anon`. RPC EXECUTE revoked **from PUBLIC first** (the operative statement — revoking only from `anon` is a no-op because `anon` inherits from PUBLIC) then granted to `authenticated` and `service_role`.
- **Verification:** 18/18 tests exercise real reads/writes through the anon key.
- **Committed in:** `0ee6891`

**10. [Rule 2 - Missing Critical] `venues_name_not_blank` CHECK constraint added**
- **Found during:** Task 2
- **Issue:** The plan states Zod rejects a blank name and "the DB CHECK is the backstop", but specified no such constraint. There was no backstop.
- **Fix:** `check (btrim(name) <> '')`.
- **Verification:** `tests/rls/venue-isolation.test.ts` asserts a service-role insert of `"   "` is rejected.
- **Committed in:** `0ee6891`

**11. [Rule 1 - Bug] PostgREST swallowed the RPC business-rule messages**
- **Found during:** Task 3 (caught by a failing GREEN assertion)
- **Issue:** `create_venue`'s "no account exists — call ensure_account first" raise used SQLSTATE `P0002`, which PostgREST buckets as 5xx and answers with a bare `"Something went wrong"`. The one diagnostic a Google-first owner's failure depends on was being discarded. `ensure_account`'s `22023` had the same problem.
- **Fix:** Both raise with the plpgsql default `P0001`, which PostgREST maps to HTTP 400 and forwards verbatim.
- **Verification:** `refuses to create a venue for a user with no account row` now matches `/ensure_account/i`.
- **Committed in:** `0dddf5e`

**12. [Rule 2 - Missing Critical] `create_venue` country/timezone default to null**
- **Found during:** Task 4
- **Issue:** With non-defaulted `text` params the generated Args typed them as required non-null strings, so the action had to send `""` for an EUR venue that has no derivable country. An empty string in a nullable column later reads as a real value.
- **Fix:** `default null` in SQL; the generator emits them as optional keys; `createVenue` omits them when blank so the column stores NULL.
- **Verification:** `tsc --noEmit` clean with the `Database` generic wired in; 18/18 tests green.
- **Committed in:** `dd48e81`

### Tooling-forced deviations

**13. [Rule 3 - Blocking] shadcn `style: "new-york"` no longer exists**
- **Issue:** UI-SPEC and the plan require `style=new-york, baseColor=neutral, cssVariables=true`. The current shadcn CLI (4.15.0) has removed `--style` entirely; `init` now takes `-b <base>` (base | radix | aria) and `-p <preset>` (nova | vega | maia | lyra | mira | luma | sera | rhea). There is no way to produce `"style": "new-york"`.
- **Fix:** Chose the nearest faithful equivalent — `-b radix` (UI-SPEC requires Radix primitives) with preset `nova` (Lucide icons, matching UI-SPEC's icon library). `components.json` records `"style": "radix-nova"`, **`baseColor: "neutral"` ✅ and `cssVariables: true` ✅**. Hand-editing `style` to `"new-york"` was rejected because the CLI resolves registry components through that field, so the lie would break every future `shadcn add`.
- **Acceptance-criterion impact:** the criterion "`components.json` exists with style `new-york`" **cannot be satisfied by any current tooling**. `baseColor` and `cssVariables` are satisfied exactly.

**14. [Rule 3 - Blocking] shadcn `form` component is an empty registry stub**
- **Issue:** `shadcn add form` silently adds nothing; `shadcn view form` returns a registry item with no files. The react-hook-form wrapper is gone from the current registry, and `react-hook-form` was never installed.
- **Fix:** Forms use React 19 `useActionState` + Server Actions + server-side Zod — the idiomatic Server Actions pattern, and one fewer client dependency. Every UI-SPEC E1/E3 behaviour is preserved: inline per-field Zod errors, a top-level error alert, spinner + disable during the round-trip, and values preserved across a rejected submit (the action echoes submitted values back, which is load-bearing because React 19 resets an uncontrolled form once the action settles).
- **Carry forward:** later plans should not expect `components/ui/form.tsx`.

**15. [Rule 3 - Blocking] Currency/language selects use native `<select>`**
- **Issue:** shadcn `select` is not in the plan's or UI-SPEC's component list for this phase.
- **Fix:** Native `<select>` styled with the design tokens. No new component added.

### Additive files not listed in the plan

**16. [Rule 2] Four supporting files added**
- `lib/validation/auth.ts` + `lib/validation/venue.ts` — the plan requires the test to assert "createVenue's Zod rejects a blank name and a non-RON/HUF/EUR currency". Importing `actions/venues.ts` into Vitest is not viable (it pulls `next/headers`), and a second copy of the schema in the test would pass happily while the real boundary was broken. One shared definition, imported by both.
- `lib/copy.ts` — the UI-SPEC Copywriting Contract in one place. The exact contract strings are additionally spelled out in a comment block at the top of `app/(auth)/signup/page.tsx` so the page can be diffed against `01-UI-SPEC.md` without opening another file.
- `tests/setup-env.ts` — Vitest does not read `.env.local` (that is a Next.js convention). Uses the built-in `process.loadEnvFile`, so no dependency, and fails with an actionable message naming `supabase start` if a variable is missing.
- `components/dashboard-nav.tsx` — the sidebar nav needs `usePathname()` to derive the venue id and mark the active item, so it must be a Client Component; the layout stays a Server Component.
- `.env.example` — committed template (with a `!.env.example` exception in `.gitignore`); `.env.local` remains ignored.

### Hardening not requested by the plan

**17. [Rule 2] `minimum_password_length` 6 → 8** in `supabase/config.toml`, kept in lockstep with the Zod rule so GoTrue cannot reject a password the form accepted (ASVS V2).

**18. [Rule 2] Local signup rate limit 30 → 100.** The suite signs several owners in and out per run; back-to-back `db reset` + re-run cycles tripped the default and surfaced as a confusing auth failure rather than a rate-limit one. Local dev only — production limits live in the hosted project.

**19. [Rule 2] `next build` added to verification.** The plan's gates (`tsc --noEmit`, `vitest run`, `supabase db reset`) cannot catch a broken RSC/Client boundary or an unresolvable Tailwind utility. `next build` does, it terminates (unlike `pnpm dev`), and it confirmed `proxy.ts` registers. Passing.

**20. [Rule 1] Fixed the generated `--font-sans` token.** `shadcn init` wrote `--font-sans: var(--font-sans)` into `@theme inline` while `create-next-app`'s layout exposed `--font-geist-sans`, leaving `--font-sans` undefined. Inter is now bound to `--font-sans` directly, with `latin-ext` included for RO/HU diacritics.

---

**Total deviations:** 20 — 5 user-directed, 3 tooling-forced (shadcn/Next API changes), 8 Rule 1/2/3 auto-fixes, 4 additive-support/hardening.
**Impact on plan:** No scope creep. Every auto-fix was required for correctness (grants, PostgREST error masking, `project_id`), security (name CHECK, password length, revoke-from-PUBLIC), or because the plan's named tooling no longer exists (shadcn style/form, Next middleware→proxy). The one acceptance criterion that cannot be met — `components.json` style `new-york` — is unmeetable by any current version of the shadcn CLI, and the two parts of that criterion that remain meaningful (`baseColor: neutral`, `cssVariables: true`) are satisfied.

## Known Stubs

| Stub | File | Reason / resolving plan |
|---|---|---|
| Consent checkbox links to `/legal/terms` and `/legal/privacy`, **neither route exists** — both 404 today | `lib/copy.ts` (`COPY.consent.termsHref` / `privacyHref`), rendered in `app/(auth)/signup/page.tsx` | UI-SPEC requires both as links, and D-21 requires recording *which version* was accepted — but **no plan in phase 01 builds these pages**. This is a legal-facing gap: an owner is agreeing to documents they cannot read. Needs a phase-01 follow-up or an explicit backlog item; it is not resolved by plans 01-02 … 01-05. |
| Sidebar nav items *Staff*, *Devices*, *Settings* render disabled rather than as links | `components/dashboard-nav.tsx` (`enabled: false`) | Their routes are built by plans 01-03, 01-04 and 01-05. Rendering them disabled was chosen over links that 404; each plan flips one flag. Intentional and self-resolving. |
| `app/page.tsx` is still the default create-next-app landing page | `app/page.tsx` | Untouched scaffold output; no plan in phase 01 specifies a marketing/root page. Harmless but it is placeholder content at `/`. |

No `TODO`/`FIXME` markers, no skipped tests, and no unrun `<verify>` blocks. `.planning/WINDOWS.md` does not exist in this repo, so these entries live here only — they are surfaced for the verifier and for `/gsd-ship`.

## Threat Flags

None. Every surface created maps to an existing entry in the plan's threat register (T-01-01 … T-01-06, T-01-SC). No new network endpoint, auth path, or trust-boundary schema change was introduced beyond those.

Mitigations verified in place:
- **T-01-01** — dual venue+role policies; cross-owner denial proven by test; `venue_members` read-own prevents owner-`user_id` enumeration
- **T-01-02** — `import 'server-only'` in `admin.ts`; no `NEXT_PUBLIC_`-prefixed secret (grep clean); tests build their own inline service-role client
- **T-01-03** — both RPCs re-check `(select auth.uid())` internally; EXECUTE revoked from PUBLIC then granted to `authenticated` only
- **T-01-04** — Zod at the action boundary + four CHECK constraints on `venues`
- **T-01-05** — `proxy.ts` and `createVenue` both use `getUser()`, never `getSession()`
- **T-01-06** — `terms_accepted_version` + `terms_accepted_at` written by `ensure_account`; single-column overwrite remains accepted v1 debt

## Issues Encountered

- **`pnpm dlx tsc` runs a squatter package.** Caught immediately (it prints "This is not the tsc command you are looking for" rather than typechecking). Resolved by using `pnpm exec tsc`. Recorded above because a later plan following the literal `npx tsc --noEmit` text would hit the same trap — and a silently-not-typechecking gate is worse than a failing one.
- **`supabase start` needed a first-run image pull**, so the initial start was slow; `db reset` afterwards is a few seconds.
- **Seeding a loggable local owner** required inserting into `auth.identities` as well as `auth.users` — GoTrue resolves password sign-in through the identities table, so a `users` row alone produces an account that exists but cannot log in.

## User Setup Required

Already satisfied before dispatch — Docker running (28.3.2) and Supabase CLI installed (2.109.1 via Homebrew). No hosted Supabase project is needed for this plan.

To run locally after merge:
1. `pnpm install`
2. `supabase start` — prints the API URL, publishable key and secret key
3. Copy `.env.example` to `.env.local` and fill in those three values (or reuse the committed local defaults, which are identical on every machine)
4. `supabase db reset` — applies migration 0001 and the seed
5. `pnpm exec vitest run` — 18/18 should pass
6. `pnpm dev` and visit `/signup` — **the outstanding manual smoke test** (D8/D9 in `coverage`)

Local dev sign-in: `owner@cena.local` / `cena-dev-password`.

## Next Phase Readiness

**Ready.** The scaffold, design system, typed Supabase clients, migration 0001 and the Vitest harness are all in place and green, so plans 01-02 … 01-05 can build directly on them.

**Five things later plans in this phase must know:**

1. **pnpm, not npm.** Plans 01-02 … 01-05 contain literal `npm install` / `npx` text. Translate it, and prefer `pnpm exec` over `pnpm dlx` for anything already installed.
2. **`proxy.ts`, not `middleware.ts`.** Next 16 renamed the convention; the file already exists and registers.
3. **A new table needs both RLS *and* explicit GRANTs**, and its insert path must be a SECURITY DEFINER RPC — `authenticated` has no INSERT grant anywhere by design. Follow `create_venue` as the template.
4. **`components/ui/form.tsx` does not exist** and `react-hook-form` is not installed. Use `useActionState` + Zod, as `app/(auth)/signup/page.tsx` does.
5. **Regenerate `lib/database.types.ts`** (`supabase gen types typescript --local`) after every migration — the types are wired into all three clients, so a stale file becomes a type error.

**Two open items, neither blocking:**

- **The `/legal/terms` and `/legal/privacy` pages do not exist** (see Known Stubs). The consent checkbox links to them. Worth resolving inside phase 01 rather than after launch.
- **The visual UAT for D8 (signup/venue forms) and D9 (dashboard shell) is outstanding**, since `pnpm dev` was deliberately not run. `human_verify_mode` is `end-of-phase`, so this batches into the phase-end gate — where the E4/E5 long-text truncation backstop also wants checking against a >28-character venue name.

## Self-Check: PASSED

- All 23 files claimed above are present and tracked (`git ls-files`), including every entry in the plan's `files_modified` — with `middleware.ts` shipped as `proxy.ts` per deviation 7.
- All 4 task commits plus the metadata commit exist on `worktree-agent-a5b5cdb0952311883`, forked from `e97b17e`: `0ee6891`, `f1709a8`, `0dddf5e`, `dd48e81`, `518c6db`.
- No commit in this plan deleted a tracked file (`git diff --diff-filter=D` empty across the range).
- Working tree clean; no `package-lock.json`, no `src/`, no leftover scaffold directory, `.env.local` correctly untracked.
- Final gate re-run green: `supabase db reset` → 18/18 tests → `tsc --noEmit` clean → `next build` succeeds.
- `STATE.md` and `ROADMAP.md` were not modified (orchestrator-owned). `REQUIREMENTS.md` was deliberately left untouched: three of this plan's four requirement IDs (ACCT-01, ACCT-03, ACCT-08) are also claimed by plans 01-02, 01-04 and 01-05, so marking them complete here would be premature — the plan's own truths state ACCT-08 is "completed by the Plan 05 role×venue matrix".

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-27*
