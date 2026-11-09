---
phase: 01-multi-tenant-foundation
plan: 08
subsystem: database
tags: [postgres, plpgsql, security-definer, rate-limiting, supabase, rls, vitest]

# Dependency graph
requires:
  - phase: 01-multi-tenant-foundation
    provides: "migration 0002_staff_profiles.sql — staff_profiles table, verify_staff_pin, staff_pin_lock_seconds, list_staff_for_pin and the D-18 backoff curve this plan repairs"
  - phase: 01-multi-tenant-foundation
    provides: "tests/rls/setup.ts fixture harness (typedAdmin, createSignedInOwner, createStaffDeviceMember, cleanupUsers)"
provides:
  - "migration 0005_pin_backoff_overflow.sql — replaces verify_staff_pin and staff_pin_lock_seconds without changing either signature"
  - "An int4-overflow-proof D-18 backoff: the clamp runs before the narrowing cast and the exponent is capped at 16, so no length of wrong-PIN run can make the RPC raise"
  - "staff_pin_lock_seconds scoped identically to verify_staff_pin, including the deactivated_at filter (WR-12)"
  - "Overflow-boundary regression coverage at failed_attempts 32 and 40, plus deactivated- and non-member lock-state cases"
affects: [staff-pin-auth, tablet-unlock, security-audit, phase-02-menu]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive function-replacement migrations: an applied migration is never edited; a later file re-issues `create or replace` with every attribute restated"
    - "Numeric-space clamping before a narrowing cast in plpgsql arithmetic"
    - "Fixture fast-forwarding of a rate-limit counter through typedAdmin so boundary tests do not cost hours of real backoff"

key-files:
  created:
    - supabase/migrations/0005_pin_backoff_overflow.sql
  modified:
    - tests/staff/pin-verify-backoff.test.ts

key-decisions:
  - "The D-18 backoff is now bounded TWICE — least() clamps in numeric space before the ::integer cast, AND the exponent is independently capped at 16. The second bound is redundant today and deliberately kept: it means a future edit raising c_max_lock_seconds cannot reintroduce an unbounded power."
  - "0002_staff_profiles.sql was left byte-identical. It is already recorded in supabase_migrations.schema_migrations locally and everywhere else, so editing it would make environments diverge silently while the ledger claimed they matched."
  - "Both replaced functions restate returns/language/security definer/set search_path explicitly, because `create or replace function` restates the entire definition and silently reverts any omitted attribute — a SECURITY DEFINER function quietly losing its empty search_path is a privilege-escalation hole no existing test would notice."
  - "The regression assertions check error-is-null AND counter-advanced AND lock-in-the-future together. Any one of the three passes against the pre-fix arithmetic, which is exactly how CR-02 shipped behind a green suite."

patterns-established:
  - "Applied-migration immutability: defects in a shipped migration are corrected by a new additive file, never by editing the original"
  - "Attribute restatement checklist for every `create or replace function` on a SECURITY DEFINER routine, verified against pg_proc rather than against the file"
  - "Live-catalog verification after applying a migration (pg_proc.prosecdef/proconfig, information_schema.routine_privileges) — the CLI exit code is not the evidence"

requirements-completed: [ACCT-04]

coverage:
  - id: D1
    description: "The D-18 PIN backoff keeps re-arming past the 33rd consecutive wrong entry instead of permanently disabling itself (CR-02)"
    requirement: "ACCT-04"
    verification:
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#keeps re-arming the lock at the 33rd consecutive wrong PIN (CR-02)"
        status: pass
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#still re-arms the lock far past the boundary, at the 41st wrong PIN (CR-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "verify_staff_pin never raises — a wrong PIN is indistinguishable from a missing profile or a foreign venue at every attempt count"
    requirement: "ACCT-04"
    verification:
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts — the shared `attempt` helper asserts `error` is null on every one of its calls across all 10 cases"
        status: pass
    human_judgment: false
  - id: D3
    description: "The lock is bounded at both ends: non-zero once the free attempts are spent, never above the 300s cap, and the sub-cap curve is unchanged"
    requirement: "ACCT-04"
    verification:
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#leaves the first wrong entries free, then locks with an escalating wait"
        status: pass
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#refuses even the CORRECT PIN while locked, and clears with no owner intervention"
        status: pass
    human_judgment: false
  - id: D4
    description: "staff_pin_lock_seconds hides deactivated profiles, matching verify_staff_pin and list_staff_for_pin (WR-12, D-20)"
    verification:
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#stops reporting lock state once the profile is deactivated (WR-12, D-20)"
        status: pass
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#reports no lock at all to a caller who is not a member of the venue"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both replaced functions retain SECURITY DEFINER, an empty search_path, and their original exposure in the LIVE catalog"
    verification:
      - kind: other
        ref: "psql -tAc \"select count(*) from pg_proc ... and p.prosecdef and p.proconfig @> array['search_path=\\\"\\\"']\" => 2"
        status: pass
      - kind: other
        ref: "information_schema.routine_privileges: authenticated EXECUTE => 2, anon => 0, PUBLIC => 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "Migration 0005 is applied to the live database with no type drift and 0001-0004 untouched"
    verification:
      - kind: other
        ref: "supabase migration up; supabase_migrations.schema_migrations lists 0001..0005; git diff --exit-code lib/database.types.ts exits 0; git status --porcelain supabase/migrations/0002_staff_profiles.sql empty"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-28
status: complete
---

# Phase 01 Plan 08: PIN Backoff Overflow Summary

**Migration 0005 clamps the D-18 backoff in numeric space before the `int4` cast and caps its exponent at 16, so the 33rd consecutive wrong PIN no longer raises `22003` and rolls back its own lockout write — and `staff_pin_lock_seconds` now hides deactivated profiles the way `verify_staff_pin` already did.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-28T07:22:00Z
- **Completed:** 2026-07-28T07:34:00Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **CR-02 closed.** `verify_staff_pin` computed `least(c_max_lock_seconds, (2 ^ (v_next_attempts - c_free_attempts))::integer)` — the `::integer` cast narrowed the *unclamped* power, so at the 33rd consecutive wrong entry `2 ^ 31` overflowed `int4` and raised SQLSTATE `22003`. Because the raise aborted the statement, it rolled back the very `UPDATE` that writes `failed_attempts` and `locked_until`: the counter froze at 32 and the lock was never re-armed again, leaving the throttle off while a correct PIN still returned `true`. The fix moves the cast outside `least()` and independently caps the exponent at 16.
- **WR-12 closed.** `staff_pin_lock_seconds` gained the `and sp.deactivated_at is null` predicate, so it now scopes exactly as `verify_staff_pin` does. Previously any venue member could read live lock state for a profile the owner had deactivated and `list_staff_for_pin` deliberately hides — confirming a guessed id belonged to a real profile (D-20).
- **RED-first proof.** Both boundary cases were written and run against a database whose ledger held only `0001`-`0004`, and both failed with the real defect before `0005` existed. Evidence is recorded below.
- **Live-catalog verification, not file-trust.** `pg_proc` confirms both replaced functions kept `prosecdef` and an empty `search_path`; `information_schema.routine_privileges` confirms `authenticated` holds EXECUTE on both while `anon` and `PUBLIC` hold none.
- **Suite grew 206 → 210 tests across 21 files, all passing.** `tsc --noEmit` exit 0, `pnpm build` clean, `pnpm lint` zero problems.

## Task Commits

1. **Task 1 (tracer): The backoff survives the 33rd wrong PIN** — `637fc14` (fix)
2. **Task 2: Apply migration 0005 to the live database and re-run the full gate** — no file delta by design; see below

**Plan metadata:** see the `docs(01-08)` commit that carries this file.

**Why Task 2 has no code commit.** Its only declared file was `lib/database.types.ts`, and its acceptance criterion is that regenerating it produces *no drift* — neither replaced function changed signature. `supabase gen types typescript --local > lib/database.types.ts` followed by `git diff --exit-code lib/database.types.ts` exited 0, so the correct outcome of the task is an unchanged working tree. Its real output is live database state plus the verification evidence recorded here.

## Files Created/Modified

- `supabase/migrations/0005_pin_backoff_overflow.sql` (created, 246L) — replaces `public.verify_staff_pin(uuid, uuid, text)` and `public.staff_pin_lock_seconds(uuid, uuid)`, both signatures unchanged; restates every function attribute and re-issues the `revoke public → revoke anon → grant authenticated/service_role` block for both.
- `tests/staff/pin-verify-backoff.test.ts` (modified, 6 → 10 cases) — adds a `presetCounters` fixture helper, a shared `expectBoundaryReArms` assertion, boundary cases at `failed_attempts` 32 and 40, a deactivated-profile lock-state case and a non-member lock-state case.

## RED-Run Evidence (Task 1 acceptance criterion)

Captured with `supabase_migrations.schema_migrations` holding exactly `0001`, `0002`, `0003`, `0004` — verified immediately before the run — and `0005` not yet written:

```
FAIL tests/staff/pin-verify-backoff.test.ts > keeps re-arming the lock at the 33rd consecutive wrong PIN (CR-02)
AssertionError: verify_staff_pin errored: integer out of range: expected { code: '22003', … } to be null
  Received: { "code": "22003", "details": null, "hint": null, "message": "integer out of range" }

FAIL tests/staff/pin-verify-backoff.test.ts > still re-arms the lock far past the boundary, at the 41st wrong PIN (CR-02)
AssertionError: verify_staff_pin errored: integer out of range: expected { code: '22003', … } to be null

FAIL tests/staff/pin-verify-backoff.test.ts > stops reporting lock state once the profile is deactivated (WR-12, D-20)
AssertionError: A deactivated profile still reports live lock state … expected 120 to be +0

Test Files  1 failed (1)
     Tests  3 failed | 7 passed (10)
```

The raw SQL defect reproduced independently in the same state:

```
select least(300, (2 ^ (33 - 2))::integer);   -- ERROR:  integer out of range
select least(300, 2 ^ least(16, 33 - 2))::integer;   -- 300
```

After applying `0005` and reloading the PostgREST cache, the same file ran **10 passed (10)**.

## Verification Evidence

| Check | Expected | Observed |
|---|---|---|
| `supabase migration up` + ledger | lists `0005` | `0001 0002 0003 0004 0005` |
| `git diff --exit-code lib/database.types.ts` | exit 0 | exit 0, no drift |
| `grep -v '^--' 0005 \| grep -c "search_path = ''"` | 2 | 2 |
| `grep -v '^--' 0005 \| grep -c 'security definer'` | 2 | 2 |
| `pg_proc` secdef + empty `search_path` | 2 | 2 (corrected predicate — see Deviation 2) |
| `routine_privileges` grantee `anon` | 0 | 0 |
| `routine_privileges` grantee `authenticated` EXECUTE | 2 | 2 |
| `routine_privileges` grantee `PUBLIC` | 0 | 0 (extra check, not in plan) |
| `select least(300, 2 ^ least(16, 33 - 2))::integer` | 300, no raise | 300 |
| `git status --porcelain supabase/migrations/0002_staff_profiles.sql` | empty | empty |
| `pnpm exec vitest run` | no regressions | 21 files, 210 tests, all pass (was 206) |
| `pnpm exec tsc --noEmit` | exit 0 | exit 0 |
| `pnpm build` | succeeds | succeeds |
| `pnpm lint` | zero problems | zero problems |

## Decisions Made

- **Two independent bounds instead of one.** The plan called for both moving the cast and capping the exponent, and both were kept even though either alone fixes today's defect. The exponent cap at 16 (holding the power at 65536) means the `int4` boundary cannot be reached through the exponent path at all, so raising `c_max_lock_seconds` in a future edit cannot reintroduce the overflow.
- **The grant block is restated even though `create or replace` preserves the ACL.** It is defensive rather than required; it is kept so `0005` reads as a complete statement of both functions' exposure without a reader having to hold `0002`'s grant block in their head to be sure nothing widened.
- **Fixture fast-forwarding is legitimate here.** Reaching `failed_attempts` 32 honestly costs ~1.7 hours of waiting out 300-second locks, which is precisely why the original suite never approached the boundary. `presetCounters` moves the starting line through `typedAdmin` (ground-truth mutation, not an authorization assertion — `authenticated` holds no `UPDATE` on `staff_profiles` at all), while every actual verification still runs through the device member's anon-key client.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `psql` is not installed on this host; used the database container's own client**

- **Found during:** Task 1 (first acceptance-criteria check)
- **Issue:** Every SQL acceptance criterion in the plan invokes `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`. There is no `psql` binary anywhere on this machine — not on `PATH`, not under `/opt/homebrew`, and the Supabase CLI does not vend one.
- **Fix:** Ran the identical SQL through the stack's own database container: `docker exec -i supabase_db_cena psql -U postgres -d postgres <args>`. Same server, same database, same superuser — only the transport differs (local socket rather than TCP on 54322).
- **Files modified:** None — verification transport only.
- **Verification:** The container client reproduced the plan's own predictions exactly, including the `ERROR: integer out of range` repro and the `300` result from the corrected arithmetic.
- **Committed in:** N/A (no file change)

**2. [Rule 1 - Bug] The plan's `pg_proc` acceptance predicate matches nothing, including functions this plan never touched**

- **Found during:** Task 1 (acceptance-criteria check)
- **Issue:** The criterion `p.proconfig @> array['search_path=']` returned **0**, not 2. This reads as "the replacement dropped the empty `search_path`" — a critical finding if true. It is not true. Postgres stores the setting as `search_path=""` (with literal quote characters), so the plan's array literal can never match. Confirmed by running the same predicate against the three SECURITY DEFINER functions in `0002` that this plan does **not** touch (`list_staff_for_pin`, `provision_staff_pin`, `deactivate_staff_profile`): it returns 0 for those too. The defect is in the criterion's string literal, not in migration 0005.
- **Fix:** Verified the substantive property with the corrected predicate `p.proconfig @> array['search_path=""']`, which returns **2**. Direct inspection confirms all five staff functions carry `prosecdef = t` and `proconfig = {"search_path=\"\""}` — the two replaced ones are byte-identical in this respect to the three untouched ones.
- **Files modified:** None — the migration was already correct.
- **Verification:** `select p.proname, p.prosecdef, p.proconfig::text from pg_proc …` over all five functions; corrected `count(*)` returns 2.
- **Committed in:** N/A (no file change)

**3. [Rule 2 - Missing Critical] Added a `PUBLIC` grantee check the plan did not specify**

- **Found during:** Task 2 (live-catalog verification)
- **Issue:** The plan verifies `anon` holds no EXECUTE and `authenticated` holds EXECUTE, but never checks `PUBLIC`. Since `anon` *inherits* EXECUTE from `PUBLIC`, a residual `PUBLIC` grant would leave both functions reachable by unauthenticated callers while the `anon` count still read 0 — the exact hole the `revoke … from public` ordering exists to close.
- **Fix:** Added `... where grantee='PUBLIC'` to the `routine_privileges` verification.
- **Files modified:** None — verification coverage only.
- **Verification:** Returns 0 for both functions.
- **Committed in:** N/A (no file change)

---

**Total deviations:** 3 auto-fixed (1 blocking-environment, 1 bug in a plan acceptance predicate, 1 missing critical verification)
**Impact on plan:** No scope creep and no change to the shipped artifacts. Two deviations are verification-transport or verification-coverage corrections; one identified a false-alarm acceptance criterion whose literal was wrong. Deviation 2 is worth carrying forward — the same `array['search_path=']` literal appears in the plan family and will keep producing a false critical finding until corrected to `array['search_path=""']`.

## Issues Encountered

None beyond the deviations above. The migration applied first try, PostgREST picked up the reload as expected, and no test outside `tests/staff/pin-verify-backoff.test.ts` was affected.

## Threat Flags

None. This plan replaced two existing functions without changing a signature, added no endpoint, no table, no policy and no grant that did not already exist. It **narrows** one function's visible surface (`staff_pin_lock_seconds` no longer answers for deactivated profiles) and removes an availability/elevation defect from the other.

All five threats in the plan's register are addressed:

| Threat ID | Status | Evidence |
|---|---|---|
| T-01G-15 (EoP — backoff arithmetic) | closed | Boundary cases at 32 and 40 assert null error AND counter advanced AND lock re-armed |
| T-01G-16 (DoS — contract raise) | closed | `attempt` asserts `error` is null across all 10 cases |
| T-01G-17 (Info disclosure — lock leak) | closed | Deactivated-profile case asserts 0 |
| T-01G-18 (EoP — attribute loss) | closed | `pg_proc` shows `prosecdef` + empty `search_path` on both, verified against the live catalog |
| T-01G-19 (Tampering — unapplied migration) | closed | Ledger lists `0005`; live catalog re-read rather than trusting the CLI exit code |

## Known Stubs

None. No placeholder values, no `TODO`/`FIXME`, no skipped tests, and no unrun `<verify>` block were introduced by this plan.

## User Setup Required

None — no external service configuration required. The migration applies to the existing local stack and will apply to any environment on the next `supabase migration up`.

## Next Phase Readiness

- The staff PIN path is now sound at the database layer: the backoff is bounded at both ends, the RPC never raises, and the countdown agrees with the verifier about who exists.
- **Carry forward:** the `array['search_path=']` verification literal is wrong wherever it appears in this phase's remaining plans (01-09, 01-10). Use `array['search_path=""']`.
- **Carry forward:** `psql` is not installed on this host. Use `docker exec -i supabase_db_cena psql -U postgres -d postgres` for any direct SQL in the remaining plans.
- Migration ledger now stands at `0001`-`0005`; the next new migration is `0006`.
- `actions/staff.ts` still has zero direct test coverage (a pre-existing 01-VERIFICATION finding, untouched by this plan and out of its scope).

## Self-Check: PASSED

- `supabase/migrations/0005_pin_backoff_overflow.sql` — FOUND
- `tests/staff/pin-verify-backoff.test.ts` — FOUND
- `.planning/phases/01-multi-tenant-foundation/01-08-SUMMARY.md` — FOUND
- Commit `637fc14` — FOUND in git log

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-28*
