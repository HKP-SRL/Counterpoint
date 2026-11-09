# Phase 1: Multi-Tenant Foundation - Research

**Researched:** 2026-07-24
**Domain:** Multi-tenant auth, RLS-based tenant isolation, device-bound staff sessions (Next.js + Supabase + Vercel)
**Confidence:** MEDIUM-HIGH (Supabase Auth/RLS mechanics and Next.js Server Actions are HIGH-confidence official-docs territory; the device-session-as-staff-principal mechanism and dual-session-in-one-browser pattern are architecturally derived and flagged LOW/ASSUMED where not directly verified this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Owner Authentication**
- D-01: Owner sign-in is email + password, plus Google one-tap (Supabase Auth). A standard password-reset flow is included.
- D-02: No email-verification gate. New owners go straight from signup into venue setup; email verification is a soft nudge afterward, never a blocker to first value.
- D-03: Long-lived "stay signed in" sessions. Persistent refresh tokens so owners/staff rarely hit a login wall mid-service.

**Staff Identity & the Tablet**
- D-04: Staff are owner-provisioned per-person profiles (name + PIN), created from the owner dashboard. No emails, no individual auth logins for staff. Reversibility: one-way.
- D-05: Each staff profile is a distinct identifier stamped on the actions they take (attribution), not just "some staff member." Forward seam for future table-level attribution.
- D-06: A physical tablet becomes the venue's trusted staff device via "owner logs in, then enables staff mode": owner signs into the tablet once with their own credentials, switches it to staff mode; the device then holds a venue-scoped `staff`-role session and shows the PIN screen. The PIN is an app-level identity layered on top of that session — the DB sees a single `staff` principal for the device. Reversibility: costly.
  - Underlying mechanism (for researcher/planner to detail): the device session should be a per-venue staff-device auth identity whose `venue_members` row has role `staff`, so it plugs into `private.get_venue_role(venue_id, auth.uid())` with no special-casing. The "member" for staff is the device principal; PIN profiles are app-level records stamped on writes.
- D-07: Owner/manager can also authenticate on the shared tablet (own email+password) to unlock full-access editing on the same device; the staff PIN screen is the default surface.
- D-08: Lost/stolen/retired tablet → remote revoke. Owner sees enrolled devices on their dashboard and can revoke a device, instantly killing that tablet's staff session. Requires a lightweight device registry.

**Roles & Permissions**
- D-09: Two roles in v1: `owner` (full) and `staff` (availability toggle / "86" only). "Manager" intentionally dropped. Reversibility: costly.
- D-10: Use the extensible role enum + single `private.get_venue_role()` helper so adding `manager`/`waiter` later is one enum value + policy updates.
- D-11: Staff's one job is "86 on the fly." DB permission is `is_available`-only, enforced through a narrow `toggle_item_availability()` RPC so a row-level UPDATE grant can never smuggle a price/content change. Item tables arrive Phase 2 — Phase 1 proves the boundary via RLS tests against placeholder/venue-scoped tables.
- D-12: Identity splits by permission tier: full-access roles (owner) are real email+password accounts usable on any device; limited staff are PIN-only profiles on the shared tablet.

**Venue & Account Onboarding**
- D-13: Combined signup → first-venue onboarding in one continuous flow, landing in the venue dashboard.
- D-14: Capture country + timezone at venue creation now, in addition to name + currency (RON/HUF/EUR) + default language. Auto-derive from currency/locale, owner can override.
- D-15: Multi-venue: schema full, UI minimal. `accounts → venues` relationship models many venues per owner; v1 UI centers on one venue with a lightweight switcher if more than one exists.

**PIN Security**
- D-16: 4-digit PINs.
- D-17: Name-grid-then-PIN identification (POS-style, à la Toast/Square): tap name/avatar, then enter PIN. PINs need not be unique within a venue; attribution is never ambiguous because the person is chosen explicitly first.
- D-18: Timed/exponential backoff on repeated wrong PIN entries, not a hard lock requiring owner reset.
- D-19: PINs stored hashed at rest, never plaintext (non-negotiable). Reversibility: one-way.

**Staff Lifecycle**
- D-20: Deactivate (soft-delete), keep history. PIN stops working immediately; profile record persists so past attribution stays intact. No hard delete of people referenced by activity history.

**Consent / Legal**
- D-21: Explicit Terms + Privacy consent at owner signup — an "I agree" checkbox that stores which version was accepted and when.

**Tenant Isolation & RLS (mechanism locked by prior project research — carried forward, not re-litigated)**
- D-22: Tenant isolation via a `venue_members` table + a private-schema `SECURITY DEFINER` `get_venue_role()` helper; every RLS policy checks BOTH venue AND role in one expression. No inline joins in policies; wrap `auth.uid()` as `(select auth.uid())`. Reversibility: one-way.
- D-23: RLS enabled on every table in its creation migration — "no RLS policy yet" is treated as "not ready for data," never an acceptable intermediate state.
- D-24: Service-role key never appears in any client-reachable code path. All privileged server code re-derives the authenticated user context.
- D-25: **The RLS test suite is the phase's release gate.** Automated tests authenticate as each real role × venue combination *through the client SDK / anon key* (never the SQL editor, never service-role) and assert exactly what each principal can and cannot read/write — including that a staff/device session at Venue A cannot touch Venue B, and that staff cannot change anything but availability. Must exist and pass before any Phase 2 feature writes data.

### Claude's Discretion
- Exact Supabase Auth configuration details (token TTLs, provider setup, redirect URLs), migration file organization, and the specific test framework/harness for the RLS suite are left to research/planning.
- Precise backoff curve for D-18 and device-registry schema shape for D-08 are implementation details.

### Deferred Ideas (OUT OF SCOPE)
- Table-level staff attribution — the per-staff PIN identity built in Phase 1 is the seam it attaches to later; not built now.
- "Manager" role — dropped for v1, re-introduced later as one enum value + policy updates.
- Full multi-venue management UI — schema supports many venues now; rich UI deferred.
- Subscription billing / tier enforcement — `accounts.plan_tier` reserved but unused/unenforced.
- Fiscal / tax convention (net vs gross pricing, RO ANAF / HU NAV) — `venues.country_code` captured now; tax convention is an explicit open gap for the payments/fiscal milestone.
- Diner-side cookieless consent — separate concern, Phase 6.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ACCT-01 | Owner can sign up and log in without manual help | Supabase Auth email+password + Google One Tap patterns below; D-02 no-verification-gate confirmed compatible with Supabase's optional email-confirmation setting |
| ACCT-02 | Owner can create a venue and set name, currency (RON/HUF/EUR), enabled languages | Venue schema in Data Model section; D-14 adds country_code + timezone at creation |
| ACCT-03 | One owner account can own multiple venues (schema full, UI minimal) | `accounts` → `venues` → `venue_members` model; owner's own access flows through the same `venue_members` row as any invited staff, per Architecture Pattern 1 |
| ACCT-04 | Owner/manager can invite staff members to a venue | D-04-driven: "invite" in v1 means owner provisions a name+PIN profile directly (no email invite flow — there is no staff email/login) |
| ACCT-05 | Staff members can sign in and access only venues they belong to | D-06 device-session mechanism (Pattern: Provisioned Device Identity, below) + RLS scoping via `venue_members` |
| ACCT-06 | Staff (limited role) can toggle availability but not edit prices/content/settings | `toggle_item_availability()`-shaped RPC pattern (D-11); no blanket UPDATE grant for staff |
| ACCT-07 | Owner/manager (full role) can edit all menu content, theming, venue settings | Direct table-level RLS `for all using (get_venue_role(...) = 'owner')` |
| ACCT-08 | User cannot read/modify data belonging to a venue they are not a member of | Pattern 1 (SECURITY DEFINER helper) + RLS Test Suite Architecture section (D-25 release gate) |
</phase_requirements>

## Summary

Phase 1 is a horizontal foundation phase with one unusual technical challenge layered on top of an otherwise standard Supabase multi-tenant pattern: **the "staff" principal the database sees is not a person, it's a physical tablet.** Standard Supabase Auth + RLS handles owner accounts, multi-venue ownership, and the venue+role dual-check policy pattern with well-documented, HIGH-confidence primitives. The genuinely novel design work is making a shared tablet hold a stable, revocable, venue-scoped `staff` session that a PIN screen sits on top of — this needs to be a real `auth.users` row with a `venue_members` row (role=`staff`), not a special-cased identity, so it plugs into the same `get_venue_role()` helper as everyone else.

Two Supabase-native primitives can serve as the device principal: **anonymous sign-in** (`signInAnonymously()`) or a **server-provisioned dedicated device account** (`admin.createUser()` with a generated email+password never exposed to the client). This research recommends the **provisioned device account** as primary: it gives full control over revocation semantics (delete the account or its `venue_members` row, both instant), avoids anonymous auth's Monthly-Active-User billing ambiguity, and lets you attach device metadata (label, enrolled-by, last-seen) directly. Anonymous sign-in is documented as a viable fallback if the provisioning flow proves more complex to build than expected.

The RLS test suite (D-25) is the phase's hard release gate and has an official two-layer testing story in Supabase's own docs: pgTAP for fast, transaction-isolated DB-level policy tests, and client-SDK integration tests (signing in real seeded users via `@supabase/supabase-js`) for the "exactly what the CONTEXT.md decision demands" layer — through the client SDK / anon key, never the SQL editor or service-role. Build the client-SDK suite as the actual release gate; pgTAP is optional defense-in-depth, not a substitute, because CONTEXT.md is explicit that SQL-editor-adjacent testing is exactly the false-confidence failure mode being guarded against.

**Primary recommendation:** Scaffold Next.js (App Router) + `@supabase/ssr` for cookie-based auth, model tenancy as `accounts → venues → venue_members` with a `private.get_venue_role()` SECURITY DEFINER helper, implement the tablet's staff session as a server-provisioned dedicated device auth account whose `venue_members` row carries role `staff`, gate every staff write behind a narrow RPC (never a blanket table UPDATE grant), hash PINs with Postgres's native `pgcrypto` (`crypt()`/`gen_salt('bf')` — no extra npm dependency), and build the RLS release-gate suite in Vitest against a local `supabase start` (Docker) instance, signing in as real seeded users per role × venue combination.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Owner signup/login (email+password, Google One Tap) | API / Backend (Supabase Auth) | Frontend Server (Next.js Server Actions/cookies) | Supabase Auth issues and manages the session; Next.js Server Actions/middleware only relay cookies via `@supabase/ssr` — no custom session logic in the app layer |
| Password reset flow | API / Backend (Supabase Auth) | — | `resetPasswordForEmail` + `updateUser` are Auth-server operations |
| Venue/account creation | API / Backend (Postgres + RLS) | Frontend Server (Server Action calling Supabase) | Data lives in Postgres; the Server Action is a thin authenticated mutation, not business logic |
| Staff PIN profile CRUD | API / Backend (Postgres, SECURITY DEFINER RPCs) | Frontend Server | PIN hashing (`pgcrypto`) and verification must happen server-side/in-DB, never in client JS |
| Staff PIN entry UI (name-grid → PIN pad) | Browser / Client | Frontend Server (verification RPC) | Fast tap-driven interaction is client-rendered; the actual PIN check is a server-side RPC call, never a client-side comparison |
| Tablet "staff mode" device session | API / Backend (Supabase Auth, provisioned device account) | Frontend Server (session cookie swap) | The device's trust is a real Auth session; enabling it is a privileged server-side operation (admin API), never done client-side |
| Device revoke | API / Backend (Supabase Admin API + `venue_members` delete) | Frontend Server (owner dashboard action) | Revocation must be authoritative at the DB/Auth-server level; a UI-only "remove device" would not actually kill an active session |
| Tenant isolation (RLS) | Database / Storage | API / Backend (RPC boundary for staff writes) | RLS is a Postgres-level guarantee; it is the actual security boundary per D-22, not something the app layer can weaken or strengthen |
| RLS test suite | Database / Storage (what's tested) | API / Backend (how it's tested — client SDK) | The suite must exercise the same client-SDK/anon-key path a real request takes, per D-25 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.2.11 [VERIFIED: npm registry] | App framework, App Router, Server Actions | Locked project stack (CLAUDE.md); Server Actions are the natural home for auth/venue/staff mutations |
| `react` / `react-dom` | 19.2.8 [VERIFIED: npm registry] | UI runtime | Next.js 16 peer dependency |
| `@supabase/supabase-js` | 2.110.8 [VERIFIED: npm registry] | Supabase client (used server-side for admin ops, and as the underlying client wrapped by `@supabase/ssr`) | Official SDK; required for `auth.admin.*` calls in device provisioning/revoke |
| `@supabase/ssr` | 0.12.3 [VERIFIED: npm registry] | Cookie-based Supabase client for Next.js SSR/Server Actions/middleware | Purpose-built replacement for the deprecated `auth-helpers-nextjs` package; `createServerClient`/`createBrowserClient` are the current (2026) recommended pattern [CITED: supabase.com/docs/guides/auth via Context7 `/supabase/ssr`] |
| `zod` | 4.4.3 [VERIFIED: npm registry] | Server Action input validation (signup form, venue creation form, staff profile form) | Locked project stack (CLAUDE.md); shared validation between forms and server-side checks |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | 4.1.10 [VERIFIED: npm registry] | RLS release-gate test suite runner (D-25) + general unit tests | Fast, native ESM/TS support, `vitest.config.ts` `sequence: {concurrent: false}` needed for the RLS suite specifically (see Pitfalls) |
| `typescript` | 7.0.2 [VERIFIED: npm registry] | Type safety across Server Actions, Supabase generated types | `supabase gen types typescript` produces types consumed here |
| Supabase CLI (`supabase`) | latest (install via `npx supabase` or `brew install supabase/tap/supabase`) [ASSUMED — not independently version-pinned this session] | Local dev stack (`supabase start`, Docker-backed), migrations (`supabase db diff`), type generation | Required for the entire phase — this is where the RLS test suite runs against a real local Postgres+GoTrue instance, not a mock |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Provisioned device account for tablet staff session | Supabase anonymous sign-in (`signInAnonymously()`) | Simpler (one call, no admin API), but counts toward MAU billing [CITED: supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users via Context7], gives less control over device metadata/labeling, and every RLS policy touching `authenticated` role must additionally check `is_anonymous` to avoid accidentally granting anon users broader-than-staff access on tables not yet role-scoped |
| Postgres `pgcrypto` (`crypt()`/`gen_salt('bf')`) for PIN hashing | Node `bcryptjs`/`bcrypt` npm package, hash client-side-adjacent in a Server Action | `pgcrypto` avoids a dependency and keeps the PIN's plaintext value inside a single SECURITY DEFINER RPC call that never round-trips as plaintext into app code/logs; a Node library is fine too, but then plaintext PIN must transit the Server Action layer — pgcrypto's `crypt(input, stored_hash) = stored_hash` verification pattern lets you push the entire check into one RPC |
| Vitest + client-SDK integration suite as the RLS release gate | pgTAP as the release gate | pgTAP is faster and CI-friendly, but per D-25 the release gate must go through the client SDK/anon key specifically — use pgTAP only as a supplementary fast pre-check, not the gate itself |
| `@supabase/ssr` cookie pattern | Manually managing `localStorage`-persisted sessions client-side only (no SSR cookies) | Breaks server-side `getUser()` checks in Server Actions/middleware, which is how route-level auth guards and RLS-respecting server reads work in this architecture |

**Installation:**
```bash
npx create-next-app@latest . --typescript --app --tailwind --eslint
npm install @supabase/supabase-js @supabase/ssr zod
npm install -D vitest typescript
npx supabase init
```

**Version verification:** All npm versions above verified via `npm view <package> version` against the live registry on 2026-07-24. Supabase CLI is intentionally not npm-pinned here — install via the officially documented method (`npx supabase <command>` or a package manager, never `npm install -g supabase`, which Supabase's own docs disallow) and verify with `supabase --version` at scaffold time.

## Package Legitimacy Audit

| Package | Registry | Age (latest release) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----------------------|-----------|--------------|---------|-------------|
| `next` | npm | published 2026-07-21 | ~49.9M/wk | github.com/vercel/next.js | SUS (`too-new`) | Approved — false-positive heuristic. Vercel's own framework, ~50M weekly downloads, frequent release cadence is normal for this project |
| `react` | npm | published 2026-07-21 | ~161.3M/wk | github.com/react/react (facebook/react) | SUS (`too-new`) | Approved — false-positive heuristic. Core React runtime |
| `react-dom` | npm | published 2026-07-21 | ~152.3M/wk | github.com/react/react | SUS (`too-new`) | Approved — false-positive heuristic. Ships in lockstep with `react` |
| `@supabase/supabase-js` | npm | published 2026-07-21 | ~21.8M/wk | github.com/supabase/supabase-js | SUS (`too-new`) | Approved — false-positive heuristic. Official Supabase SDK |
| `@supabase/ssr` | npm | published 2026-07-14 | ~5.9M/wk | github.com/supabase/ssr | SUS (`too-new`) | Approved — false-positive heuristic. Official Supabase SSR helper package |
| `zod` | npm | published 2026-05-04 | ~237.4M/wk | github.com/colinhacks/zod | OK | Approved |
| `vitest` | npm | published 2026-07-06 | ~81.1M/wk | github.com/vitest-dev/vitest | SUS (`too-new`) | Approved — false-positive heuristic. Standard test runner |
| `typescript` | npm | published 2026-07-08 | ~242.3M/wk | github.com/microsoft/TypeScript | SUS (`too-new`) | Approved — false-positive heuristic. Microsoft's own compiler |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `next`, `react`, `react-dom`, `@supabase/supabase-js`, `@supabase/ssr`, `vitest`, `typescript` — all flagged solely on the `too-new` heuristic (their most recent published version is within the legitimacy checker's freshness window), which is a systematic false positive for mainstream, high-velocity-release ecosystem-standard packages. Every flagged package has an official GitHub source repo and weekly download counts in the millions-to-hundreds-of-millions range, which is strong independent evidence against slopsquatting. **Per protocol, the planner should still add a lightweight `checkpoint:human-verify` before first install** (a single glance at the download counts above is sufficient to clear it) rather than skip the gate outright.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────── VERCEL (Next.js, App Router) ───────────────────────────────┐
│                                                                                                │
│  Browser (owner laptop/phone)              Browser (shared tablet)                            │
│      │ email+pw / Google One Tap               │ PIN screen (default) │ owner-unlock (D-07)   │
│      ▼                                          ▼                                              │
│  ┌─────────────────────┐                ┌──────────────────────────────────────────┐         │
│  │ (auth) routes        │                │ (tablet) routes                          │         │
│  │ - /signup            │                │ - / (PIN pad, name grid)                 │         │
│  │ - /login              │               │ - /enable-staff-mode (owner-only action) │         │
│  │ - /reset-password     │               │ - staff writes → toggle RPC only         │         │
│  └──────────┬────────────┘                └──────────┬────────────────────────────┘         │
│             │ Server Actions (@supabase/ssr cookies)  │ Server Actions                         │
├─────────────┴─────────────────────────────────────────┴───────────────────────────────────────┤
│                          middleware.ts — supabase.auth.getUser() on every request               │
│                          (revalidates JWT + refreshes cookies before any route runs)             │
└───────────────────────────────────────────────────────┬────────────────────────────────────────┘
                                                          │
                                                          ▼
┌────────────────────────────────────── SUPABASE (single Postgres project) ─────────────────────┐
│  Auth (auth.users)                     Postgres + RLS                    Admin API (secret key,│
│  - owner accounts (real email+pw)      - accounts, venues,                server-only)          │
│  - device accounts (provisioned,         venue_members,                  - admin.createUser()   │
│    "device+<uuid>@venues.internal")      staff_profiles                    (device provisioning)│
│                                         - private.get_venue_role()        - admin.signOut()      │
│                                           SECURITY DEFINER helper           (device revoke)      │
│                                         - toggle_item_availability()                             │
│                                           and equivalent narrow RPCs                              │
│                                         - pgcrypto: crypt()/gen_salt('bf')                        │
│                                           for PIN hash + verify                                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Data flow for the two identity types that matter this phase:
1. **Owner path:** signup/login → Supabase Auth issues a session → `@supabase/ssr` persists it in cookies → every Server Action/middleware call re-derives `auth.uid()` → RLS checks `private.get_venue_role(venue_id, auth.uid()) = 'owner'`.
2. **Device path:** owner authenticates on tablet (owner session, temporarily) → "Enable staff mode" Server Action runs server-side with the secret key → creates a dedicated device auth user, inserts its `venue_members` row (role=`staff`), signs the *browser* into that device account via `signInWithPassword` (replacing the owner's cookies with the device's) → tablet now holds a persistent `staff` session → PIN screen sits entirely in front of that session (PIN is verified via RPC, never changes what the DB sees as the authenticated principal).

### Recommended Project Structure

```
app/
├── (auth)/
│   ├── signup/page.tsx            # combined signup → venue onboarding (D-13)
│   ├── login/page.tsx
│   └── reset-password/page.tsx
├── (dashboard)/
│   └── venues/[venueId]/
│       ├── page.tsx                # venue home / switcher if >1 venue (D-15)
│       ├── staff/
│       │   ├── page.tsx            # staff list + provision new PIN profile
│       │   └── devices/page.tsx    # device registry, revoke action (D-08)
│       └── settings/page.tsx       # name, currency, language, country, timezone
├── (tablet)/
│   ├── page.tsx                    # name-grid → PIN pad (default staff-mode surface)
│   ├── enable-staff-mode/page.tsx  # requires owner session; provisions/attaches device
│   └── unlock/page.tsx             # D-07 owner-unlock on shared tablet
├── actions/
│   ├── auth.ts                     # signUp, signInWithPassword, resetPassword, signInWithIdToken
│   ├── venues.ts                   # createVenue, updateVenueSettings
│   ├── staff.ts                    # provisionStaffProfile, deactivateStaffProfile, verifyPin
│   └── devices.ts                  # enableStaffMode, revokeDevice
├── middleware.ts                   # auth.getUser() cookie refresh on every request
lib/
├── supabase/
│   ├── server.ts                   # createServerClient (Server Actions/RSC, cookies)
│   ├── client.ts                   # createBrowserClient (client components)
│   └── admin.ts                    # createClient with secret key — server-only, imported nowhere client-reachable
supabase/
├── migrations/                     # accounts, venues, venue_members, staff_profiles, venue_devices, RLS
└── seed.sql                        # test users/venues for local dev + RLS test fixtures
tests/
└── rls/
    ├── setup.ts                    # service-role fixture helper (create test venues/users, teardown)
    └── venue-isolation.test.ts     # the D-25 release-gate suite
```

### Structure Rationale

- **`(tablet)` is its own route group**, separate from `(dashboard)`, because it has a fundamentally different default-authenticated-principal (device/staff) than the owner-facing dashboard — mixing them risks a layout or layout-level auth check accidentally granting dashboard access to a staff-session tablet.
- **`lib/supabase/admin.ts` is the only file allowed to import the secret key**, and only Server Actions in `actions/devices.ts` (device provisioning/revoke) and a future ingestion worker should ever import it — this directly operationalizes D-24.
- **`tests/rls/` is separate from any future `tests/unit/`** because the RLS suite has different constraints (sequential execution, real local Supabase instance, service-role fixtures) that would otherwise leak into unrelated unit test config.

## Architectural Patterns

### Pattern 1: Tenant isolation via `venue_members` + SECURITY DEFINER role lookup

**What:** Every tenant-scoped table carries `venue_id`. A `private`-schema, `SECURITY DEFINER` function looks up the caller's role for a given venue without re-triggering RLS on the membership table itself. Policies call the helper, never join `venue_members` inline. `EXECUTE` on the helper is revoked from `anon`/`authenticated` so it can't be called directly via RPC — only usable inside a policy.
**When to use:** every RLS policy in this system, starting with `venues`, `venue_members`, `staff_profiles`, `venue_devices`, and any placeholder table the RLS test suite exercises.
**Trade-offs:** one extra function per role-check, but avoids recursion bugs and centralizes role logic in one place.

**Example:**
```sql
-- Source: Context7 /websites/supabase, supabase.com/docs/guides/local-development/testing/pgtap-extended
create schema if not exists private;

create type venue_role as enum ('owner', 'staff'); -- extensible (D-10): add 'manager' later as one enum value

create or replace function private.get_venue_role(v_id uuid, u_id uuid)
returns venue_role
security definer
set search_path = ''
stable
as $$
  select role from public.venue_members
  where venue_id = v_id and user_id = u_id;
$$ language sql;

revoke execute on function private.get_venue_role(uuid, uuid) from anon, authenticated;

create policy "owner full access on venues"
  on public.venues for all
  using (private.get_venue_role(id, (select auth.uid())) = 'owner');

create policy "members can read their venues"
  on public.venue_members for select
  using (private.get_venue_role(venue_id, (select auth.uid())) is not null);
```

### Pattern 2: Provisioned device identity for the shared tablet (staff session)

**What:** When the owner taps "Enable staff mode," a server-only Server Action (using the Supabase **secret key**, never client-exposed per D-24) creates a dedicated `auth.users` row for that physical device via `supabase.auth.admin.createUser({ email: 'device+<uuid>@venues.internal', password: <server-generated random>, email_confirm: true })`, inserts a `venue_members` row for that new user with `role = 'staff'`, records it in a `venue_devices` registry (`venue_id`, `device_user_id`, `label`, `enrolled_by`, `enrolled_at`), then signs the requesting browser into that device account (`signInWithPassword` using the same generated credentials, immediately after creation) so the tablet's cookies now hold a genuine `staff`-role session. The PIN screen the diner-facing/staff-facing UI shows afterward is a pure app-level gate (name-grid → PIN → RPC verification) layered on top of an already-authenticated `staff` principal — it does not change what the database sees.
**When to use:** the D-06/D-08 device-session + remote-revoke requirement.
**Trade-offs:** requires the secret key inside one Server Action (tightly scoped, server-only) vs. the simpler `signInAnonymously()` primitive; in exchange you get full control over revocation (delete the `venue_members` row and/or the `auth.users` row directly, both instant) and clean device metadata without `is_anonymous` special-casing spreading into every future policy.
**Confidence: MEDIUM** — the `admin.createUser`/`admin.signOut` primitives themselves are [CITED: supabase.com/docs/reference/dart/auth-currentuser, migrating-to-new-api-keys via Context7 `/websites/supabase`]; the specific "create device account then immediately `signInWithPassword` in the same Server Action to swap browser cookies" composition is [ASSUMED] — verify this exact sequence (particularly whether a Server Action can both call `admin.createUser` with the secret-key client and `signInWithPassword` with the anon-key client and have the resulting Set-Cookie headers propagate correctly in one response) with a spike before locking the plan.

**Example:**
```typescript
// actions/devices.ts — Source: composed from Context7 /websites/supabase admin-client and
// signInWithPassword references; sequencing is ASSUMED, verify with a spike (see Open Questions)
'use server'
import { createAdminClient } from '@/lib/supabase/admin'   // secret key — server-only
import { createServerClient } from '@/lib/supabase/server' // anon key + cookies

export async function enableStaffMode(venueId: string, deviceLabel: string) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  // ...verify `user` is owner of venueId via get_venue_role before proceeding...

  const admin = createAdminClient()
  const deviceId = crypto.randomUUID()
  const email = `device+${deviceId}@venues.internal`
  const password = crypto.randomUUID() // never shown to any human; device auth only

  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { is_device: true, label: deviceLabel },
  })
  if (error) throw error

  await admin.from('venue_members').insert({
    venue_id: venueId, user_id: created.user.id, role: 'staff',
  })
  await admin.from('venue_devices').insert({
    venue_id: venueId, device_user_id: created.user.id, label: deviceLabel,
  })

  // Swap this browser's session to the device account
  await supabase.auth.signInWithPassword({ email, password })
}
```

### Pattern 3: Narrow RPC as the only staff write path

**What:** Staff never receives a blanket `UPDATE` grant on any content table. The only write surface for the `staff` role is a `SECURITY DEFINER` function shaped like `toggle_item_availability(item_id uuid, is_available boolean)` that touches exactly one column and re-checks venue membership internally. This is the pattern Phase 1's RLS tests must prove against a placeholder table (since real `items` don't exist until Phase 2).
**When to use:** any future narrowly-scoped staff/limited-role mutation.
**Trade-offs:** more RPCs to write than a generic `UPDATE ... WHERE column IN (...)` grant, but a raw `UPDATE` grant is not column-restrictable in Postgres RLS — RLS is row-level, not column-level (Anti-Pattern below).

**Example:**
```sql
-- Source: Context7 /websites/supabase troubleshooting/rls-performance-and-best-practices,
-- adapted to Phase 1's placeholder table per D-11
create table public.rls_test_items ( -- placeholder table proving the boundary before Phase 2's real items
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id),
  price numeric not null default 0,
  is_available boolean not null default true
);
alter table public.rls_test_items enable row level security;

create policy "owner full access" on public.rls_test_items for all
  using (private.get_venue_role(venue_id, (select auth.uid())) = 'owner');

create policy "staff read only" on public.rls_test_items for select
  using (private.get_venue_role(venue_id, (select auth.uid())) is not null);
-- deliberately NO staff UPDATE policy — the RPC below is the only staff write path

create or replace function public.toggle_item_availability(p_item_id uuid, p_is_available boolean)
returns void
security definer
set search_path = ''
as $$
  update public.rls_test_items
  set is_available = p_is_available
  where id = p_item_id
    and private.get_venue_role(venue_id, (select auth.uid())) is not null;
$$ language sql;
```

### Pattern 4: PIN hashing and verification entirely inside Postgres

**What:** `pgcrypto`'s `crypt(pin, gen_salt('bf', 12))` on provision, `crypt(pin_attempt, stored_hash) = stored_hash` on verify — both inside `SECURITY DEFINER` RPCs, so a plaintext PIN only ever exists transiently inside one database function call, never logged or persisted anywhere in app code.
**When to use:** `provisionStaffProfile` and `verifyPin` RPCs.
**Trade-offs:** ties PIN hashing to a Postgres extension rather than an npm package — acceptable since `pgcrypto` is a standard, pre-installed Supabase extension (`create extension if not exists pgcrypto;`).

**Example:**
```sql
-- Source: pattern derived from web research (pgcrypto documentation, PostgreSQL 18 docs) — [CITED: postgresql.org/docs/current/pgcrypto.html]
create extension if not exists pgcrypto;

create or replace function public.provision_staff_pin(p_venue_id uuid, p_name text, p_pin text)
returns uuid
security definer
set search_path = ''
as $$
  insert into public.staff_profiles (venue_id, name, pin_hash, created_by)
  values (
    p_venue_id, p_name, crypt(p_pin, gen_salt('bf', 12)),
    (select auth.uid())
  )
  returning id;
$$ language sql;
-- caller (Server Action) must first verify (select auth.uid()) resolves to venue role = 'owner'
-- via the same get_venue_role() check, before invoking this RPC

create or replace function public.verify_staff_pin(p_venue_id uuid, p_staff_id uuid, p_pin text)
returns boolean
security definer
set search_path = ''
as $$
  select pin_hash = crypt(p_pin, pin_hash)
  from public.staff_profiles
  where id = p_staff_id and venue_id = p_venue_id and deactivated_at is null;
$$ language sql;
```

### Anti-Patterns to Avoid

- **Inline joins/subqueries inside RLS policies** (`using (venue_id in (select venue_id from venue_members where user_id = auth.uid()))` written directly): re-evaluated per row, the most common "RLS is slow" cause at moderate scale. Always route through the `SECURITY DEFINER` helper.
- **Column-level "staff can only edit availability" enforced only via RLS row policy + app-layer UI hiding:** RLS is row-level, not column-level. A blanket `UPDATE` grant plus a hidden UI button is bypassable via a direct PostgREST call. Use Pattern 3's narrow RPC instead.
- **Testing RLS exclusively via the Supabase SQL editor or as the service role:** both bypass RLS/give elevated access, producing false confidence that a policy works when it was never actually exercised as the real principal would exercise it. D-25 explicitly forbids this for the release gate.
- **Treating anonymous auth's `is_anonymous` flag as equivalent to a scoped `staff` role:** anonymous users get the full `authenticated` Postgres role; if the device-session pattern ever uses anonymous auth, every table's RLS must explicitly check `is_anonymous` or risk an anon session getting broader access than intended on any table whose policy only checks "is a member," not "is exactly this role."
- **Using `getSession()` for server-side auth checks:** in `@supabase/ssr` server contexts, `getSession()` reads the JWT from cookies without revalidating it against the Auth server; use `getUser()` (or the newer `getClaims()`) wherever a Server Action or middleware needs a trustworthy identity, per the middleware pattern in Standard Stack.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Password hashing/session tokens | Custom JWT issuance, custom password hashing | Supabase Auth (`signUp`/`signInWithPassword`, GoTrue-issued JWTs) | Battle-tested, handles rotation/revocation/rate-limiting already |
| PIN hashing | Custom PIN hash function in TS | Postgres `pgcrypto` `crypt()`/`gen_salt('bf')` | Standard, audited crypto primitive; keeps plaintext PIN inside one DB call |
| Role/permission engine | A generic string-permission RBAC table (`"menu:write"`, `"price:edit"`, ...) | Postgres enum (`venue_role`) + single `SECURITY DEFINER` helper | Two roles + one column carve-out is fully known today (per CLAUDE.md "What NOT to Use"); a general RBAC engine is speculative complexity |
| Session revocation | Custom refresh-token blocklist table | `supabase.auth.admin.signOut(userId, 'global')` + deleting the `venue_members` row (RLS re-derives access live, every query) | Both are native and give instant, layered revocation without inventing token-invalidation logic |
| Rate limiting PIN attempts | Custom in-memory or Redis rate limiter | A `failed_attempts`/`locked_until` column on `staff_profiles`, checked/incremented inside `verify_staff_pin()` itself | No new infra; the exponential backoff (D-18) is just a timestamp comparison inside the existing SECURITY DEFINER RPC |

**Key insight:** every piece of this phase that touches "who is allowed to do what" should resolve to exactly one place — `private.get_venue_role()` for read/broad-write access, and narrow RPCs for anything staff-scoped. Resist any temptation to add a second permission check anywhere else (middleware, UI conditionals treated as security, a separate permissions table) — CLAUDE.md and D-22 are explicit that RLS is the actual boundary, and every additional parallel check is a place the two can silently drift apart.

## Runtime State Inventory

Not applicable — Phase 1 is greenfield. No `package.json`, no application code, no existing Supabase project, no prior runtime state exists to inventory (confirmed via `ls package.json` — absent). This section is included only to state explicitly that the "no rename/refactor" skip condition applies.

## Common Pitfalls

### Pitfall 1: RLS gaps ship quietly because a new table's policy is forgotten or too broad
**What goes wrong:** A newly created table (even a Phase-1 placeholder) is queryable/writable to any authenticated user the moment it exists, unless RLS is enabled and correctly scoped in the same migration.
**Why it happens:** RLS bugs don't fail loudly in development — testing with an owner account never surfaces a missing/broad policy because owner access legitimately covers the buggy case.
**How to avoid:** D-23 already mandates RLS-in-creation-migration; enforce it as a literal migration-review checklist item, and make the RLS test suite (D-25) run in CI against every migration, not just once at the end of the phase.
**Warning signs:** any table created without RLS enabled in the same migration file; any policy using `using (true)`.

### Pitfall 2: Staff device session accidentally gets owner-level access via a missing role check
**What goes wrong:** A table's policy checks `get_venue_role(...) is not null` (any member) when it should check `= 'owner'` specifically — a staff device at Venue A silently gains full edit rights.
**Why it happens:** "any member can access" is an easy default to reach for when a table doesn't obviously need role differentiation yet, and it's easy to forget it does once staff-scoped tables (menu items, prices) arrive in Phase 2.
**How to avoid:** every table-creation migration should default to the *narrowest* policy (`= 'owner'`) and only broaden to "any member" with an explicit reason; the RLS test suite should include an explicit negative assertion for every table ("staff cannot X") not just positive assertions for what owner can do.
**Warning signs:** a policy with `is not null` where the table holds mutable content, not read-only reference data.

### Pitfall 3: Device provisioning happens client-side or the secret key leaks into a client-reachable path
**What goes wrong:** The "enable staff mode" flow is tempting to build as a single client-side call sequence for simplicity, which would require exposing the secret key to the browser — a full RLS bypass for anyone who inspects network traffic.
**Why it happens:** `admin.createUser` genuinely needs the secret key, and the whole device-provisioning flow is unusual enough that it's easy to reach for "just do it in a `use client` component for speed."
**How to avoid:** Pattern 2 above is a Server Action by construction — audit that `lib/supabase/admin.ts` is never imported by any file under a `'use client'` boundary; consider a lint rule or file-location convention (e.g., only `actions/devices.ts` may import it) as a structural guard.
**Warning signs:** any `NEXT_PUBLIC_`-prefixed env var holding the secret key; any client component importing from `lib/supabase/admin`.

### Pitfall 4: Testing RLS with the service-role client or SQL editor produces false confidence
**What goes wrong:** A developer verifies "staff can't edit prices" by running the query as themselves (an owner) or via the SQL editor/service role, both of which bypass the exact policy being tested, and ships a broken policy that passes manual review.
**Why it happens:** it's the fastest way to sanity-check a policy during development.
**How to avoid:** D-25's release gate is exactly this guard — build the Vitest client-SDK suite early (Wave 0, not end-of-phase), signing in as real seeded owner/staff/device test users per venue, and treat any manual SQL-editor check as a debugging aid only, never a verification step.
**Warning signs:** a PLAN.md verification step that says "checked in SQL editor" instead of "asserted via client SDK test."

### Pitfall 5: Long-lived sessions (D-03) combined with weak revocation makes device theft a real risk
**What goes wrong:** Persistent refresh tokens (by design, for "rarely hit a login wall") mean a stolen/lost tablet's session could remain valid indefinitely if revocation isn't actually instant.
**Why it happens:** JWT-based auth is stateless by default — a stolen access token remains valid until it expires (up to the configured TTL) even if you delete the underlying record, unless the app re-derives access from the database on every request (which RLS does).
**How to avoid:** rely on the fact that RLS re-checks `venue_members` on *every query*, not just at login — so deleting/deactivating the device's `venue_members` row is sufficient for instant data-access revocation regardless of JWT expiry, and additionally call `admin.signOut(deviceUserId, 'global')` to kill the session token itself as defense-in-depth. Document this explicitly in the device revoke RPC/Server Action so future maintainers don't assume JWT expiry alone handles revocation.
**Warning signs:** a revoke button that only "hides" the device from the UI without touching `venue_members` or calling `admin.signOut`.

## Code Examples

### Supabase server client for Next.js Server Actions / Route Handlers (App Router)
```typescript
// Source: Context7 /supabase/ssr, api-reference-createServerClient.md
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}
```

### Middleware — must call `getUser()`, not `getSession()`, to revalidate
```typescript
// Source: Context7 /supabase/ssr, patterns-best-practices.md
// middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  // getUser() revalidates the JWT against the Auth server — required for a trustworthy check
  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

### Google One Tap sign-in
```typescript
// Source: Context7 /websites/supabase, guides/auth/social-login/auth-google
'use client'
import type { accounts, CredentialResponse } from 'google-one-tap'
import Script from 'next/script'
import { createClient } from '@/lib/supabase/client'

declare const google: { accounts: accounts }

const generateNonce = async (): Promise<string[]> => {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(nonce))
  const hashedNonce = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  return [nonce, hashedNonce]
}

export default function GoogleOneTap() {
  const supabase = createClient()
  const init = async () => {
    const [nonce, hashedNonce] = await generateNonce()
    google.accounts.id.initialize({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      callback: async (response: CredentialResponse) => {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'google', token: response.credential, nonce,
        })
        if (error) throw error
      },
      nonce: hashedNonce,
      use_fedcm_for_prompt: true, // required post third-party-cookie removal
    })
    google.accounts.id.prompt()
  }
  return <Script onReady={init} src="https://accounts.google.com/gsi/client" />
}
```

### RLS test suite skeleton (D-25 release gate)
```typescript
// Source: composed from Supabase testing/overview + web research on client-SDK RLS testing patterns
// [ASSUMED composition — verify sequencing/isolation choices against a running local instance]
// tests/rls/venue-isolation.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL!
const anonKey = process.env.SUPABASE_ANON_KEY!
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

describe('venue isolation', () => {
  let venueA: string, venueB: string
  let ownerAEmail: string, staffADeviceEmail: string

  beforeAll(async () => {
    // service-role fixture setup: create two venues, an owner for A, a device account for A's staff
    // (unique per-test-run IDs to avoid cross-test collisions — tests can't rely on a clean DB)
  })

  it('staff device at venue A cannot read venue B data', async () => {
    const client = createClient(url, anonKey)
    await client.auth.signInWithPassword({ email: staffADeviceEmail, password: '...' })
    const { data, error } = await client.from('rls_test_items').select('*').eq('venue_id', venueB)
    expect(data).toHaveLength(0) // RLS silently filters, doesn't error — assert empty, not error
  })

  it('staff cannot update price via direct table UPDATE', async () => {
    const client = createClient(url, anonKey)
    await client.auth.signInWithPassword({ email: staffADeviceEmail, password: '...' })
    const { error } = await client.from('rls_test_items').update({ price: 999 }).eq('venue_id', venueA)
    expect(error).toBeTruthy() // no UPDATE policy exists for staff — must fail
  })

  it('staff CAN toggle availability via the RPC', async () => {
    const client = createClient(url, anonKey)
    await client.auth.signInWithPassword({ email: staffADeviceEmail, password: '...' })
    const { error } = await client.rpc('toggle_item_availability', { p_item_id: '...', p_is_available: false })
    expect(error).toBeNull()
  })
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| `@supabase/auth-helpers-nextjs` | `@supabase/ssr` | auth-helpers deprecated in favor of `@supabase/ssr` | Use `createServerClient`/`createBrowserClient` from `@supabase/ssr`; do not follow older tutorials referencing `auth-helpers-nextjs` |
| `service_role` key naming | `secret` key (`sb_secret_...`) / `anon` key → `publishable` key | Supabase's 2026 API key migration [CITED: supabase.com/docs/guides/getting-started/migrating-to-new-api-keys via Context7] | New projects may show `sb_publishable_...`/`sb_secret_...` naming in the dashboard; functionally equivalent to anon/service_role — D-24's "service-role key never client-reachable" applies identically to the renamed "secret" key |
| Checking `getSession()` server-side | Checking `getUser()` (or `getClaims()`) server-side | Ongoing Supabase Auth guidance | `getSession()` trusts the cookie without revalidation; `getUser()` round-trips to Auth server and is the only trustworthy server-side check |

**Deprecated/outdated:** `@supabase/auth-helpers-nextjs` — superseded by `@supabase/ssr`; any tutorial or Stack Overflow answer referencing it predates the current pattern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | Device provisioning ("create device account, then immediately `signInWithPassword` in the same Server Action to swap the browser's cookies") works as one atomic-feeling flow with correct cookie propagation in a single Next.js response | Pattern 2 | If cookie swap doesn't propagate cleanly in one round-trip, "enable staff mode" may need a redirect/second-request step instead of being instant — a UX/planning detail, not a security issue, but affects task sequencing in the plan |
| A2 | Provisioned device accounts (real `auth.users` rows created via `admin.createUser`) do NOT count toward Supabase Monthly Active Users the same way anonymous or real sign-ins do | Standard Stack, Alternatives Considered | If they do count as MAU (likely, since any successful sign-in appears to increment MAU per the docs snippet found), budget/cost planning should account for one MAU per enrolled tablet device, not just per human owner — worth a quick confirmation against current Supabase billing docs before scaling to many venues |
| A3 | Multiple independent Supabase Auth sessions (device-staff session + a separate owner-unlock session) can coexist in one browser via custom `storageKey` configuration per client instance, enabling D-07's "owner unlocks on the same tablet without losing the staff session underneath" | Architectural Responsibility Map / Open Questions | If simultaneous dual-session isn't cleanly supported, D-07 may need to be implemented instead as "owner login temporarily replaces the device session, then explicitly 'exit owner mode' re-authenticates the device" (a full session swap both ways) rather than true parallel sessions — changes the RPC/UX shape but not the security model |
| A4 | Supabase CLI installation method/version at scaffold time (not independently version-pinned via `npm view` since it isn't distributed as a plain npm dependency in the conventional sense) | Standard Stack | Low risk — CLI install instructions are stable; verify `supabase --version` output at scaffold time |

**If this table is empty:** N/A — see entries above; all four require a brief confirmation step at plan/spike time, none block starting the phase.

## Open Questions

1. **Does the device-provisioning-then-sign-in sequence (Pattern 2) actually swap the browser's session cookies correctly in one Server Action call, or does it need a redirect/second round trip?**
   - What we know: `admin.createUser` (secret-key client) and `signInWithPassword` (anon-key client, cookie-bound) are both documented, independently.
   - What's unclear: whether calling both in sequence inside one Server Action, using two different Supabase client instances, correctly results in the anon-key client's `setAll` cookie writes reflecting the *new* device session (overwriting the owner's prior session cookies) in the same response.
   - Recommendation: spike this exact flow locally against `supabase start` before the plan finalizes the "Enable Staff Mode" task; fall back to a redirect-based two-step flow if the single-call swap proves unreliable.

2. **Can two independent Supabase Auth sessions coexist in one browser (device-staff + owner-unlock) via custom `storageKey`, for D-07?**
   - What we know: `@supabase/ssr`/`@supabase/supabase-js` clients accept an `auth.storageKey` option in general Supabase client configuration; the specific "run two clients with two keys, keep both sessions alive independently" pattern for the *cookie-based* SSR client was not directly confirmed against current docs this session.
   - What's unclear: whether cookie-based (not just localStorage-based) sessions support this cleanly in Next.js Server Actions, given `@supabase/ssr`'s cookie names may not be independently namespaced by default.
   - Recommendation: treat D-07's "owner unlock on the shared tablet" as a full session-swap-and-swap-back (simpler, definitely works) unless a spike confirms true dual-session support; either way the RLS boundary is unaffected since it's always evaluated from whichever session is currently active.

3. **Should the RLS test suite run against `supabase start` (local Docker Postgres+GoTrue) in CI, or against a dedicated ephemeral Supabase cloud project?**
   - What we know: local Docker-based Supabase stack is the standard recommended dev/test loop; Docker is confirmed available in this environment.
   - What's unclear: CI-specific tooling/runner constraints weren't researched this session (out of scope — Phase 1 CI setup is an implementation detail, not a research gap that blocks planning).
   - Recommendation: default to local `supabase start` for both local dev and CI (spin up the stack as a CI step); revisit only if CI runner constraints make this impractical.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node.js | Next.js dev/build, Vitest | ✓ | v24.14.1 | — |
| npm | package management | ✓ | 11.11.0 | — |
| Docker | `supabase start` local dev stack (Postgres+GoTrue+Storage), required for the RLS test suite | ✓ | 28.3.2 | — |
| git | version control | ✓ | 2.50.1 | — |
| Supabase CLI | migrations, local dev, type generation | ✗ | — | Install via `npx supabase <command>` (no global install needed) or `brew install supabase/tap/supabase`; not a blocker, zero-install-friction fallback exists |
| Vercel CLI | local preview of Vercel-specific behavior (edge config, env pull) | ✗ | — | Not required for Phase 1 — Vercel deploys work via git integration without the CLI; install later only if local `vercel dev` parity becomes useful |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Supabase CLI (use `npx supabase`), Vercel CLI (use git-based deploys; CLI optional).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 (none installed yet — Wave 0 gap) |
| Config file | none — see Wave 0 |
| Quick run command | `npx vitest run tests/rls/venue-isolation.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| ACCT-01 | Owner can sign up and log in | integration (client SDK against local Supabase) | `npx vitest run tests/auth/signup.test.ts` | ❌ Wave 0 |
| ACCT-02 | Owner can create a venue with name/currency/language | integration | `npx vitest run tests/venues/create.test.ts` | ❌ Wave 0 |
| ACCT-03 | One owner can hold multiple venues | integration | `npx vitest run tests/venues/multi-venue.test.ts` | ❌ Wave 0 |
| ACCT-04 | Owner can provision a staff PIN profile | integration | `npx vitest run tests/staff/provision.test.ts` | ❌ Wave 0 |
| ACCT-05 | Staff device signs in and sees only its venues | integration (client SDK, device account) | `npx vitest run tests/rls/venue-isolation.test.ts` | ❌ Wave 0 |
| ACCT-06 | Staff can toggle availability only, not price/content/settings | integration (client SDK, negative + positive assertions) | `npx vitest run tests/rls/staff-write-boundary.test.ts` | ❌ Wave 0 |
| ACCT-07 | Owner can edit all content/theming/settings | integration | `npx vitest run tests/rls/owner-full-access.test.ts` | ❌ Wave 0 |
| ACCT-08 | Cross-venue read/write is blocked for all roles | integration (client SDK, the D-25 release gate) | `npx vitest run tests/rls/venue-isolation.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/rls/<relevant-file>.test.ts` (targeted)
- **Per wave merge:** `npx vitest run` (full suite, requires `supabase start` running)
- **Phase gate:** Full RLS suite green (D-25) before `/gsd-verify-work` — this is the phase's explicit, non-negotiable release gate per CONTEXT.md.

### Wave 0 Gaps
- [ ] `vitest.config.ts` — configure `test.sequence.concurrent: false` (RLS/fixture tests share a DB with FK constraints; parallel runs risk collisions per the client-SDK testing research above)
- [ ] `tests/rls/setup.ts` — service-role fixture helper (create/teardown test venues, owner accounts, device accounts) with unique IDs per run
- [ ] `supabase/seed.sql` — seed data for local dev distinct from test fixtures
- [ ] Framework install: `npm install -D vitest` — none installed yet (greenfield)
- [ ] `supabase init` + first migration establishing `accounts`, `venues`, `venue_members`, `staff_profiles`, `venue_devices`, `private.get_venue_role()`, and the `rls_test_items` placeholder table — all with RLS enabled in the same migration (D-23)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | yes | Supabase Auth (email+password with configurable min length/complexity, Google OAuth via `signInWithIdToken`); no custom password storage/hashing |
| V3 Session Management | yes | `@supabase/ssr` cookie-based sessions, refresh token rotation (Supabase default), `admin.signOut(userId, 'global')` for explicit revocation, RLS re-derivation on every query as the actual instant-revocation mechanism (not JWT expiry) |
| V4 Access Control | yes | `private.get_venue_role()` SECURITY DEFINER helper + dual venue+role RLS policies (D-22); narrow RPCs (Pattern 3) for any column-restricted write |
| V5 Input Validation | yes | Zod schemas at every Server Action boundary (signup form, venue creation, staff PIN provisioning — validate PIN is exactly 4 digits before it ever reaches the DB) |
| V6 Cryptography | yes | `pgcrypto` `crypt()`/`gen_salt('bf')` for PIN hashing — never hand-roll; Supabase Auth owns password hashing entirely (never touched by app code) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Cross-tenant data leakage via missing/broad RLS policy | Information Disclosure | Every table's RLS enabled in its creation migration (D-23) + dual venue+role check via the SECURITY DEFINER helper (D-22); proven by the D-25 release-gate test suite |
| Staff role privilege escalation via blanket UPDATE grant | Elevation of Privilege | Narrow RPC as the only staff write path (Pattern 3) — no blanket `UPDATE` grant on any staff-touched table |
| PIN brute-forcing on the shared tablet | Elevation of Privilege / Spoofing | Exponential backoff (D-18) implemented inside `verify_staff_pin()` via a `failed_attempts`/`locked_until` column, checked before every attempt |
| Secret key exposure in client bundle | Information Disclosure / Elevation of Privilege | `lib/supabase/admin.ts` imported only from server-only Server Actions (`actions/devices.ts`); never a `NEXT_PUBLIC_`-prefixed env var; D-24 |
| Stolen/lost tablet retaining valid access after "revoke" | Elevation of Privilege | Revoke deletes the `venue_members` row (RLS is re-checked live on every query, so this alone is instant) AND calls `admin.signOut(deviceUserId, 'global')` as defense-in-depth against the access-token window |
| CSRF on state-changing Server Actions | Tampering | Next.js Server Actions include built-in origin-checking (same-origin POST enforcement) as of current Next.js versions — no additional CSRF token needed for same-origin form submissions; verify this holds for the installed Next.js 16 version at implementation time |

## Sources

### Primary (HIGH confidence)
- Context7 `/supabase/ssr` — `createServerClient`/`createBrowserClient` cookie patterns, middleware token-refresh best practices
- Context7 `/supabase/auth` — anonymous sign-in configuration, session logout scopes (global/local/others), refresh token rotation config
- Context7 `/websites/supabase` — RLS SECURITY DEFINER pattern, pgTAP testing helpers (`tests.authenticate_as`, `tests.rls_enabled`), Google One Tap integration, admin client / secret key usage, `is_anonymous` RLS check, MAU billing on sign-in, CLI migration workflow
- Context7 `/vercel/next.js` — Server Actions cookie handling, form submission pattern, `revalidatePath`
- npm registry (`npm view <pkg> version`) — verified current versions for `next`, `react`, `react-dom`, `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `vitest`, `typescript` (2026-07-24)

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`, `.planning/research/STACK.md` (prior project-level research, carried forward per CONTEXT.md canonical refs) — Pattern 1's exact SQL shape, Anti-Pattern 1/2, security mistakes table
- WebFetch of `supabase.com/docs/guides/local-development/testing/overview` — confirms pgTAP vs application-level client-SDK testing as Supabase's two official complementary approaches

### Tertiary (LOW confidence)
- WebSearch: Supabase RLS testing with Vitest (index.garden, dev.to, GitHub discussions) — client-SDK test suite composition patterns (sequential execution, service-role fixtures, unique-ID-per-test isolation); directional, not from Supabase's own docs directly
- WebSearch: `pgcrypto` bcrypt PIN hashing best practices (Vultr docs, PostgreSQL docs, Medium/Hostman tutorials) — cost factor recommendation (10-14), storage-as-text guidance

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against live npm registry; Supabase/Next.js primitives sourced from official docs via Context7
- Architecture (Patterns 1, 3, 4 — RLS/RPC/hashing): HIGH — directly sourced from official Supabase docs and carried-forward prior project research
- Architecture (Pattern 2 — device provisioning session-swap): MEDIUM — primitives are documented individually; the specific composition/sequencing is ASSUMED and flagged for a pre-plan spike (Open Question 1)
- Pitfalls: HIGH — RLS pitfalls are directly sourced from official docs and prior project PITFALLS.md; device-theft/revocation pitfall is architecturally derived from documented RLS re-check behavior
- Validation architecture: MEDIUM — test framework choice (Vitest) is standard; exact client-SDK RLS test suite structure is composed from community patterns (LOW-confidence sources), not an official Supabase template

**Research date:** 2026-07-24
**Valid until:** 30 days (stable domain — Supabase Auth/RLS mechanics and Next.js Server Actions are not fast-moving APIs at this layer; re-verify npm versions if planning is delayed past that window)
