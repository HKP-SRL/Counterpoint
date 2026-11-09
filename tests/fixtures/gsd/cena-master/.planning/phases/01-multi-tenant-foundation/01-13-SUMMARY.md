---
phase: 01-multi-tenant-foundation
plan: 13
subsystem: auth
tags: [authority-gate, route-family, structural-guard, postgrest, error-vs-absence, operator-docs, vitest]

# Dependency graph
requires:
  - phase: 01-multi-tenant-foundation
    provides: "01-12's AST/filesystem coverage-guard shape, including the assert-extraction-first discipline"
  - phase: 01-multi-tenant-foundation
    provides: "lib/venue-authority.ts resolveVenueOwner — the shared predicate both sibling pages already used"
provides:
  - "A uniform authority gate across every page.tsx in the /venues/[venueId] route family"
  - "tests/lib/venue-page-gate-coverage.test.ts — a directory-walking guard that keeps the family gated as it grows"
  - "lib/venue-landing.ts — the /venues destination decision, extracted so the suite can drive it"
  - "A repeated-denial assertion for the device principal (ACCT-08 idempotency)"
  - "An operator-accurate STAFF_SESSION_SECRET rotation warning in .env.example"
affects: [any later phase adding a page under /venues/[venueId] or a field to the venue detail page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A route family's authority gate is asserted structurally by walking the real directory, not by a hard-coded list of pages"
    - "RLS is the TENANT boundary and not the ROLE boundary; a page that relies on it for both gets the second one wrong"
    - "A read error is checked BEFORE the data channel, because a fault populates data: null too"
    - "A page-level decision a Server Component makes is extracted to a Next-free module when the alternative is a fix with no regression guard"
    - "Every structural guard is observed failing against a real ungated file, then reverted, before it is trusted"

key-files:
  created:
    - lib/venue-landing.ts
    - tests/lib/venue-landing.test.ts
    - tests/lib/venue-page-gate-coverage.test.ts
  modified:
    - app/(dashboard)/venues/[venueId]/page.tsx
    - app/(dashboard)/venues/page.tsx
    - tests/actions/venue-authority.test.ts
    - tests/venues/multi-venue.test.ts
    - .env.example

key-decisions:
  - "The venue-detail gate gets its OWN comment rather than a copy of the staff pages'. There the check separates 'you shouldn't be here' from an empty roster; here the venue row comes back for any member including the device principal, so the reason is that RLS is the tenant boundary and not the role boundary"
  - "The guard is scoped to the [venueId] subtree deliberately, and says so. app/(dashboard)/venues/page.tsx sits one level up with no venue id to check against — including it would make the guard wrong rather than stricter, and a guard suppressed at its first real case is a guard nobody keeps"
  - "resolveVenuesLanding THROWS on a read error rather than falling back, because the fall-through branch is not a neutral empty state — it is an invitation to write, and venues.name is non-unique with no DELETE grant anywhere, so accepting it is permanent"
  - "The repeated-denial case asserts INSIDE the loop and pairs with an owner-still-resolves assertion, so it cannot pass because the predicate stopped resolving anyone"
  - "requirements-completed is [] — the plan's own flagged_assumptions require a verifier who cannot confirm ACCT-03/ACCT-08's wider shape to abstain to human_needed, and all four human-verification items are unexercised in this headless worktree"

patterns-established:
  - "Directory-walk coverage guard for a route family's shared gate, with the extraction count asserted before the coverage loop"
  - "RED-first for a Server Component decision: land the module as a stub that returns the WRONG answer, run the suite against it, then implement"

requirements-completed: []

coverage:
  - id: E1
    description: "A principal who is a member of the venue but NOT its owner — the staff device principal — gets a 404 instead of the venue's name, currency, languages, country and timezone (WR-02, ACCT-07, ACCT-08)"
    requirement: ACCT-07
    verification:
      - kind: unit
        ref: "tests/actions/venue-authority.test.ts#returns null for the venue's own staff device principal"
        status: pass
      - kind: unit
        ref: "tests/actions/venue-authority.test.ts#pins both branches of all three pages in the /venues/[venueId] route family"
        status: pass
      - kind: other
        ref: "grep -c 'resolveVenueOwner' 'app/(dashboard)/venues/[venueId]/page.tsx' -> 3 (floor 2); grep -c 'notFound' -> 3 (floor 3)"
        status: pass
    human_judgment: false
  - id: E2
    description: "Every page.tsx under app/(dashboard)/venues/[venueId]/ calls resolveVenueOwner, asserted by walking the real directory rather than a hard-coded list"
    verification:
      - kind: unit
        ref: "tests/lib/venue-page-gate-coverage.test.ts#references resolveVenueOwner from every page in the family"
        status: pass
      - kind: unit
        ref: "tests/lib/venue-page-gate-coverage.test.ts#discovered the page.tsx files by walking the real route directory (floor 3)"
        status: pass
      - kind: other
        ref: "observed RED twice — naming app/(dashboard)/venues/[venueId]/page.tsx before the fix, and naming a deliberately un-gated staff/page.tsx before revert"
        status: pass
    human_judgment: false
  - id: E3
    description: "Repeating a denied read does not weaken it: resolveVenueOwner returns null for the device principal on every call (ACCT-08 idempotency edge)"
    requirement: ACCT-08
    verification:
      - kind: unit
        ref: "tests/actions/venue-authority.test.ts#keeps denying the device principal on every repeat, not merely the first (5 attempts, asserted inside the loop)"
        status: pass
    human_judgment: false
  - id: E4
    description: "A transient venues read is never presented as an authoritative empty result: resolveVenuesLanding throws on a non-null error (WR-03, ACCT-02 idempotency edge)"
    requirement: ACCT-02
    verification:
      - kind: unit
        ref: "tests/lib/venue-landing.test.ts#THROWS on a non-null error rather than returning a landing decision"
        status: pass
      - kind: unit
        ref: "tests/lib/venue-landing.test.ts#names the error's code and message in what it throws"
        status: pass
      - kind: other
        ref: "grep -c 'resolveVenuesLanding' 'app/(dashboard)/venues/page.tsx' -> 3 (floor 2); grep -c 'error' -> 4 (floor 1)"
        status: pass
    human_judgment: false
  - id: E5
    description: "resolveVenuesLanding returns create-first for an empty array and for null data when the error is null, and a redirect carrying the single row's id (ACCT-02 empty edge)"
    requirement: ACCT-02
    verification:
      - kind: unit
        ref: "tests/lib/venue-landing.test.ts — the paired contrast ([] and null both create-first) plus single-row and multi-row redirect cases, all toEqual on the whole object"
        status: pass
    human_judgment: false
  - id: E6
    description: "Two venues created by one owner with byte-identical names are two distinct rows with distinct ids (ACCT-02 adjacency edge)"
    requirement: ACCT-02
    verification:
      - kind: unit
        ref: "tests/venues/multi-venue.test.ts#stores two venues with BYTE-IDENTICAL names as two distinct rows"
        status: pass
      - kind: other
        ref: "migration 0001: no unique constraint on venues.name; grant select, update on public.venues to authenticated — no DELETE grant anywhere"
        status: pass
    human_judgment: false
  - id: E7
    description: ".env.example states the true rotation blast radius for STAFF_SESSION_SECRET (WR-04)"
    verification:
      - kind: other
        ref: "grep counts — cena_device_user 2, lib/staff-session.ts 1, lib/device-session.ts 1, lib/recovery-session.ts 1, SUPABASE_SECRET_KEY 3 (floor 2), 'on site' 1"
        status: pass
      - kind: other
        ref: "claims verified against source: all three modules read STAFF_SESSION_SECRET ?? SUPABASE_SECRET_KEY; DEVICE_COOKIE_MAX_AGE_SECONDS = 60*60*24*3650"
        status: pass
    human_judgment: false
  - id: E8
    description: "ACCT-02 ordering edge — the order the dashboard and switcher return tied venues in is specified and stable"
    verification: []
    human_judgment: true
    rationale: "Carried as a `verification: backstop` truth by the plan. Requires repeated live reads against rows that tie on created_at; not exercised in this headless worktree."
  - id: E9
    description: "ACCT-02 concurrency edge — two racing venue-creation submits produce two distinct venues; v1 makes no cross-request dedupe guarantee and none is claimed"
    verification: []
    human_judgment: true
    rationale: "Carried as a `verification: backstop` truth by the plan, deliberately — asserting it would need a live concurrency fixture that widens the run beyond the four scoped warnings."
  - id: E10
    description: "SC1, owner-surface, D6 and ordering human verification (four items carried from 01-VERIFICATION.md)"
    verification: []
    human_judgment: true
    rationale: "All four require a human driving a real browser against the local stack. This executor runs in a headless worktree with no browser; NONE were exercised. Detailed under 'Outstanding human verification' below."

# Metrics
duration: 11min
completed: 2026-07-29
status: complete
---

# Phase 01 Plan 13: The Route Family Gets One Gate, The Failed Read Gets A Voice Summary

**The venue-detail page now goes through the same `resolveVenueOwner` its two siblings always did — with a directory-walking guard that was observed naming it as the ungated one before the fix — the `/venues` landing read stops turning a five-second outage into a permanent duplicate venue, and `.env.example` tells an operator that rotating the staff secret means walking to every tablet.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-07-29T11:36:00Z
- **Completed:** 2026-07-29T11:47:00Z
- **Tasks:** 3
- **Files modified:** 8 (5 modified, 3 created)

## Accomplishments

- **WR-02 closed, and closed structurally.** `app/(dashboard)/venues/[venueId]/page.tsx` read the venue and rendered it with no authority check, while both siblings held `resolveVenueOwner`. The subtlety is why it survived a phase: the RLS read *looks* like the boundary, and for another venue's people it is. But the venue's own staff device principal holds a real `venue_members` row for that venue, so the row comes back for it too — RLS is the **tenant** boundary and this page was leaning on it as the **role** boundary as well. The tablet rendered the owner's venue dashboard for its own venue.
- **The disclosure was small, which is exactly the trap.** A venue's own name, currency, default and enabled languages, country code and timezone, shown to a device belonging to that venue — and both nav links already 404'd correctly, which is what made it read as an oversight rather than a decision. The reason to close it now is trajectory: every field Phase 2 adds to this page inherits whichever gate is present on the day it is added.
- **The family is now held to the gate by a guard, not by memory.** `tests/lib/venue-page-gate-coverage.test.ts` walks the real `[venueId]` directory and requires every `page.tsx` to reference the predicate. It was observed red twice — once naming the actual ungated page before the fix, once naming a deliberately broken sibling — so it is a guard rather than an assertion about a guard.
- **WR-03 closed with a regression guard rather than a one-liner.** The `/venues` read bound only `data`, so a transient failure fell through to "add your first venue" and invited an existing owner to create a duplicate. What makes that permanent rather than cosmetic is two absences, both now asserted: `venues.name` carries no unique constraint (deliberately — two branches of one restaurant share a name), and `authenticated` holds `select, update` on `public.venues` with **no DELETE grant anywhere**. A read fault was being converted into an irreversible user write. `resolveVenuesLanding` throws instead, so the fault reaches the route error boundary and the owner reloads at no cost.
- **The decision was extracted because the alternative was untestable.** The page is a Server Component; no test in this suite can render it, so an inline `if (error) throw` would have been a correction with no regression guard — the shape of evidence this phase has already shipped defects behind twice. The module imports nothing from `next/*` and the suite drives it in both directions.
- **WR-04 closed.** The rotation paragraph promised "one re-tap". The key now signs three values, and `cena_device_user` — ten-year `maxAge`, the only thing that makes a browser the venue's tablet — has no re-issue path, because re-issuing it *is* enrolment. Rotation therefore de-enrols the estate and requires a person at each device. The `SUPABASE_SECRET_KEY` fallback gives a *database*-secret rotation the identical blast radius, which is the part an operator would never expect.
- **The phase gate is green: 31 files, 314 tests, all passing.** `pnpm exec tsc --noEmit` exit 0, `pnpm build` succeeded listing all four venue routes, `pnpm lint` zero problems, `git diff --stat pnpm-lock.yaml` empty.

## Task Commits

1. **Task 1 (auto, tdd): The venue-detail page gets the gate its siblings have** — `2668901` (fix)
2. **Task 2 (auto, tdd): A failed venues read stops looking like an owner with no venues** — `aa823da` (fix)
3. **Task 3 (auto): The rotation document tells the truth** — `1cbc4b6` (docs)

## Files Created/Modified

- `app/(dashboard)/venues/[venueId]/page.tsx` — `resolveVenueOwner` import plus the call and `notFound()` branch, placed after the venue read and before the render, matching both siblings. Not wrapped in try/catch, with a comment saying why. The gate comment is deliberately **not** a copy of the staff pages': theirs separates "you shouldn't be here" from an empty roster; this one explains the tenant-versus-role distinction, because that is the actual reason the omission was invisible.
- `app/(dashboard)/venues/page.tsx` — the read binds `error`; the whole result goes to `resolveVenuesLanding`; `redirect()` stays outside any try/catch (it throws `NEXT_REDIRECT` to do its job). The existing header comment and the `order("created_at")` are untouched — the ordering is the ACCT-02 stability property and was not this task's subject.
- `lib/venue-landing.ts` (new) — `VenuesLanding`, `VenuesReadResult`, `resolveVenuesLanding`. Next-free. The header states the harm concretely (non-unique names, no DELETE grant, the fall-through is an invitation to write) rather than abstractly, because abstract error handling is what got discarded here in the first place.
- `tests/lib/venue-landing.test.ts` (new) — 7 tests (plan floor: 6).
- `tests/lib/venue-page-gate-coverage.test.ts` (new) — 2 tests, extraction count asserted first.
- `tests/actions/venue-authority.test.ts` — the pinning case renamed and extended to name all three pages on separate lines; new repeated-denial case for the device principal. 10 tests (was 9).
- `tests/venues/multi-venue.test.ts` — the byte-identical-name case. 5 tests (was 4).
- `.env.example` — the `STAFF_SESSION_SECRET` rotation block rewritten as a warning label: the three signed values with their modules, the decode-to-null → `no-device-cookie` → both-cookies-cleared mechanism, the on-site per-device re-enrolment, the in-flight recovery grants, and the `SUPABASE_SECRET_KEY` fallback equivalence. The existing rationale for why the cookie is signed and the `openssl rand -hex 32` example are unchanged.

## RED-first observations (required evidence)

**A guard never seen failing is an assertion about a guard, not a guard.** All three observations were produced against source that did not yet contain the corresponding fix.

### Task 1, observation 1 — the guard against the real ungated page

`pnpm exec vitest run tests/lib/venue-page-gate-coverage.test.ts` → **1 failed | 1 passed (2)**.

```
FAIL  tests/lib/venue-page-gate-coverage.test.ts > every page.tsx under /venues/[venueId] goes
      through resolveVenueOwner > references resolveVenueOwner from every page in the family
AssertionError: These pages under app/(dashboard)/venues/[venueId]/ render venue data without ever
calling resolveVenueOwner:
  - app/(dashboard)/venues/[venueId]/page.tsx
The RLS read above them is the TENANT boundary, not the ROLE boundary: the venue's own staff device
principal holds a real venue_members row for that venue, so the row comes back for it too. A page in
this family without the gate hands every field it renders — and every field a later phase adds to it
— to the device principal.: expected [ Array(1) ] to deeply equal []

- []
+ [
+   "app/(dashboard)/venues/[venueId]/page.tsx",
+ ]
```

The extraction test passed in the same run, which is the control: the walk found its three pages, so the failure above is a real coverage gap and not an empty list.

### Task 1, observation 2 — the deliberate break on a sibling

`resolveVenueOwner` was temporarily removed from `app/(dashboard)/venues/[venueId]/staff/page.tsx` (both the import and the call), after the venue-detail fix had landed:

```
AssertionError: These pages under app/(dashboard)/venues/[venueId]/ render venue data without ever
calling resolveVenueOwner:
  - app/(dashboard)/venues/[venueId]/staff/page.tsx
```

Reverted with `git checkout -- 'app/(dashboard)/venues/[venueId]/staff/page.tsx'`. Afterwards `git status --porcelain` on that path printed nothing, and the guard returned to **2 passed (2)**.

### Task 2 — the landing resolver against a create-first stub

`lib/venue-landing.ts` was landed first as a stub returning `{ kind: "create-first" }` for every input — which is precisely what the shipped page did. `pnpm exec vitest run tests/lib/venue-landing.test.ts` → **5 failed | 2 passed (7)**.

```
FAIL > THROWS on a non-null error rather than returning a landing decision
AssertionError: expected [Function] to throw an error
 ❯ tests/lib/venue-landing.test.ts:35:72

FAIL > names the error's code and message in what it throws
AssertionError: expected [Function] to throw an error
- Expected: null
+ Received: undefined

FAIL > throws even when the error arrives beside a non-empty data array
FAIL > returns a redirect carrying the single row's id
FAIL > redirects to the FIRST row when several come back, preserving the caller's order
```

The **two that passed** are the load-bearing control: `{ data: [], error: null }` and `{ data: null, error: null }` both returned create-first against the stub and still do after the fix. That pairing is what proves the implemented throw is discriminating rather than a resolver that throws on everything — which would strand every genuine first-venue owner on an error page, a strictly worse outcome than the defect.

## Verification gate results

| Gate | Result |
|---|---|
| `pnpm exec vitest run tests/lib/venue-page-gate-coverage.test.ts` | 2 passed (plan floor: 2) |
| `pnpm exec vitest run tests/actions/venue-authority.test.ts` | 10 passed |
| `pnpm exec vitest run tests/lib/venue-landing.test.ts` | 7 passed (plan floor: 6) |
| `pnpm exec vitest run tests/venues/multi-venue.test.ts` | 5 passed, incl. byte-identical names |
| `pnpm exec vitest run` (full suite) | **31 files, 314 tests passed** (base was 29 files / 303) |
| `pnpm exec tsc --noEmit` | exit 0, no output |
| `pnpm build` | succeeded; lists `/venues`, `/venues/[venueId]`, `/venues/[venueId]/staff`, `/venues/[venueId]/staff/devices` |
| `pnpm lint` | zero problems, no output |
| `git diff --stat pnpm-lock.yaml` | empty — no package installed anywhere in this plan |
| `grep -rnE "\b(TBD\|FIXME\|XXX)\b" actions lib app components tests supabase/migrations` | no matches (exit 1) |
| `git status --porcelain .planning/.../deferred-items.md` | prints nothing — unchanged, every deferral stays deferred |
| `grep -c 'resolveVenueOwner' 'app/(dashboard)/venues/[venueId]/page.tsx'` | 3 (floor: 2) |
| `grep -c 'notFound' 'app/(dashboard)/venues/[venueId]/page.tsx'` | 3 (floor: 3) |
| `grep -c 'venues/\[venueId\]' tests/actions/venue-authority.test.ts` | 4 (floor: 3) |
| `grep -c 'resolveVenuesLanding' 'app/(dashboard)/venues/page.tsx'` | 3 (floor: 2) |
| `grep -c 'error' 'app/(dashboard)/venues/page.tsx'` | 4 (floor: 1) |
| `grep -c 'from "next/' lib/venue-landing.ts` | 0 — the module stays Next-free and Vitest-reachable |
| `grep -c 'cena_device_user' .env.example` | 2 (floor: 1) |
| `grep -c 'lib/staff-session.ts' / 'lib/device-session.ts' / 'lib/recovery-session.ts' .env.example` | 1 / 1 / 1 (floor: 1 each) |
| `grep -c 'SUPABASE_SECRET_KEY' .env.example` | 3 (floor: 2) |
| `grep -ci 'on site' .env.example` | 1 (floor: 1) |

### Live database state (via `docker exec`, `psql` is not installed on this host)

| Gate | Result |
|---|---|
| migrations `0001`–`0007` recorded | **7** |
| `accounts` UPDATE grant for `authenticated` | **0** — still absent |
| `SECURITY DEFINER` functions in `public` **without** empty search_path | **0** |
| total `prosecdef` functions in `public` (so the 0 above is not an empty population) | **8** |

**The search_path gate is capable of failing, and was checked for that.** The literal is `array['search_path=""']`, not the `array['search_path=']` form that appears across earlier phase-01 plan text. Reading `p.proconfig` directly confirms all eight functions — `create_venue`, `deactivate_staff_profile`, `ensure_account`, `list_staff_for_pin`, `provision_staff_pin`, `staff_pin_lock_seconds`, `toggle_item_availability`, `verify_staff_pin` — store `{"search_path=\"\""}`. So the predicate is matching real rows rather than matching nothing, and the 0 is a genuine pass against a population of 8.

**No suite flakiness observed.** The two timing-sensitive files flagged in the dispatch passed on all three full runs, first try — including `tests/actions/venue-authority.test.ts`, which this plan modifies.

## Decisions Made

- **The venue-detail gate's comment is written fresh, not copied.** The two staff pages explain their check as separating "you shouldn't be here" from an empty list. That reason does not apply here, and pasting it would have left the actual reason unrecorded — that the venue row comes back for *any* member, tablet included, so RLS is the tenant boundary and only looks like the whole boundary. A wrong-but-plausible comment on a security gate is worse than none, because it tells the next reader the question has been thought about.
- **The guard is scoped to the `[venueId]` subtree, and the header says why at length.** `app/(dashboard)/venues/page.tsx` sits one level up, has no venue id to resolve an owner against, and is the owner's own landing route. Including it would make the guard *wrong* rather than stricter — and a guard that has to be suppressed at its first real case is a guard the next person deletes. The scope boundary is "a venue id in the path is what makes the question askable".
- **`resolveVenuesLanding` throws rather than falling back, and the module header argues it concretely.** A fallback is the right instinct when guessing wrong costs a re-render. Here guessing wrong costs an irreversible write *by the user*, on the strength of a screen that lied to them. The header names the two absences that make it irreversible (no unique constraint, no DELETE grant) instead of gesturing at "error handling", because a general principle is what got discarded here the first time.
- **The error branch is checked first, and the comment says so.** A PostgREST fault sets `data: null` *alongside* the error, so any test of the data channel placed above it swallows the fault exactly as the shipped page did — the same ordering trap plan 01-12 hit in `exitOwnerUnlock`. Same shape, one file over, one wave later.
- **The repeated-denial case asserts inside the loop and pairs with an owner check.** Asserting only the final value would pass for a predicate that let attempts 1–4 through; asserting only the denial would pass for a predicate that had stopped resolving anyone. Both halves are needed, for the same reason 01-12's paired contrast was non-negotiable. Repetition matters here specifically because the venue-detail page is a *reload target* — an intermittent gate that 404s once and renders on the next tap would be worse than no gate, because it would be unreportable.
- **The byte-identical-name case went into `tests/venues/multi-venue.test.ts`, not a new file.** The fixtures, the `createVenue` helper and the teardown all already live there, and a second file would provision another set of auth users against the single shared stack for no gain.
- **`.env.example` is written as an operator warning label, not a code comment.** It leads with the consequence ("rotating de-enrols every tablet, and you have to visit each one"), then explains, then names the fallback trap. This is the one document read *before* an irreversible action; everything downstream of a wrong number in it is already spent.
- **`requirements-completed` is `[]`.** The plan's `<flagged_assumptions>` explicitly requires a verifier who cannot confirm ACCT-03's and ACCT-08's wider shape with evidence to abstain to `human_needed`, and all four human-verification items are unexercised here. Marking four requirement IDs complete on the strength of test evidence that covers specific edges under them would be exactly the silent pass that instruction forbids. Same disposition as plan 01-12.

## Deviations from Plan

None to the plan's substance. Two environment restorations, both anticipated by the plan's own `<standing_execution_overrides>`:

1. **`.env.local` did not survive worktree creation** (it is gitignored). Copied from the main checkout at `/Users/alexprofir/Work/HKP/Cena/.env.local` before the first test run. Not a code change. Note this is a different file from `.env.example`, which Task 3 edits — `.env.example` is a committed template and never a source of runtime values.
2. **`node_modules/` was absent in the worktree.** Ran `pnpm install --frozen-lockfile`. `pnpm-lock.yaml` is byte-identical afterwards (`git diff --stat` empty), so this satisfies rather than violates the no-package-installed constraint (T-01J-SC).

One small addition beyond the letter of the plan, strengthening rather than widening:

3. **A third error case in `tests/lib/venue-landing.test.ts`** — an error arriving beside a *non-empty* data array also throws. Defensive rather than observed: whichever way PostgREST populates the two channels, an error is never a successful read and a partial result is not a destination. It costs nothing and closes the one input shape the plan's case list did not name.

## Issues Encountered

- **The RED-first stub had to return the *wrong* answer, not throw a "not implemented".** A stub that threw would have made the error cases pass for the wrong reason and hidden whether the test could see the defect at all. Returning `create-first` for everything reproduces the shipped page's exact behaviour, which is why the 5-failed/2-passed split is meaningful: the same file demonstrates both that it catches the defect and that it does not simply fail everything.
- **Const declarations in the landing test were initially placed below their use.** Legal (the test callbacks run after the module body) but confusing to read; moved to the top beside the `TIMEOUT` fixture.

## Threat Flags

None. No new network endpoint, no new auth path, no file access pattern, no schema change. Both code changes strictly *narrow* what is rendered or *widen* what is reported as a failure. No migration, no package, no component, no copy key — the venues read failure surfaces through the existing route error boundary, which `01-UI-SPEC.md` already designates for page-level query failures (E4/E6).

The one accepted risk from the register is unchanged: **T-01J-04**, that applying `resolveVenueOwner` here would 404 a future `manager` role until the predicate is widened. Accepted because v1 has exactly two roles (D-09), both siblings already carried the identical predicate so this page becomes consistent rather than exceptional, and widening is one shared function rather than three pages. The owner path is proven non-broken at the predicate level by the three-page pinning case (owner resolves against a venue that has a tablet); the *render* level is the human check below.

## Known Stubs

None. The `lib/venue-landing.ts` stub described under RED-first observations existed only within Task 2 and was replaced by the real implementation in the same task, before the commit — `git show aa823da:lib/venue-landing.ts` contains the real module, not the stub. No hardcoded empty values, placeholder copy or unwired components were introduced.

## Outstanding human verification (backstop truths, NOT closed by this plan)

All four are carried from `01-VERIFICATION.md` and recorded in this plan's `must_haves` with `verification: backstop`. **This executor runs in a headless worktree with no browser, so NONE were exercised.** They remain the phase's outstanding human gate.

1. **SC1 — the full owner self-serve journey.** In a browser against the local stack, with no developer assistance: sign up at `/signup` with email, password and the Terms checkbox; create a venue picking RON, then repeat for HUF and EUR; confirm country and timezone auto-derive for RON and HUF, stay blank for EUR, and remain overridable; sign out; log back in at `/login`; confirm the venue is still listed and the switcher appears only from the second venue onward. **EXPECTED and not a regression:** the Terms and Privacy links 404, because `/legal/terms` and `/legal/privacy` are a recorded deferral.
2. **Owner surfaces — and this one is newly load-bearing.** With a tablet enrolled at the venue, load `/venues/{venueId}/staff` and `/venues/{venueId}/staff/devices` as the owner; both must render the roster and the device registry with its revoke control rather than 404. **Additionally, load `/venues/{venueId}` itself as the owner** — Task 1 tightened that page and the owner path must be unaffected. The predicate-level evidence is green (the three-page pinning case resolves the owner against a venue that has a tablet, which is the state CR-01 failed in), but the render path is not observed by any test.
3. **D6 — the stranded-owner consent path.** As an owner with no `accounts` row, re-submit the consent form; `ensure_account` must record consent and the owner must proceed to venue creation.
4. **Ordering under a tie.** Create two venues for one owner that tie on `created_at` and reload the dashboard and the venue switcher repeatedly; separately read back `rls_test_items` and venue settings rows that tie on their ordering key. The order must be stable across repeated reads. (ACCT-02 ordering edge, carried from plans 01-09 and 01-10.)

## User Setup Required

None — no external service configuration required. One operational note for whoever runs this project in production: `.env.example` now documents that setting a dedicated `STAFF_SESSION_SECRET` is what decouples staff/device/recovery cookie signing from the database secret. That is a recommendation the document now makes explicitly; it is not a change this plan made to any deployment.

## Next Phase Readiness

- **The `[venueId]` route family now has a structural obligation.** Any page added under `app/(dashboard)/venues/[venueId]/` in a later phase must reference `resolveVenueOwner` or `tests/lib/venue-page-gate-coverage.test.ts` goes red naming it. This is the artifact Phase 2 inherits, and it is the reason the WR-02 severity was set by trajectory rather than by the current payload.
- **`lib/venue-landing.ts` is the third Next-free decision module** after `lib/venue-authority.ts` and `lib/device-cookie-policy.ts`. The pattern is now established well enough to be the default: when a Server Component makes a decision worth a regression guard, the decision moves to a module and the page becomes a caller.
- **The error-versus-absence shape has now bitten three times in this phase** — `resolveVenueOwner` (CR-01), `exitOwnerUnlock` (01-12), and `/venues` (this plan). 01-12's summary flagged `revokeDevice` in `actions/devices.ts` as the next place the pattern would bite: it still destructures only `data` from a `venue_devices` read. It collapses into a generic error message rather than a cookie deletion or a phantom empty state, so it is lower severity and remains out of scope — but it is now the *last known* instance, and worth closing deliberately rather than waiting for it to surface as a fourth incident.
- **Four human-verification items gate the phase, not this plan.** The automated evidence is complete and green; what remains is browser work no headless executor can do. Item 2 in particular should be run before this phase is considered shut, because Task 1 tightened a page an owner uses and only the predicate beneath it is test-proven.
- **`requirements-completed` is deliberately empty.** ACCT-02, ACCT-03, ACCT-07 and ACCT-08 each have concrete edges resolved here with wired tests (E1–E7 above), but the plan's own flagged assumptions require abstention on the wider shape of ACCT-03 and ACCT-08, and the human items bear directly on ACCT-07's render path. A verifier should read the coverage block rather than a checkbox.

## Self-Check: PASSED

- `app/(dashboard)/venues/[venueId]/page.tsx` — FOUND
- `app/(dashboard)/venues/page.tsx` — FOUND
- `lib/venue-landing.ts` — FOUND
- `tests/lib/venue-landing.test.ts` — FOUND
- `tests/lib/venue-page-gate-coverage.test.ts` — FOUND
- `tests/actions/venue-authority.test.ts` — FOUND
- `tests/venues/multi-venue.test.ts` — FOUND
- `.env.example` — FOUND
- commit `2668901` — FOUND
- commit `aa823da` — FOUND
- commit `1cbc4b6` — FOUND

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-29*
