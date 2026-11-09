# Walking Skeleton — Cena

**Phase:** 1 (Multi-Tenant Foundation)
**Generated:** 2026-07-24

## Capability Proven End-to-End

A restaurant owner can sign up (email + password, with an "I agree to Terms & Privacy" checkbox), create their first venue (name, currency RON/HUF/EUR, default language, auto-derived country + timezone), land on the venue dashboard reading that venue back through Row Level Security — and a second owner cannot read the first owner's venue. This single slice exercises the whole stack: Next.js App Router + Supabase Auth + Postgres + RLS + the `private.get_venue_role()` boundary + a client-SDK integration test running against a local `supabase start` stack.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16.2.11, App Router, Server Actions, TypeScript, Tailwind | Locked stack (CLAUDE.md). Server Actions are the home for auth/venue/staff mutations; RSC pages read via RLS-respecting server client. |
| Data layer | Supabase (Postgres + RLS), migrations via Supabase CLI (`supabase db diff` / `migration new`) | Locked stack. RLS is the actual tenant-isolation boundary (D-22). Migrations stay reviewable in version control, never applied ad hoc in the dashboard. |
| Auth (owner) | Supabase Auth — email + password + Google One Tap (`signInWithIdToken`); no email-verification gate (D-02); long-lived refresh tokens (D-03) | GoTrue owns password hashing/session rotation; app never hand-rolls tokens. `@supabase/ssr` cookie sessions for SSR/Server Actions/middleware. |
| Auth (staff) | Provisioned device auth account per tablet whose `venue_members` row carries role `staff`; PIN profiles are app-level records layered on top (D-04, D-06). The verified staff_profile_id after PIN entry is held in an httpOnly `cena_staff` cookie scoped to the `(tablet)` route group — the concrete post-verify identity that stamps attribution (D-05) | The DB sees one `staff` principal per device, plugging into the same `get_venue_role()` helper with no special-casing. PINs hashed in-DB via `pgcrypto` (D-19). `staff_profiles` has NO member SELECT policy; the name grid is served by the SECURITY DEFINER `list_staff_for_pin()` (id/name only) so `pin_hash` is never column-readable. |
| Tenant isolation | `accounts → venues → venue_members` + `private.get_venue_role(v_id, u_id)` (two-arg) SECURITY DEFINER helper; every policy checks BOTH venue AND role; `(select auth.uid())` wrapped; RLS enabled in every creation migration (D-22, D-23). First-venue bootstrap is the atomic SECURITY DEFINER `create_venue()` RPC (owner-only INSERT RLS cannot authorize the first membership row) | The one place all "who can do what" resolves. Narrow RPCs (`toggle_item_availability`) are the only staff write path (D-11). |
| RPC authority rule (phase invariant) | Every `SECURITY DEFINER` RPC that mutates or reveals tenant data re-checks `private.get_venue_role` INTERNALLY (never Server-Action-only); every table's creation migration specifies its INSERT path, not just SELECT/broad policies; EXECUTE on privileged RPCs is revoked from `anon` | Root-cause fix from cross-AI review: the DB layer is the only boundary that counts, so app-layer authority checks are advisory UX only, never security. |
| Secret-key discipline | `lib/supabase/admin.ts` (with `import 'server-only'`) is the only production file importing the secret key, imported only from server-only Server Actions in `actions/devices.ts` (D-24). The test harness never imports it — `tests/rls/setup.ts` constructs its own inline service-role client from `SUPABASE_SECRET_KEY` (the `server-only` guard would otherwise throw under Vitest) | Device provisioning needs the secret key; it must never reach a client bundle, and the fixture path must not trip the server-only guard. |
| Design system | shadcn (style=new-york, base color=neutral, CSS variables=true), Radix primitives, `lucide-react`, Inter via `next/font/google`; initialized in the Wave 1 scaffold before any owner page; spacing on a 4px scale, tablet touch targets ≥44px (UI-SPEC) | Cena's internal product chrome (owner dashboard + tablet), neutral until Phase 4 introduces per-venue diner branding. Every later phase inherits these primitives. |
| Deployment target | Documented local full-stack run: `supabase start` (Docker) + `npm run dev`; Vercel deploy is git-based, added later | Research: Vercel CLI not required for Phase 1. The RLS release-gate suite (D-25) runs against the local stack. |
| Test harness | Vitest 4.x, `sequence.concurrent: false`, client-SDK (`@supabase/supabase-js`) integration tests signing in real seeded users per role × venue against local Supabase (D-25) | The release gate must exercise the same anon-key/client-SDK path a real request takes — never the SQL editor, never service-role. |
| Directory layout | Route groups `(auth)`, `(dashboard)`, `(tablet)`; `actions/`; `lib/supabase/{server,client,admin}.ts`; `supabase/migrations/`; `tests/rls/` | Per RESEARCH.md "Recommended Project Structure". `(tablet)` is isolated so a staff session can never inherit dashboard access. |

## Stack Touched in Phase 1

- [x] Project scaffold (Next.js + TypeScript + Tailwind + ESLint, `supabase init`, Vitest config)
- [x] Routing — `(auth)/signup`, `(dashboard)/venues/[venueId]`, `(tablet)/` real routes
- [x] Database — real write (create venue + owner membership), real read (dashboard reads venue via RLS)
- [x] UI — signup form + venue-creation form wired to Server Actions; venue dashboard
- [x] Deployment — documented local full-stack run (`supabase start` + `npm run dev`); RLS suite runs against it

## Out of Scope (Deferred to Later Slices)

Explicit, so later phases do not re-litigate Phase 1's minimalism:

- Any menu / category / item CRUD (Phase 2) — Phase 1 proves the permission boundary against a `rls_test_items` placeholder, not real menu tables.
- The fast "86" sold-out **UI** and its diner-facing propagation (Phase 2) — Phase 1 proves only the `toggle_item_availability()` write boundary.
- Theming, translations, analytics, AI ingestion (Phases 4–7).
- Full multi-venue management UI — schema is complete now; v1 UI is a minimal switcher (D-15).
- "Manager" role — dropped for v1; the enum is extensible so it lands later as one value + policy updates (D-09/D-10).
- Subscription billing / `plan_tier` enforcement — column reserved, unused (deferred).
- Fiscal / tax convention — `venues.country_code` captured now; net/gross convention is a later milestone.
- Diner-side cookieless consent — Phase 6. Phase 1's consent (D-21) is owner-facing only.

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: Owner hand-builds and publishes a simple menu; a diner scans a table QR and reads it fast with a last-good fallback.
- Phase 3: Photos, allergens, dietary tags, macros, priced variants, time-of-day scheduling.
- Phase 4: Templates + guardrailed brand controls (parallel with Phase 3).
- Phase 5: Author-once + one-button AI translation with owner-locked edits.
- Phase 6: Cookieless analytics dashboard.
- Phase 7: AI menu ingestion (photo + PDF) with the per-field allergen/macro confirmation gate.
