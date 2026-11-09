---
phase: 01-multi-tenant-foundation
plan: 05
subsystem: authorization-boundary
tags: [supabase, rls, postgres, security-definer, rpc, vitest, release-gate, pnpm]

# Dependency graph
requires:
  - "01-01 — migration 0001 (venues, venue_members, private.get_venue_role, the no-INSERT/no-DELETE grant discipline), tests/rls/setup.ts and its expectWriteDenied helper"
  - "01-03 — migration 0002 (staff_profiles, the staff RPCs whose abuse cases this gate folds up), lib/staff-session.ts and the signed cena_staff cookie"
  - "01-04 — migration 0003 (venue_devices), createStaffDeviceMember as the staff principal the matrix drives"
provides:
  - "public.rls_test_items — the Phase 1 placeholder that makes the ACCT-06 column carve-out testable before Phase 2's content schema exists; Phase 2 DROPS it"
  - "public.toggle_item_availability(uuid, boolean, uuid) — the entire staff write surface, SECURITY DEFINER, two columns, one WHERE clause holding every gate"
  - "actions/staff.ts::toggleItemAvailability — reads the verified staff id from the signed cena_staff cookie, never from the form"
  - "tests/rls/venue-isolation-matrix.test.ts — the D-25 release gate, a data-driven transcription of the written permission matrix (40 assertions)"
  - "tests/rls/rpc-abuse-matrix.test.ts — direct-.rpc abuse for every function in the product (23 assertions)"
  - "tests/rls/owner-full-access.test.ts — ACCT-07, every positive paired with the staff attempt at the same write (14 assertions)"
  - "tests/rls/availability-toggle-edges.test.ts — ACCT-06 idempotency, round trip, existence-leak and concurrency edges (8 assertions)"
  - "tests/rls/staff-write-boundary.test.ts — the tracer: toggle works, every direct write does not (6 assertions)"
  - ".planning/phases/01-multi-tenant-foundation/01-05-PERMISSION-MATRIX.md — the contract, with a cell -> assertion map"
  - "tests/rls/setup.ts — createVenueFor, createTestItem, readItemAsAdmin"
  - "91 new client-SDK assertions (151 total in the suite)"
affects:
  - "Phase 2 menu schema — inherits the toggle RPC's shape as the template for every limited-role write, and MUST drop rls_test_items in the migration that introduces the real items table"
  - "Phase 2 first migration — deferred-items.md now recommends the TRUNCATE/REFERENCES/TRIGGER revoke sweep as Phase 2's first migration, before menu tables multiply the finding"
  - "any later plan adding a public table — the six-table grant pattern (authenticated: SELECT, plus UPDATE only where an owner edits in place; anon: nothing) is now asserted, not conventional"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A column-level permission is a SECURITY DEFINER function, never a policy — RLS is row-level, so any policy that permits the write permits every column of it"
    - "Every gate in one statement's WHERE clause: membership, target existence and argument validity resolve together, so an unauthorized call is byte-identical to an authorized no-op and there is no existence oracle"
    - "Attribution arguments are validated against the target row's own venue, never trusted — a caller-supplied id that names a person is an id that can name someone else's person"
    - "Assign attribution, never coalesce it: carrying the previous actor forward when the current one is unknown produces a record that looks authoritative and is wrong"
    - "The release gate transcribes a matrix written BEFORE the migrations were read, so it validates intent rather than ratifying whatever the policies happen to allow"
    - "Denial is proven by a before/after service-role snapshot, not by PostgREST's zero-rows answer — the two are different claims and only the second is the guarantee"
    - "Every refusal suite carries a positive control, because a migration that revoked every grant would make all the refusals pass"

key-files:
  created:
    - "supabase/migrations/0004_rls_test_items_and_toggle_rpc.sql"
    - "tests/rls/staff-write-boundary.test.ts"
    - "tests/rls/venue-isolation-matrix.test.ts"
    - "tests/rls/rpc-abuse-matrix.test.ts"
    - "tests/rls/owner-full-access.test.ts"
    - "tests/rls/availability-toggle-edges.test.ts"
    - ".planning/phases/01-multi-tenant-foundation/01-05-PERMISSION-MATRIX.md"
  modified:
    - "actions/staff.ts"
    - "lib/validation/staff.ts"
    - "lib/database.types.ts"
    - "tests/rls/setup.ts"
    - ".planning/phases/01-multi-tenant-foundation/deferred-items.md"
    - ".planning/REQUIREMENTS.md"
  deleted: []

key-decisions:
  - "The toggle RPC is ONE UPDATE statement whose WHERE clause holds every gate, rather than a lookup followed by RAISEs. That is what makes 'no such item', 'not your venue' and 'already that value' one indistinguishable outcome — the alternative hands any signed-in principal an existence oracle for item ids across every tenant"
  - "last_toggled_by_staff_id is ASSIGNED from the argument, not coalesced with the stored value. A toggle with no staff id clears attribution rather than inheriting the previous actor, because crediting someone for an action they did not take is worse than recording nobody"
  - "The attribution id and the membership check share the same WHERE clause, so a rejected staff id fails the whole toggle closed. An implementation that validated the id separately and toggled anyway would leave the item flipped with nobody recorded — asserted explicitly in two files"
  - "`authenticated` gets SELECT + UPDATE on rls_test_items and no policy grants staff a row, so the staff denial arrives as HTTP 200 with zero rows rather than as an error. That is the intended shape and it is why every negative goes through expectWriteDenied"
  - "The matrix is data-driven over a MATRIX constant carrying each table's venue-scoping column, so `venues` (scoped by its own id) stays inside the same systematic loop instead of becoming a hand-written special case — which is where a missing negative assertion hides"
  - "Cross-venue write denial is asserted by comparing a full before/after snapshot of both venues' rows, after the first draft's weaker 'no row now holds the probe value' form produced a false failure on venue_members.role = 'owner' (a value the owner's own row legitimately holds)"
  - "The concurrency assertion is a state claim, not a timing race: two simultaneous toggles must leave availability AND the recorded actor from the SAME call, which a read-modify-write implementation would violate under interleaving. Eight rounds, no sleeps, no flake"
  - "The plan's matrix shorthand 'venue_devices: owner R/W' was asserted as R + write-via-Server-Action, matching migration 0003's explicit intent. An owner who could set revoked_at by hand would get a registry that says revoked and a tablet that still works"

patterns-established:
  - "Transcribe the contract into a constant the tests iterate, so deleting a cell means deleting a row of data rather than quietly not writing a test"
  - "Compare whole response objects, not just `error`, when asserting that two outcomes are indistinguishable — a difference in status or data leaks as well as a difference in message"
  - "Pair every positive with the same operation attempted by the narrower principal, in the same test, so an omitted negative is visible rather than absent"

requirements-completed: [ACCT-06, ACCT-07, ACCT-08]

coverage:
  - id: D37
    description: "Staff never receives a blanket UPDATE grant on any content table; the only staff write path is the narrow toggle_item_availability() RPC, which re-checks membership internally and touches only is_available and last_toggled_by_staff_id"
    requirement: "ACCT-06"
    verification:
      - kind: integration
        ref: "tests/rls/staff-write-boundary.test.ts#flips availability through toggle_item_availability and stamps who did it"
        status: pass
      - kind: integration
        ref: "tests/rls/staff-write-boundary.test.ts#refuses a direct price UPDATE from the same staff session"
        status: pass
      - kind: integration
        ref: "tests/rls/staff-write-boundary.test.ts#refuses a direct is_available UPDATE too — the RPC is the ONLY path"
        status: pass
      - kind: other
        ref: "psql: pg_policies returns exactly two policies on rls_test_items (owner ALL, member SELECT); no UPDATE-scoped staff policy exists"
        status: pass
    human_judgment: false
  - id: D38
    description: "A staff/device session's direct table UPDATE returns success-with-zero-rows and leaves the value unchanged — proven via expectWriteDenied, not by asserting an error, which RLS does not raise"
    requirement: "ACCT-06"
    verification:
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#own-venue direct writes match the transcribed matrix (5 tables, staff half always denied)"
        status: pass
      - kind: integration
        ref: "tests/rls/owner-full-access.test.ts#changes an item's price; the staff device cannot"
        status: pass
    human_judgment: false
  - id: D39
    description: "toggle_item_availability records which staff member acted: it takes p_staff_profile_id, validates it is an ACTIVE staff_profile of the item's venue, and stamps last_toggled_by_staff_id — the D-05 attribution seam lands in Phase 1"
    requirement: "ACCT-06"
    verification:
      - kind: integration
        ref: "tests/rls/staff-write-boundary.test.ts#flips availability … and stamps who did it (D-05)"
        status: pass
      - kind: integration
        ref: "tests/rls/rpc-abuse-matrix.test.ts#refuses to stamp a staff profile from another venue, and does not toggle either"
        status: pass
      - kind: integration
        ref: "tests/rls/availability-toggle-edges.test.ts#refuses to stamp a DEACTIVATED staff profile, and does not toggle either"
        status: pass
      - kind: other
        ref: "grep: actions/staff.ts::toggleItemAvailability reads decodeStaffSession(cena_staff) and passes session.staffId; the staff id appears in no Zod schema and no form field"
        status: pass
    human_judgment: false
  - id: D40
    description: "An owner can read and write all content/settings on their own venue, proven via the client SDK"
    requirement: "ACCT-07"
    verification:
      - kind: integration
        ref: "tests/rls/owner-full-access.test.ts#reads every table their venue is made of (6 assertions)"
        status: pass
      - kind: integration
        ref: "tests/rls/owner-full-access.test.ts#renames the venue / changes currency and languages / updates their own account row / changes an item's price / toggles availability directly"
        status: pass
      - kind: integration
        ref: "tests/rls/owner-full-access.test.ts#provisions and deactivates staff through the RPCs; the staff device cannot"
        status: pass
    human_judgment: false
  - id: D41
    description: "For every role x venue combination — owner A, owner B, device-staff A, device-staff B — cross-venue reads return zero rows and cross-venue writes are denied, per the explicit written matrix, through the anon key"
    requirement: "ACCT-08"
    verification:
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#cross-venue reads return zero rows for every principal x every table (5 tables x 4 principals)"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#cross-venue writes are denied for every principal x every table (before/after snapshot)"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#owner B cannot read or write owner A's account row"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#anon reaches nothing at all"
        status: pass
      - kind: other
        ref: "grep: SUPABASE_SECRET_KEY is referenced in tests/rls/setup.ts alone; no test file builds its own service-role client or signs in as one"
        status: pass
    human_judgment: false
  - id: D42
    description: "The suite asserts against an explicit, written-down role x table x operation matrix, so it validates intended behaviour rather than ratifying whatever the migrations happen to allow"
    requirement: "ACCT-08"
    verification:
      - kind: other
        ref: ".planning/phases/01-multi-tenant-foundation/01-05-PERMISSION-MATRIX.md — every cell mapped to a named assertion; the suite iterates a MATRIX constant so a deleted cell is a deleted data row, not a silently missing test"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#own-venue reads match the transcribed matrix (the positive controls)"
        status: pass
    human_judgment: false
  - id: D43
    description: "The release gate includes direct-RPC abuse: a non-owner calling provision_staff_pin/deactivate_staff_profile is denied, a non-member calling verify_staff_pin is denied, and pin_hash is not selectable by a staff principal"
    requirement: "ACCT-08"
    verification:
      - kind: integration
        ref: "tests/rls/rpc-abuse-matrix.test.ts#provision_staff_pin: only the named venue's owner (4 assertions incl. the venue's own device and another venue's device)"
        status: pass
      - kind: integration
        ref: "tests/rls/rpc-abuse-matrix.test.ts#refuses another venue's owner, and says nothing about whether the id exists (asserts identical error messages)"
        status: pass
      - kind: integration
        ref: "tests/rls/rpc-abuse-matrix.test.ts#verify_staff_pin: a non-member gets nothing but `false` (4 assertions)"
        status: pass
      - kind: integration
        ref: "tests/rls/rpc-abuse-matrix.test.ts#pin_hash is not selectable, and the name grid is the only roster view (4 assertions)"
        status: pass
      - kind: integration
        ref: "tests/rls/rpc-abuse-matrix.test.ts#the venue's own owner CAN do all of this — the refusals are targeted, not blanket"
        status: pass
    human_judgment: false
  - id: D44
    description: "Toggling availability to its current value is an idempotent no-op success, and sold-out then back to available returns the item to available"
    requirement: "ACCT-06"
    verification:
      - kind: integration
        ref: "tests/rls/availability-toggle-edges.test.ts#treats a toggle to the value already stored as a successful no-op"
        status: pass
      - kind: integration
        ref: "tests/rls/availability-toggle-edges.test.ts#86s an item and brings it back — the round trip restores availability"
        status: pass
      - kind: integration
        ref: "tests/rls/availability-toggle-edges.test.ts#is repeatable: ten alternating toggles leave the item exactly where the last one put it"
        status: pass
    human_judgment: false
  - id: D45
    description: "toggle_item_availability on a nonexistent item or an item in another venue affects zero rows and returns without a distinguishable error, so it does not leak the item's existence"
    requirement: "ACCT-06"
    verification:
      - kind: integration
        ref: "tests/rls/availability-toggle-edges.test.ts#gives a byte-identical answer for an authorized no-op, an unknown id, and another venue's item (compares the whole response object)"
        status: pass
      - kind: integration
        ref: "tests/rls/availability-toggle-edges.test.ts#leaves the other venue's item untouched while saying nothing about it"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#device A cannot toggle Venue B's item, and the RPC does not say so"
        status: pass
    human_judgment: false
  - id: D46
    description: "Two staff devices toggling the same item concurrently leave it in one of the two requested states, never a corrupt or torn value"
    requirement: "ACCT-06"
    verification:
      - kind: integration
        ref: "tests/rls/availability-toggle-edges.test.ts#leaves a single consistent state when two staff toggle the same item at once (8 rounds; asserts availability and recorded actor came from the SAME call)"
        status: pass
    human_judgment: false
  - id: D47
    description: "The full test suite runs green in a clean environment with no NEXT_PUBLIC_GOOGLE_CLIENT_ID present, so the D-25 gate does not depend on Google config"
    verification:
      - kind: integration
        ref: "pnpm exec vitest run with NEXT_PUBLIC_GOOGLE_CLIENT_ID removed from .env.local — 16 files / 151 tests pass, identical to the configured run"
        status: pass
      - kind: integration
        ref: "pnpm build in the same clean environment — succeeds, 12 routes; the One Tap component compiles and renders inertly"
        status: pass
    human_judgment: false
  - id: D48
    description: "Migration 0004 applies to a database carrying only 0001-0003, and the committed generated types match the schema as applied"
    verification:
      - kind: integration
        ref: "drop table + drop function + delete the 0004 row from schema_migrations, then `supabase migration up` — applies clean; `supabase gen types typescript --local` produces NO diff against the committed lib/database.types.ts"
        status: pass
      - kind: other
        ref: "psql: rowsecurity = t on rls_test_items; authenticated holds SELECT + UPDATE only (no INSERT, no DELETE); anon holds no SELECT/INSERT/UPDATE/DELETE; has_function_privilege(anon, toggle_item_availability, EXECUTE) = false"
        status: pass
    human_judgment: false

# Metrics
duration: 24min
completed: 2026-07-27
status: complete
---

# Phase 1 Plan 05: The Tenant + Role Isolation Release Gate Summary

**The phase's whole reason to exist, made falsifiable: a written permission matrix that four principals are driven against through the anon key across six tables and nine RPCs, plus the one piece of schema that makes the hardest cell testable — a staff write path narrow enough to be a function rather than a policy, because "availability only" is a column rule and RLS cannot express one.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-07-27T13:53Z
- **Completed:** 2026-07-27T14:17Z
- **Tasks:** 3 of 3
- **Files changed:** 11 files, +2640 / −1
- **Suite:** 151/151 green (60 inherited + 91 new), across 16 files

## Accomplishments

- **The staff carve-out is structural, not conventional, and the difference is one test.** ACCT-06 says staff may change availability and nothing else. That is a *column*-level rule and Postgres RLS is *row*-level — there is no `for update (is_available)` policy to write. Any policy permissive enough to let the tablet update the row lets it update every column of that row, and "the UI only renders a sold-out switch" is worth nothing against one `fetch` from the tablet's own devtools. So `rls_test_items` has **no staff UPDATE policy at all**, and `toggle_item_availability()` is the entire write surface a staff principal has. The assertion that makes this real is not the toggle succeeding — it is the *same session, same row* being refused a direct `update({ price: 999 })` immediately afterwards.

- **Every gate lives in one statement's WHERE clause, and that is a security property rather than a style choice.** The obvious implementation looks up the item, then raises `no such item` or `not your venue`. Implemented that way, the RPC becomes an existence oracle for item ids across every tenant on the deployment: probe an id, read which error comes back. Returning void with a membership-gated WHERE means "there is no such item", "that item is not yours" and "it is already that value" produce one outcome. `availability-toggle-edges.test.ts` asserts this by comparing the **whole response object** — data, error and status — across an authorized no-op, an unknown uuid and another venue's item, because a difference in `status` leaks exactly as well as a difference in a message.

- **The attribution argument is checked, not trusted — and checked in the same statement.** `p_staff_profile_id` is caller-supplied and it *names a person*. Left unvalidated, a tablet could stamp another restaurant's employee onto its own actions. It is validated against the item's own venue and against `deactivated_at is null`, inside the same WHERE clause as the membership check, so a rejected id fails the **whole toggle** closed. That last part has its own assertion in two files: an implementation that validated the id separately and toggled anyway would pass "the foreign profile was not stamped" and still leave the item flipped with nobody recorded as having flipped it.

- **Attribution is assigned, never coalesced.** A toggle with no staff id — an owner acting from the dashboard, or a tablet whose 30-minute identity has lapsed — clears `last_toggled_by_staff_id` rather than carrying the previous actor forward. Inheriting it would produce a record that *looks* authoritative and is wrong, which is worse than recording nobody, and it is the kind of thing that only becomes visible during an argument about who 86'd the fish.

- **The gate transcribes a matrix, and the matrix is a data structure.** `venue-isolation-matrix.test.ts` iterates a `MATRIX` constant that names, per table, its venue-scoping column and the expected visibility for the owner and for the staff device. Cross-venue reads, cross-venue writes and deletes are then loops over `tables × principals`. This is what makes "every role × venue combination" literal: `venues` — scoped by its own `id` rather than a `venue_id` — stays inside the same loop instead of becoming a hand-written special case, which is precisely where a missing negative assertion hides (RESEARCH Pitfall 2). Deleting a cell now means deleting a row of data, not quietly failing to write a test.

- **Denial is proven by what the database holds, never by what PostgREST answered.** When RLS blocks an UPDATE the row is invisible to the statement, so PostgREST returns HTTP 200 with an empty array. Every negative goes through `expectWriteDenied` (zero rows **and** an unchanged independent re-read), and the cross-venue write loop snapshots every row at both venues before and after and asserts deep equality. That last form replaced a weaker first draft, and the weaker draft is instructive — see deviation 3.

- **Nine RPCs, audited as the surface a table matrix cannot see.** A `SECURITY DEFINER` function has left RLS behind by the time its body runs, so the policies that make the table matrix green protect nothing inside it. `rpc-abuse-matrix.test.ts` calls every function in the product directly via `client.rpc`, with no application code in the path, as each of the four principals plus anon. It also asserts that `deactivate_staff_profile` returns a **byte-identical message** for a real foreign staff id and a made-up one — the property that keeps it from being an existence oracle, and one that a reader of the migration would have to take on faith.

- **Every refusal suite carries a positive control.** A migration that revoked every grant and dropped every policy would make all ~70 refusals in this phase pass. `owner-full-access.test.ts` exists so that cannot happen quietly, and each of its writes is paired with the *same write, same row, same venue* attempted by the venue's own staff device — so an omitted negative is visible rather than absent.

## Task Commits

1. **Task 1 (tracer, TDD): the narrow toggle RPC + placeholder table** — `badbd56` (test, RED) then `97aa777` (feat, GREEN)
2. **Task 2: the D-25 role × venue matrix, RPC-abuse matrix, owner-full-access, availability edges** — `27e8022` (test)
3. **Task 3: apply the schema and run the full gate** — no code delta. The migration re-applied from scratch with **zero type drift**, so there was nothing to commit; the gate's evidence is recorded under D47/D48 and in Self-Check below.

**Tracer gate:** run after the GREEN commit and before Task 2. Migration 0004 dropped and re-applied from scratch, `notify pgrst`, then the full suite — 12 files / 66 tests green, `pnpm exec tsc --noEmit` clean, `pnpm lint` clean. `human_verify_mode` is `end-of-phase` and this tracer's `<verify>` is a test run with nothing for a human to look at, so it batched into the phase-end gate rather than stopping the wave — the same handling as plans 01-02, 01-03 and 01-04.

**Plan metadata:** committed with this SUMMARY.

## Files Created/Modified

**Database**
- `supabase/migrations/0004_rls_test_items_and_toggle_rpc.sql` — `rls_test_items` (with the non-negative price CHECK and a table comment stating Phase 2 drops it); RLS enabled in the creating migration; owner-ALL and member-SELECT policies with the absent staff UPDATE policy documented as the tripwire; `toggle_item_availability()` as one gated UPDATE; explicit Data API grants (`authenticated`: SELECT + UPDATE; `anon`: nothing) and `revoke execute … from public` before the role grants

**Application**
- `actions/staff.ts` — `toggleItemAvailability`, reading the staff id from the signed `cena_staff` cookie rather than from the form
- `lib/validation/staff.ts` — `toggleItemAvailabilitySchema`, deliberately **without** a staff-id field
- `lib/database.types.ts` — regenerated; `rls_test_items` and the `toggle_item_availability` Args

**Tests** (91 new assertions)
- `tests/rls/staff-write-boundary.test.ts` — 6
- `tests/rls/venue-isolation-matrix.test.ts` — 40
- `tests/rls/rpc-abuse-matrix.test.ts` — 23
- `tests/rls/owner-full-access.test.ts` — 14
- `tests/rls/availability-toggle-edges.test.ts` — 8
- `tests/rls/setup.ts` — `createVenueFor`, `createTestItem`, `readItemAsAdmin`

**Planning**
- `.planning/phases/01-multi-tenant-foundation/01-05-PERMISSION-MATRIX.md` — the contract, the RPC authority table, and a cell → assertion map
- `.planning/phases/01-multi-tenant-foundation/deferred-items.md` — the grant finding, confirmed on a sixth table, with a sequencing recommendation
- `.planning/REQUIREMENTS.md` — ACCT-06, ACCT-07, ACCT-08 marked complete

## Decisions Made

Beyond the ones in the frontmatter:

- **`rls_test_items` carries a `price >= 0` CHECK.** Not required by the plan, but the table exists to demonstrate that price is protected, and a placeholder that accepts a negative price would demonstrate it badly.
- **No `last_toggled_at` column.** Attribution without a timestamp is arguably half an audit record, but this table is explicitly superseded by Phase 2 and the plan's column list is deliberate. Adding a column to a placeholder invites it to be carried forward by inertia.
- **`last_toggled_by_staff_id` is `ON DELETE SET NULL`.** Practically unreachable — staff deactivation is a soft delete (D-20) precisely so attribution survives — but it is the right answer if a profile is ever hard-deleted: lose the pointer, never the item.
- **`createVenueFor` was extracted into `setup.ts`.** Three test files had grown private copies of the same `create_venue` call. The shared version also keeps fixtures on the production write path rather than letting a service-role insert quietly become the setup shortcut.
- **The `venue_members` write probe writes `role: 'owner'`.** The probe value is the privilege escalation itself, so a widened grant on that table fails the test in the most alarming way available.

## Deviations from Plan

### Standing phase-01 deviations (applied per the dispatch brief)

**1. pnpm, not npm.** Every `npx vitest run` in the plan's verify blocks was read as `pnpm exec vitest run`; typechecks were `pnpm exec tsc --noEmit`, never `npx tsc`. No new dependency; `pnpm-lock.yaml` unchanged; no `package-lock.json`.
**2. `proxy.ts`, not `middleware.ts`.** Not touched by this plan.
**3. New public entities need explicit GRANTs.** Applied and verified against `information_schema.role_table_grants` rather than against the file.
**4. Never `pnpm dev`.** Verification was migration re-apply → `notify pgrst` → `gen types` → full suite → `tsc --noEmit` → `lint` → `build`.
**5. `.env.local` copied in from the main checkout**, never committed, and restored byte-for-byte after the clean-environment run.

### Blocking deviations

**6. [Rule 3 - Blocking] `supabase db reset` is refused by the environment**
- **Found during:** Task 1 — the plan makes it the first half of every task's verify block.
- **Issue:** the sandbox classifier refuses the command. It is also the wrong tool here regardless: the local stack is shared with the main checkout, so a reset would destroy another agent's state.
- **Fix:** the equivalent that exercises the same property for this plan's delta — `drop function public.toggle_item_availability`, `drop table public.rls_test_items cascade`, delete the `0004` row from `supabase_migrations.schema_migrations`, then `supabase migration up`, which applies the file from scratch against a database carrying only 0001–0003. Done **twice**: once at the tracer gate and once at the Task 3 phase gate. Followed each time by `notify pgrst, 'reload schema'` (migrations do not reload PostgREST's cache — 01-03's finding, re-confirmed) and a types regeneration that showed **no drift**.
- **Carried forward from:** 01-03 deviation 10 and 01-04 deviation 10.

### Auto-fixed issues

**7. [Rule 1 - Bug] The first cross-venue write assertion was wrong, and it failed loudly rather than quietly — which is the only reason it is a footnote**
- **Found during:** Task 2, first run of `venue-isolation-matrix.test.ts` (39/40 passing).
- **Issue:** the ground-truth check after each denied cross-venue write asserted that *no row now holds the probe value*. For `venue_members` the probe is `role = 'owner'` — and the owner's own membership row legitimately holds exactly that. The test failed on correct behaviour.
- **Why it matters beyond the fix:** the assertion was not merely wrong on one table, it was **weak on all five**. It could not catch a write that changed a row to some *third* value, and on any column whose probe value plausibly pre-exists it would have been satisfied by coincidence.
- **Fix:** snapshot every row at both venues before the write attempts and assert deep equality afterwards. Strictly stronger, and it removed the special case rather than adding one.
- **Committed in:** `27e8022`

**8. [Rule 1 - Bug] A tautological assertion in the RPC-abuse suite**
- **Issue:** the first draft of *"refuses to stamp a staff profile from another venue"* compared the item's availability against an expression derived from the item's availability. It could not fail.
- **Fix:** capture availability before the call, request the **opposite** value, and assert it is unchanged — which is what turns the test into the meaningful claim that the attribution check and the membership check share one statement.
- **Committed in:** `27e8022`

**9. [Rule 2 - Missing Critical] `venues` needed its own venue-scoping column in the matrix**
- **Issue:** the first draft assumed every table scopes by `venue_id`. `venues` scopes by its own `id`, so its whole row of the matrix errored with `column venues.venue_id does not exist`. The tempting fix is to lift `venues` out of the loop and hand-write its assertions.
- **Fix:** a `venueColumn` field on each matrix row instead. `venues` stays inside the systematic loop, which is the point — a hand-written special case is exactly where a negative assertion goes missing.
- **Committed in:** `27e8022`

### Additive items not listed in the plan

**10. [Rule 2] `01-05-PERMISSION-MATRIX.md`.** The plan puts the matrix in PLAN.md, and the dispatch's success criteria require that "the written role × venue matrix exists as a document, and **every cell is backed by an assertion**". A matrix and a suite in separate documents make that claim unverifiable by inspection, so the document carries an explicit cell → named-assertion map. It also records the two places the plan's shorthand was tightened (below).

**11. [Rule 2] Two matrix cells asserted more narrowly than the plan's shorthand, matching the migrations' stated intent**
- The plan's table says `venue_devices: owner R/W` and `staff_profiles: owner R/W (owner-manage)`. Both policies are indeed `for all` — but `authenticated` holds **no UPDATE grant** on either table, by explicit decision in migrations 0002 and 0003. Asserting the shorthand would have failed against a deliberate design, and "fixing" it by widening the grant would have undone two prior plans' reasoning:
  - `venue_devices.revoked_at` is the registry's *record* of a revocation, not the revocation. An owner who could set it by hand would get a registry that says "revoked" and a tablet that still works, because access dies from the `venue_members` DELETE and the session dies from the credential rotation.
  - `staff_profiles` carries `failed_attempts` and `locked_until`, so a direct UPDATE grant would let the D-18 backoff be reset by hand.
- Asserted as R + write-via-RPC/Server-Action, and both reasons are recorded in the matrix document rather than left as a discrepancy for a reviewer to rediscover.

**12. [Rule 2] The other-venue staff device was added as a fourth RPC-abuse principal.** `deviceB` was fixtured but initially unused (lint caught it). Rather than delete it, it now carries two assertions — a tablet in a *different restaurant on the same deployment* is the realistic version of the cross-tenant PIN-oracle attack, since it is a live session someone with physical access can drive all night.

**13. `createVenueFor`, `createTestItem`, `readItemAsAdmin` added to `tests/rls/setup.ts`.** Extending the existing harness per the dispatch, rather than each new file growing its own fixture helpers.

## Known Stubs

| Stub | File | Reason / resolving plan |
|---|---|---|
| Consent checkbox still links to `/legal/terms` and `/legal/privacy`, **neither route exists**. | `lib/copy.ts`, `app/(auth)/signup/page.tsx`, `app/(auth)/components/GoogleOneTap.tsx` | **Carried forward unresolved from 01-01, 01-02, 01-03 and 01-04.** Untouched by this plan; no plan in phase 01 builds these pages. **Fifth plan in a row — this is now the last plan of the phase, so it leaves phase 01 open and is the single item most worth escalating.** |
| `rls_test_items` is a placeholder with no UI and no owner-facing create path. | `supabase/migrations/0004_rls_test_items_and_toggle_rpc.sql` | **Intentional and explicitly scoped.** It exists so the ACCT-06 carve-out is testable before Phase 2's content schema is designed. The table comment and this plan's objective both state that Phase 2 introduces the real `items` table and **drops this one in the same migration**. Rows are created by fixtures only; `authenticated` holds no INSERT grant. |
| After a correct PIN the tablet shows "Hi, {name} — you're signed in on this tablet" and nothing else. | `app/(tablet)/components/NameGridPinPad.tsx` | Carried forward from 01-03/01-04. `toggleItemAvailability` now exists as the Server Action that surface will call, but the availability UI itself is Phase 2 (MENU-10). The boundary it will write through is proven here. |
| Sidebar nav item *Settings* still renders disabled. | `components/dashboard-nav.tsx` | 01-04's summary predicted 01-05 would flip this. **It does not** — 01-05 is a database-and-test plan with no dashboard surface, and no phase-01 plan owns a settings page. Re-logged here rather than left as a resolved-by-assumption item. |
| `anon` and `authenticated` hold `TRUNCATE`, `REFERENCES` and `TRIGGER` on every public table — now **six**. | all six public tables | Logged in `deferred-items.md` and confirmed a third time. Noted there that this instance is the strongest argument yet for fixing it: `rls_test_items` is the first table whose entire purpose is a column-level carve-out, and `TRUNCATE` does not respect RLS. Recommended as Phase 2's **first** migration, before menu tables multiply it. |

No `TODO`/`FIXME` markers were introduced, no tests are skipped, and every `<verify>` block was run with the `supabase db reset` substitution recorded as deviation 6. `.planning/WINDOWS.md` does not exist in this repo, so these entries live here only.

## Threat Flags

No new security surface. The plan's own register is fully mitigated and, unusually for this phase, every mitigation is asserted by a test rather than by a grep:

- **T-05-01** (staff blanket UPDATE grant) — no staff UPDATE policy exists (`pg_policies` returns exactly two policies, ALL and SELECT, both `authenticated`); the direct price UPDATE and the direct `is_available` UPDATE are both proven denied from the same session that successfully toggled.
- **T-05-02** (cross-venue IDOR) — 5 tables × 4 principals for reads, writes and deletes, plus `accounts` and `anon`, all through the anon key, with denial confirmed by a before/after snapshot.
- **T-05-03** (direct-RPC abuse) — every RPC in the product called directly by every principal; `has_function_privilege(anon, toggle_item_availability, EXECUTE)` is `false`, and the `revoke … from public` before each grant is what makes that true.
- **T-05-04** (toggle existence leak) — the authorized no-op, the unknown uuid and the other-venue item return byte-identical `{data, error, status}`.
- **T-05-05** (search_path hijack) — the function declares `set search_path = ''` and fully qualifies `public.rls_test_items`, `public.staff_profiles` and `private.get_venue_role`.
- **T-05-06** (false confidence from service-role testing) — `SUPABASE_SECRET_KEY` is referenced in `tests/rls/setup.ts` alone (grep across `tests/`); no test file builds its own service-role client, and no assertion is made through one.

## Issues Encountered

- **`supabase migration up` still does not reload PostgREST's schema cache.** 01-03 found it, 01-04 re-confirmed it, and it bit again here: the RED test failed with `Could not find the table 'public.rls_test_items' in the schema cache` *after* a successful apply. `notify pgrst, 'reload schema'` after every application. Worth promoting from a per-plan footnote to a documented step.
- **`psql` is not on PATH in this environment**, though prior plans' notes assume it. `docker exec supabase_db_cena psql -U postgres -d postgres -c "…"` is the working equivalent, and the container name is lowercase (`supabase_db_cena`), matching 01-04's finding about the auth container.
- **`node_modules` and `.env.local` are both absent in a fresh worktree**, as 01-03 and 01-04 also found. `pnpm install --frozen-lockfile` (lockfile unchanged) and a copy of `.env.local` from the main checkout, which is correctly gitignored and was not committed.
- **The clean-environment requirement needed a real removal, not an env-var override.** `tests/setup-env.ts` uses `process.loadEnvFile`, whose documented semantics ("existing environment variables win") are easy to reason about wrongly. Rather than assume a shell-level empty value would take precedence, `.env.local` was rewritten without the line, the absence verified by grep, the suite and the build run, and the file restored from a backup afterwards.

## User Setup Required

**None.** This plan adds no external service, no hosted-project configuration and no npm dependency.

**To run locally after merge:**
1. `pnpm install`
2. `supabase start`
3. `supabase db reset` — applies 0001 + 0002 + 0003 + 0004 + seed
4. `pnpm exec vitest run` — **151/151** should pass. This is the D-25 release gate; it must be green before any Phase 2 feature writes data.

## Next Phase Readiness

**Ready.** The phase's release gate is green and Phase 2 has a proven boundary to build on rather than an assumed one.

**Four things Phase 2 must know:**

1. **`rls_test_items` must be DROPPED by the migration that introduces the real `items` table.** It is a placeholder with no UI, no owner create path and no reason to outlive the phase that needed it. Left in place it is an unattended writable surface that nobody owns. The table comment says so; this is the second place it is written down.
2. **The toggle RPC is the template, not just an implementation.** Every future limited-role write reuses its shape: SECURITY DEFINER, `set search_path = ''`, one UPDATE whose WHERE clause carries membership, target scoping and argument validation together, returning void so unauthorized calls are indistinguishable from no-ops. A future "staff can also edit the note field" is a **new column in this function's SET list**, never a new policy.
3. **Do the grant revoke sweep first.** `deferred-items.md` now recommends it as Phase 2's opening migration. Six tables today; every menu table added before the sweep makes it larger, and `TRUNCATE` bypasses RLS.
4. **The gate is a data structure, so extend it as one.** A new tenant table means a new row in `MATRIX` in `venue-isolation-matrix.test.ts` and a new row in `01-05-PERMISSION-MATRIX.md` — at which point its cross-venue read, write and delete assertions exist automatically. Adding the table without adding the row is the failure this design is shaped to make obvious.

**Three open items:**

- **`/legal/terms` and `/legal/privacy` still do not exist.** Fifth plan in a row, and this is the phase's last plan, so it now leaves phase 01 as an open legal-facing gap rather than a deferred one.
- **The `anon`/`authenticated` TRUNCATE grant baseline** applies to six tables and will apply to every Phase 2 menu table.
- **Visual UAT remains outstanding for the phase**, unchanged by this plan, which ships no UI: 01-01's D8/D9, 01-02's D14/D16/D17, 01-03's D26/D27 and 01-04's D35/D36 all batch into the end-of-phase gate. `pnpm dev` was deliberately not run.

## Self-Check: PASSED

- All 7 created and 6 modified files listed above are present and tracked (`git ls-files`), including every entry in the plan's `files_modified`.
- All 3 task commits exist on `worktree-agent-acc3c26032ce5967a`, forked from `fa8946b`: `badbd56`, `97aa777`, `27e8022`. Task 3 produced no code delta and is documented as such.
- **Zero files were deleted** across the plan (`git diff --diff-filter=D --name-only fa8946b..HEAD` returns nothing).
- Final gate run against the schema as **APPLIED**, not as written: 0004 dropped and re-applied from scratch → `notify pgrst` → `supabase gen types typescript --local` (**no drift** — `git diff` on `lib/database.types.ts` empty) → **151/151 tests** → `pnpm exec tsc --noEmit` clean → `pnpm lint` clean → `pnpm build` succeeds (12 routes).
- The clean-environment gate was run for real: `NEXT_PUBLIC_GOOGLE_CLIENT_ID` removed from `.env.local`, absence verified by grep, **151/151** and `pnpm build` both green, file restored from backup and the restoration verified.
- Database state verified directly rather than inferred: `pg_tables.rowsecurity = t` on `rls_test_items`; `pg_policies` returns exactly two policies (owner ALL, member SELECT, both `authenticated`) and **no staff UPDATE policy**; `information_schema.role_table_grants` confirms `authenticated` holds SELECT + UPDATE only and `anon` holds no SELECT/INSERT/UPDATE/DELETE; `has_function_privilege('anon', 'public.toggle_item_availability(uuid, boolean, uuid)', 'EXECUTE')` is `false`.
- D-25's core constraint audited by grep, not by assertion: `SUPABASE_SECRET_KEY` appears in `tests/rls/setup.ts` and `tests/setup-env.ts` only; no test file constructs its own service-role client or signs in as one.
- `STATE.md` and `ROADMAP.md` were **not** modified (orchestrator-owned). `REQUIREMENTS.md` **was** updated: ACCT-06, ACCT-07 and ACCT-08 marked complete. ACCT-08 was deliberately left pending by 01-01 and 01-04 because this plan is the one that finishes it.
- Working tree clean before this SUMMARY; no `package-lock.json`; `pnpm-lock.yaml` unchanged (no new dependency); `.env.local` copied in locally, restored, and correctly untracked.

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-27*
