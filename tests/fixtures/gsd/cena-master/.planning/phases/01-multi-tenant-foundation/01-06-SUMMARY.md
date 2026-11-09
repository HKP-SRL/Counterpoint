---
phase: 01-multi-tenant-foundation
plan: 06
subsystem: auth
tags: [supabase, rls, postgrest, server-actions, hmac, vitest, next]

requires:
  - phase: 01-multi-tenant-foundation
    provides: "venue_members RLS policies, lib/devices.ts enrolment/revoke helpers, tests/rls/setup.ts fixture harness, the HMAC cookie codecs"
provides:
  - "lib/venue-authority.ts — resolveVenueOwner, the single tested authority predicate in front of every privileged device write and both owner-only staff pages"
  - "Server Action test coverage (tests/actions/) — the layer 151 previously-green tests did not execute"
  - "Full tamper/expiry/wrong-key coverage for both tablet HMAC cookie codecs (tests/lib/)"
affects: [device-lifecycle, staff-dashboard, tablet-session, future-owner-only-surfaces]

tech-stack:
  added: []
  patterns:
    - "Authority predicates live in Next-free lib/ modules so Vitest can execute them; Server Actions and RSC pages only call in"
    - "A read fault throws; only a resolved non-owner returns null — the two facts are never collapsed"
    - "Membership reads filter on the full unique key (venue_id, user_id), never on venue_id alone"

key-files:
  created:
    - lib/venue-authority.ts
    - tests/actions/venue-authority.test.ts
    - tests/lib/cookie-codecs.test.ts
  modified:
    - actions/devices.ts
    - app/(dashboard)/venues/[venueId]/staff/page.tsx
    - app/(dashboard)/venues/[venueId]/staff/devices/page.tsx

key-decisions:
  - "resolveVenueOwner throws on a PostgREST read fault instead of returning null — a transient failure and 'you are not the owner' are different facts, and collapsing them is the root cause of CR-01"
  - "Server Actions catch that throw and return retryable error copy; the two RSC pages deliberately do NOT catch, so a read fault becomes a 500 rather than the 404 that hid CR-01 for a whole phase"
  - "The RED test ran against a scaffold carrying the original defective query shape, so the regression cases are proven to fail against the defect before the fix landed"
  - "IN-01 (shared HMAC key, no domain separation) is pinned as the CURRENT contract rather than fixed here — the staff-into-device cross-decode asserts the composite still contains a '.' separator, with an inline note naming this as the expectation to flip when domain separation lands"

patterns-established:
  - "Authority boundary in a Next-free module: the check that gates privileged writes must be reachable from the test runner, or it is asserted by comment only"
  - "Fail-loud on infrastructure faults at an authority boundary: throw, never return the denial value"
  - "Deferral pinned by test: a recorded deferral gets an explicit assertion of today's behaviour so the day it changes shows up in a diff"

requirements-completed: [ACCT-04, ACCT-05]

coverage:
  - id: D1
    description: "resolveVenueOwner resolves the owner of a venue holding 0, 1 and 3 enrolled devices (the CR-01 regression)"
    requirement: ACCT-05
    verification:
      - kind: integration
        ref: "tests/actions/venue-authority.test.ts#resolves the owner of a venue with no enrolled devices"
        status: pass
      - kind: integration
        ref: "tests/actions/venue-authority.test.ts#still resolves the owner after ONE device is enrolled (the CR-01 regression)"
        status: pass
      - kind: integration
        ref: "tests/actions/venue-authority.test.ts#still resolves the owner with THREE devices enrolled"
        status: pass
    human_judgment: false
  - id: D2
    description: "resolveVenueOwner denies a foreign venue's owner, the venue's own staff device principal, and a client with no session"
    requirement: ACCT-05
    verification:
      - kind: integration
        ref: "tests/actions/venue-authority.test.ts#returns null for a different venue's owner"
        status: pass
      - kind: integration
        ref: "tests/actions/venue-authority.test.ts#returns null for the venue's own staff device principal"
        status: pass
      - kind: integration
        ref: "tests/actions/venue-authority.test.ts#returns null for a client with no session"
        status: pass
    human_judgment: false
  - id: D3
    description: "A PostgREST read fault throws rather than being reported to the caller as 'not an owner'"
    requirement: ACCT-05
    verification:
      - kind: unit
        ref: "tests/actions/venue-authority.test.ts#THROWS rather than returning null when the membership read faults"
        status: pass
    human_judgment: false
  - id: D4
    description: "The D-08 revoke valve works against a venue in its ordinary operating state — owner authorises, membership row is deleted, the tablet reads zero rows on its next query"
    requirement: ACCT-05
    verification:
      - kind: integration
        ref: "tests/actions/venue-authority.test.ts#keeps the D-08 revoke valve usable in the state the product is normally in"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both dashboard pages (/venues/[venueId]/staff and .../staff/devices) gate on the shared predicate — render for the owner, 404 for a foreign caller, 500 (never 404) on a read fault"
    requirement: ACCT-04
    verification:
      - kind: integration
        ref: "tests/actions/venue-authority.test.ts#pins both branches of /venues/[venueId]/staff and /venues/[venueId]/staff/devices"
        status: pass
      - kind: other
        ref: "pnpm build — both routes present in the route table"
        status: pass
    human_judgment: false
  - id: D6
    description: "An owner in a browser loads both staff surfaces at a venue with a tablet enrolled and sees the roster and the device registry with a visible revoke control, rather than a 404"
    requirement: ACCT-04
    verification: []
    human_judgment: true
    rationale: "The plan's <human-check>. The predicate's two branches are pinned by D5, but 'the page renders the roster and a visible revoke control in a real browser session' is a rendered-output judgment no test in this suite makes. Deferred to end-of-phase UAT per workflow.human_verify_mode: end-of-phase."
  - id: D7
    description: "Both tablet HMAC cookie codecs reject tampering, truncation, malformed part counts, wrong signing keys and expired sessions, and neither cross-decodes into a usable identity"
    requirement: ACCT-05
    verification:
      - kind: unit
        ref: "tests/lib/cookie-codecs.test.ts (20 cases across decodeDeviceCookie, decodeStaffSession and the two cross-cookie directions)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-28
status: complete
---

# Phase 01 Plan 06: Owner Authority and Server Action Coverage Summary

**One tested `resolveVenueOwner` predicate replaces three inline `venue_members` reads that locked the owner out of the D-08 revoke valve the moment a venue had a tablet, plus the two test files that make that layer executable at all (29 new assertions, suite 151 → 180).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-28T08:45Z
- **Completed:** 2026-07-28T08:57Z
- **Tasks:** 3
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- **CR-01 closed at the root.** Three copies of the same defective check — `venue_members` filtered on `venue_id` alone, ending in a single-row read — are now one predicate filtered on the full `(venue_id, user_id)` unique key, which makes PGRST116 unreachable rather than merely unlikely. An owner of a venue with tablets can reach the revoke control again.
- **The regression was proven, not assumed.** The enrolled-device cases were run RED against a scaffold carrying the original query shape and failed exactly as CR-01 describes (owner resolving to `null` at 1 and 3 devices, revoke valve unauthorised); only then was the fix applied.
- **The predicate now fails loud.** A PostgREST fault throws with the error code in the message. Server Actions map that onto retryable copy; both RSC pages deliberately let it reach the error boundary as a 500, because reporting a broken read as a 404 is precisely the lie CR-01 told for the whole phase.
- **WR-10 closed on both halves.** `tests/actions/` and `tests/lib/` did not exist; the authority predicate and both HMAC trust boundaries had zero direct coverage behind a 151/151 green suite. They now have 29 cases between them.

## Task Commits

1. **Task 1 (tracer): End-to-end owner authority — one predicate, one call site, one test** — `40aa6fe` (fix)
2. **Task 2: Expand the proven predicate to the two dashboard pages** — `0976c34` (fix)
3. **Task 3: Cover the two HMAC cookie codecs** — `dd49aa0` (test)

## Files Created/Modified

- `lib/venue-authority.ts` — **created.** Exports `resolveVenueOwner(supabase, venueId)`. Next-free by construction (that constraint is what makes it Vitest-reachable, and it is stated in the file header). Carries the migrated rationale for why these checks are the real boundary rather than a courtesy, plus the CR-01 post-mortem.
- `actions/devices.ts` — **modified.** Local `assertVenueOwner` deleted; `enableStaffMode` and `revokeDevice` both call the shared predicate through the caller's own RLS-scoped client, each wrapped in try/catch mapping a throw onto existing error copy. No `venue_members` read remains in the file.
- `app/(dashboard)/venues/[venueId]/staff/page.tsx` — **modified.** Inline membership read replaced; `notFound()` now fires on exactly one condition. Not wrapped in try/catch, by design, with a comment recording why.
- `app/(dashboard)/venues/[venueId]/staff/devices/page.tsx` — **modified.** Same change; the comment explaining why the role check exists at all (distinguishing "you shouldn't be here" from "you have no tablets yet") was preserved and repointed at the shared predicate.
- `tests/actions/venue-authority.test.ts` — **created.** 9 cases: 0/1/3 enrolled devices, foreign owner, staff device principal, anon client, the throw path, the D-08 revoke valve, and a page-branch case named after both routes. Devices are created by calling the production `enrollDevice`, never a re-implementation.
- `tests/lib/cookie-codecs.test.ts` — **created.** 20 cases across `cena_device_user` and `cena_staff`.

## Decisions Made

- **Throw on read fault, return null only on a resolved non-owner.** The two facts are different and collapsing them is what CR-01 was. Recorded in the code as a comment on the branch so a future simplification cannot quietly undo it.
- **Server Actions catch; RSC pages do not.** A Server Action's uncaught rejection surfaces as a generic client-side crash on a tablet mid-service, so it gets retryable copy. A page's uncaught throw becomes a 500 through the Next error boundary — which is the honest answer, and the one CR-01 withheld.
- **Distinct labels when enrolling N devices in a fixture.** `enrollDevice` supersedes an active device sharing a label, so re-using one would revoke the previous device and quietly reconstruct the single-membership-row state the test exists to move away from. The helper documents this.
- **IN-01 pinned as-is rather than fixed.** A `cena_staff` value genuinely verifies under `decodeDeviceCookie` (shared key, no type tag, and the last-dot split lands on exactly the signed payload). The test asserts the returned composite still contains a `.` — so it can never equal a bare uuid in `venue_devices.device_user_id` — and names itself as the expectation to flip when domain separation lands.

## Deviations from Plan

**1. [Rule 3 - Blocking] Reworded a doc comment so an acceptance gate could match code rather than prose**

- **Found during:** Task 1
- **Issue:** The acceptance criterion `grep -c 'maybeSingle' lib/venue-authority.ts` returns 1 was failing at 3, because the module's CR-01 post-mortem comment named the construct twice while explaining the defect. The gate was measuring prose, not the single query it was written to constrain.
- **Fix:** Reworded the two prose mentions to "a single-row read" / "the single-row read". The explanation is unchanged in substance; the file still has exactly one such call, and the gate now measures it.
- **Files modified:** `lib/venue-authority.ts`
- **Verification:** `grep -c 'maybeSingle' lib/venue-authority.ts` → 1; full acceptance set re-run green.
- **Committed in:** `40aa6fe` (Task 1 commit)

**2. [Process] The RED step needed a scaffold, because the defect was untestable where it lived**

- **Found during:** Task 1
- **Issue:** The plan asks for the enrolled-device cases to fail against the current `assertVenueOwner` shape first. That function was module-private inside a `"use server"` file importing `next/headers`, so it is unreachable from Vitest — which is the very property that let CR-01 ship. There was no way to run the new tests against it in place.
- **Fix:** `lib/venue-authority.ts` was first written as a scaffold carrying the original defective query verbatim (`venue_id` filter only), the suite was run against it, and the fix was applied only after observing the failures. The scaffold was replaced within the same task and never committed.
- **Verification:** RED run recorded 4 failures / 4 passes — the 1-device case, the 3-device case and the revoke-valve case all failed with the owner resolving to `null` (the CR-01 signature); the throw-path case failed on the stub chain shape, as expected against a single-`.eq()` module. Post-fix: 8/8, then 9/9 after Task 2.
- **Committed in:** `40aa6fe` (final state only)

---

**Total deviations:** 2 (1 blocking auto-fix, 1 process note)
**Impact on plan:** None on scope. Both concern how a gate was satisfied rather than what was built.

## Issues Encountered

None beyond the two recorded above. The local Supabase stack was already running; `.env.local` and `node_modules` were present, so no environment reconstruction was needed.

## Verification Results

| Gate | Result |
|---|---|
| `pnpm exec vitest run` (full suite) | **18 files, 180 tests passed** (was 151 before this plan's files) |
| `pnpm exec vitest run tests/actions/venue-authority.test.ts` | 9 passed |
| `pnpm exec vitest run tests/lib/cookie-codecs.test.ts` | 20 passed |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm build` | succeeds; `/venues/[venueId]/staff` and `/venues/[venueId]/staff/devices` both present in the route table |
| `pnpm lint` | zero problems |
| `grep -rn 'maybeSingle' actions/ 'app/(dashboard)'` | 6 hits, all on unique-key reads (`accounts` by `owner_user_id`, `venues` by `id`, `venue_devices` by `id`). **No `venue_members` single-row read remains anywhere.** The only two surviving `venue_members` reads (`app/(tablet)/page.tsx`, `app/(tablet)/enable-staff-mode/page.tsx`) both read lists and were already correct. |

## Known Stubs

None. No placeholder values, no skipped tests, no unrun `<verify>` blocks.

## Threat Flags

None. This plan removed surface rather than adding it; no new endpoint, auth path, file access pattern or schema change was introduced.

## Outstanding Human Verification

One item, deferred per `workflow.human_verify_mode: end-of-phase`:

> With the local stack running and a tablet enrolled at a venue, sign in as that venue's owner and load `/venues/{venueId}/staff` and `/venues/{venueId}/staff/devices`. Both must render — the roster, and the device registry with a visible revoke control — rather than the Next 404 page.

Both branches of the predicate those pages now gate on are pinned by an automated test (coverage D5); what remains unproven by automation is the rendered output in a real browser session (coverage D6).

## Next Phase Readiness

- `resolveVenueOwner` is the one place to add owner-only surfaces from here; any new owner-gated page or device write should call it rather than growing a fourth inline membership read.
- `tests/actions/` now exists as the home for Server Action-layer coverage, which plans 01-07 through 01-10 can build on.
- IN-01 (shared HMAC signing key, no domain separation between the two tablet cookies) remains an open, recorded deferral — now with a test pinning today's behaviour so the change is visible when it happens.

## Self-Check: PASSED

All three created files exist on disk; all three task commits resolve in `git log`.

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-28*
