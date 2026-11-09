---
phase: 01-multi-tenant-foundation
plan: 12
subsystem: auth
tags: [devices, cookies, transient-faults, postgrest, server-actions, vitest, ast-guard, exhaustiveness]

# Dependency graph
requires:
  - phase: 01-multi-tenant-foundation
    provides: "01-11's tests/support/server-action-harness.ts — the (name, path) cookie jar and the next/navigation redirect sentinel"
  - phase: 01-multi-tenant-foundation
    provides: "01-10's Next-free decision module lib/device-cookie-policy.ts and its directive shape"
provides:
  - "registry-unreadable — the read fault as its own owner-unlock-exit outcome, distinct from device-not-active"
  - "A never-typed exhaustiveness assertion in deviceCookieDirectives, replacing the silent empty-list fallback"
  - "tests/actions/device-exit-classification.test.ts — the first suite to execute actions/devices.ts"
  - "tests/lib/device-cookie-outcome-coverage.test.ts — an AST-driven guard requiring every union outcome to have a caller and a test"
affects: [01-13, any phase adding an owner-unlock-exit outcome or a Server Action reading through maybeSingle()]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Destructure BOTH data and error from maybeSingle(); a null data channel carries two different facts and the error channel is what separates them"
    - "Exhaustiveness via a never-typed local rather than a default return — a plausible-looking default answer is worse than a crash"
    - "Coverage guards read the real TypeScript AST; a hard-coded list in the test is a second source of truth"
    - "A guard is observed FAILING against a deliberate break, then reverted, before it is trusted"

key-files:
  created:
    - tests/actions/device-exit-classification.test.ts
    - tests/lib/device-cookie-outcome-coverage.test.ts
  modified:
    - lib/device-cookie-policy.ts
    - actions/devices.ts
    - tests/lib/device-cookie-policy.test.ts

key-decisions:
  - "registry-unreadable is its own outcome and NOT a reuse of rotation-failed, even though the directive lists are identical — the name is what a future reader, a log line and the AST guard see, and a rotation that never ran is the wrong subsystem to send the next debugger to"
  - "The error branch is ordered ABOVE the !device branch, because maybeSingle() sets data: null alongside the error — a !device test placed first swallows the fault exactly as the shipped code did"
  - "A read fault still signs out and still redirects to /login: the idle timer fired, so the tablet is unattended with a full-privilege owner session on it (D-07). Only the tablet's IDENTITY survives"
  - "The paired contrast (fault preserves / absent row clears) is asserted in one file; neither assertion is accepted without the other, because over-preserving is the strictly worse D-08 threat"
  - "@/lib/devices is stubbed in the new action test so the rotation is observable as a call, rather than failing incidentally against an empty admin stub"

patterns-established:
  - "Server Action classification tests: real action, real codec, real policy module; only the Supabase clients and the admin-key helpers are stubbed"
  - "Deliberate-break exercise for every structural guard, with both failure messages recorded in the summary"

requirements-completed: []

coverage:
  - id: D1
    description: "A failed venue_devices read never de-enrols the tablet: the same call with a genuinely absent row still clears both cookies, so the two facts are provably distinguished"
    requirement: ACCT-05
    verification:
      - kind: unit
        ref: "tests/actions/device-exit-classification.test.ts#leaves BOTH tablet cookies untouched when the registry read faults"
        status: pass
      - kind: unit
        ref: "tests/actions/device-exit-classification.test.ts#CLEARS both cookies when the read SUCCEEDS and finds no live row"
        status: pass
    human_judgment: false
  - id: D2
    description: "The read fault is named registry-unreadable and returns an empty directive list; it is not hidden behind rotation-failed"
    verification:
      - kind: unit
        ref: "tests/lib/device-cookie-policy.test.ts#clears nothing for \"registry-unreadable\" — the read FAILED, so nothing about this browser stopped being true"
        status: pass
      - kind: other
        ref: "grep -c 'registry-unreadable' lib/device-cookie-policy.ts -> 5 (floor 2); actions/devices.ts -> 2 (floor 1)"
        status: pass
      - kind: other
        ref: "comment-stripped awk ordering gate on actions/devices.ts — read-fault branch precedes absent-row branch, exit 0 (exits 1 against unmodified source)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Repetition accumulates no damage — ten consecutive read faults leave both cookies present after every iteration (ACCT-05 idempotency-under-fault edge)"
    requirement: ACCT-05
    verification:
      - kind: unit
        ref: "tests/actions/device-exit-classification.test.ts#accumulates no damage across ten consecutive read faults"
        status: pass
    human_judgment: false
  - id: D4
    description: "The recoverable branch did not silently change the session behaviour it only meant to change the cookie behaviour of"
    verification:
      - kind: unit
        ref: "tests/actions/device-exit-classification.test.ts#still signs the caller out and still redirects to /login on a read fault"
        status: pass
      - kind: unit
        ref: "tests/actions/device-exit-classification.test.ts#never reaches the rotation on a read fault — the registry never answered"
        status: pass
      - kind: unit
        ref: "tests/actions/device-exit-classification.test.ts#proceeds into the rotation and swaps back when the read finds a live row"
        status: pass
    human_judgment: false
  - id: D5
    description: "An outcome added to the union without a case fails the typecheck; one added without a caller or a test fails the suite"
    verification:
      - kind: other
        ref: "deliberate break: pnpm exec tsc --noEmit -> lib/device-cookie-policy.ts(171,15): error TS2322: Type '\"__coverage-probe\"' is not assignable to type 'never'."
        status: pass
      - kind: unit
        ref: "tests/lib/device-cookie-outcome-coverage.test.ts — 3 tests; deliberate break named __coverage-probe as missing from both actions/devices.ts and the policy test file"
        status: pass
      - kind: other
        ref: "grep -c 'from \"typescript\"' tests/lib/device-cookie-outcome-coverage.test.ts -> 1; grep -c ': never' lib/device-cookie-policy.ts -> 1"
        status: pass
    human_judgment: false
  - id: D6
    description: "actions/devices.ts is executed by the suite for the first time, through the real injected cookie jar and the real device-cookie codec (WR-10)"
    verification:
      - kind: unit
        ref: "tests/actions/device-exit-classification.test.ts — imports exitOwnerUnlock from @/actions/devices and mints the cookie with the real encodeDeviceCookie"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-07 idle relock — the surface returns to the PIN pad with no interaction past the idle threshold"
    verification: []
    human_judgment: true
    rationale: "IdleRelock is a client-side timer; its timing behaviour is not observable by any test in this suite or by grep. Carried as a `verification: backstop` truth. This executor runs in a headless worktree with no browser."
  - id: D8
    description: "D-08 un-enrol — on a tablet whose device has been revoked, the un-enrol control clears both cookies and lands on the ordinary login page without a server-side revoke, and the three-minute sign-out loop does not resume"
    verification: []
    human_judgment: true
    rationale: "Requires a human driving a real browser against the local stack. Carried as a `verification: backstop` truth."

# Metrics
duration: 15min
completed: 2026-07-29
status: complete
---

# Phase 01 Plan 12: The Read Fault Becomes Its Own Fact Summary

**A failed `venue_devices` read no longer de-enrols the tablet — `exitOwnerUnlock` now binds the error channel it used to discard, classifies the fault as `registry-unreadable`, and leaves both cookies exactly where it found them, ten times in a row, while a read that genuinely finds no live row still clears them.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-29T11:20:00Z
- **Completed:** 2026-07-29T11:35:00Z
- **Tasks:** 2
- **Files modified:** 5 (3 modified, 2 created)

## Accomplishments

- **BLOCKER 2 closed.** `exitOwnerUnlock` read `venue_devices` with `const { data: device } = await supabase...maybeSingle()`. `maybeSingle()` resolves `data: null` for two different facts — no live registry row (terminal) and the query failed (not terminal) — so both arrived at one `if (!device)` and were classified `device-not-active`. The policy module correctly treats that as terminal and answers with deletes for BOTH cookies. The module was right; the caller handed it a fact it never observed.
- **The multiplier is what made it expensive.** `DashboardLayout` mounts `IdleRelock` for any browser holding a decodable device cookie, and that timer re-enters this path every three idle minutes. So a two-minute Supabase interruption during service did not cost one tablet — it cost every owner-unlocked tablet in the estate, each needing a person on site to sign in as the owner and re-run `/enable-staff-mode`. That inverted the rule the policy module's own header states ("never for a failure that is merely transient") and contradicted `lib/venue-authority.ts`, which refuses the identical collapse one file over, in code written during the same closure run.
- **`registry-unreadable` carries its own name.** `rotation-failed` would have produced the identical directive list and passed every behavioural test — while naming a rotation that never ran, sending the next person debugging a fleet-wide re-enrolment to the wrong subsystem, and letting the new AST guard report full coverage of a union that had quietly lost a distinction. Rejected explicitly, with the reasoning recorded on the case itself.
- **`actions/devices.ts` is executed by the suite for the first time** (WR-10), through 01-11's `createCookieJar` rather than a second cookie double — two doubles disagreeing is how a defect hides behind a green suite.
- **The union can no longer grow silently.** The trailing `return []` after the inner switch became a `never`-typed exhaustiveness assertion, and an AST-driven guard requires every outcome the type permits to appear in a call site in `actions/devices.ts` and in an enumerated case in the policy suite. Both were observed failing against a deliberate probe before being reverted.
- **303 tests across 29 files, all green.** `pnpm exec tsc --noEmit`, `pnpm build` and `pnpm lint` clean; `git diff --stat pnpm-lock.yaml` empty.

## Task Commits

1. **Task 1 (auto, tdd): The registry read fault becomes a fact with its own name** — `601b352` (fix)
2. **Task 2 (auto, tdd): An outcome can no longer be added that no caller produces and no test covers** — `f4734fc` (test)

## Files Created/Modified

- `lib/device-cookie-policy.ts` — `"registry-unreadable"` added to the `owner-unlock-exit` outcome union with its own case and rationale comment; module header rewritten (the recoverable group is now four outcomes, not three); the `device-not-active` comment corrected to say what makes it terminal (the query *answered*); the trailing `return []` replaced by the `never`-typed assertion.
- `actions/devices.ts` — the `venue_devices` read binds `error: deviceReadError`; a new branch ordered ABOVE the `!device` check classifies `registry-unreadable`, applies the (empty) directives, signs out and redirects to `/login`; the `exitOwnerUnlock` docblock updated from seven outcomes to eight, two terminal and four transient.
- `tests/lib/device-cookie-policy.test.ts` — new enumerated case for `registry-unreadable`; added to the invariants list; header updated to eight outcomes. 15 tests (plan floor: 12).
- `tests/actions/device-exit-classification.test.ts` (new) — 6 tests.
- `tests/lib/device-cookie-outcome-coverage.test.ts` (new) — 3 tests.

## RED-first observations (required evidence)

**A guard never seen failing is an assertion about a guard, not a guard.** All three observations below were produced against source that did not yet contain the corresponding fix or handler.

### Task 1 — the new action test against unmodified `actions/devices.ts`

`pnpm exec vitest run tests/actions/device-exit-classification.test.ts` → **2 failed | 4 passed (6)**.

```
FAIL > exitOwnerUnlock — a failed venue_devices read is not an absent row
     > leaves BOTH tablet cookies untouched when the registry read faults
AssertionError: expected [] to deeply equal [ …(2) ]

- [
-   {
-     "name": "cena_device_user",
-     "value": "33333333-3333-4333-8333-333333333333.6ced4fc4a5c79031ccfd460b58e189ddd873a98984d879265a8a070de5234d8a",
-   },
-   {
-     "name": "cena_staff",
-     "value": "staff-session-value-from-before-the-owner-took-over",
-   },
- ]
+ []
 ❯ tests/actions/device-exit-classification.test.ts:183:32

FAIL > exitOwnerUnlock — a failed venue_devices read is not an absent row
     > accumulates no damage across ten consecutive read faults
AssertionError: both cookies must survive attempt 1: expected [] to deeply equal [ …(2) ]
 ❯ tests/actions/device-exit-classification.test.ts:244:82
```

The repetition case failed on **attempt 1**, which is the finding stated precisely: one blip is enough, and the timer supplies the rest. The four passing tests are the paired contrast (absent row still clears), the sign-out/redirect assertions and the live-row path — all of which behave identically before and after the fix, which is exactly why they are the control.

### Task 2, probe 1 — a union member with no case

With `"__coverage-probe"` temporarily added to the `owner-unlock-exit` union:

```
lib/device-cookie-policy.ts(171,15): error TS2322: Type '"__coverage-probe"' is not assignable to type 'never'.
```

### Task 2, probe 2 — an outcome with a case but no caller and no test

With a throwaway `case "__coverage-probe": return [];` added so the typecheck passes:

`pnpm exec vitest run tests/lib/device-cookie-outcome-coverage.test.ts` → **2 failed | 1 passed (3)**.

```
AssertionError: These "owner-unlock-exit" outcomes exist in the DeviceCookieEvent union but no branch of
actions/devices.ts ever produces them:
  - "__coverage-probe"
An outcome the type permits that no caller emits is dead surface that reports itself as designed.
Either classify a branch with it, or remove it from the union.: expected [ '__coverage-probe' ] to deeply equal []

AssertionError: These "owner-unlock-exit" outcomes exist in the DeviceCookieEvent union but have no
enumerated case in tests/lib/device-cookie-policy.test.ts:
  - "__coverage-probe"
That file enumerates one test per outcome deliberately rather than looping, so an untested branch shows
up as an absent case instead of a skipped iteration.: expected [ '__coverage-probe' ] to deeply equal []
```

The probe was then reverted in full: `grep -c '__coverage-probe' lib/device-cookie-policy.ts` → 0, and after the Task 2 commit `git status --porcelain lib/device-cookie-policy.ts` prints nothing.

## Verification gate results

| Gate | Result |
|---|---|
| `pnpm exec vitest run tests/actions/device-exit-classification.test.ts` | 6 passed (plan floor: 6) |
| `pnpm exec vitest run tests/lib/device-cookie-policy.test.ts` | 15 passed (plan floor: 12) |
| `pnpm exec vitest run tests/lib/device-cookie-outcome-coverage.test.ts` | 3 passed (plan floor: 3) |
| `pnpm exec vitest run` (full suite) | 29 files, 303 tests passed |
| `pnpm exec tsc --noEmit` | exit 0, no output |
| `pnpm build` | succeeded |
| `pnpm lint` | zero problems |
| `git diff --stat pnpm-lock.yaml` | empty — no package installed |
| comment-stripped awk ordering gate on `actions/devices.ts` | exit 0 (read-fault branch precedes absent-row branch) |
| `grep -c 'registry-unreadable' lib/device-cookie-policy.ts` | 5 (floor: 2) |
| `grep -c 'registry-unreadable' actions/devices.ts` | 2 (floor: 1) |
| `grep -c 'from "next/' lib/device-cookie-policy.ts` | 0 — the module stays Next-free |
| `grep -c 'from "typescript"' tests/lib/device-cookie-outcome-coverage.test.ts` | 1 |
| `grep -c ': never' lib/device-cookie-policy.ts` | 1 |
| `git status --porcelain lib/device-cookie-policy.ts` after probe revert + commit | prints nothing |

**No suite flakiness observed.** The two timing-sensitive files flagged in the dispatch (`tests/staff/pin-verify-backoff.test.ts`, `tests/actions/venue-authority.test.ts`) passed on both full runs, first try.

## Decisions Made

- **`registry-unreadable` rather than reusing `rotation-failed`.** The directive lists are identical, so reuse would have passed every behavioural assertion. What it would have cost is the name — and the name is what a future reader, a log line and the Task 2 coverage guard actually see. An outcome named for a rotation that never ran describes something that did not happen. Merging two facts that arrive on the same `data: null` is the defect; merging them again one layer up would be the same mistake in a new place.
- **The error branch is ordered above the `!device` branch, and the comment says so.** `maybeSingle()` sets `data: null` *alongside* the error, so a `!device` test placed first swallows the fault exactly as the shipped code did. This is the whole defect in one line of control flow, and the structural gate (which strips comment lines before checking the order, and binds each line number on first match only) is what keeps the ordering from being reversed by a well-meaning refactor.
- **A read fault still signs out.** This path is reached because the idle timer fired, which means the tablet is unattended with a full-privilege owner session on it (D-07). Preserving the tablet's *identity* while dropping the session is what makes the fault free: `/unlock` still offers the swap-back, the PIN pad still knows which device it is, and nobody walks to the device. Asserted directly, so a future refactor that drops the sign-out turns the suite red. Recorded as a judgment call — if a future phase adds a genuine "retry in place" path, this is the branch to revisit.
- **The paired contrast is non-negotiable.** Over-correcting would be strictly worse than the defect: a genuinely revoked device that keeps believing it is a tablet is the D-08 lost-tablet threat. The same file asserts that a read which *succeeds* and finds no live row still clears both cookies, and neither assertion is accepted without the other.
- **`@/lib/devices` is stubbed in the new action test.** Not in the plan's mock list, but without it `rotateDevicePassword` fails incidentally against the empty admin stub and lands in `rotation-failed` — indistinguishable from `registry-unreadable` by cookies alone. Stubbing it makes the rotation observable as a call, so the live-row test asserts the branch below the fault is genuinely reached (`rotateCalls` → `[DEVICE_USER_ID]`), rotates, swaps back, keeps the device cookie and drops only the staff cookie.
- **The exhaustiveness assertion is wrapped in a block.** `const` in a bare `case` clause trips `no-case-declarations`; the block keeps `pnpm lint` clean without introducing a helper function that would put a layer between the union and the error message.
- **The coverage guard extracts literals from the AST, never from a list or a regex.** A hard-coded list in the test is a second source of truth, and two sources of truth disagreeing while both look correct is the class of defect this phase keeps hitting. The extraction is asserted to find at least eight members so a zero-match walk cannot make the following assertions vacuous — the failure mode `expectDenialError` was raised for in plan 01-10.

## Deviations from Plan

None to the plan's substance. One addition and two environment restorations:

1. **`@/lib/devices` added to the mock list** in `tests/actions/device-exit-classification.test.ts` (rationale under Decisions Made). It strengthens the live-row assertion rather than weakening any other; the device-cookie codec and the policy module both still run for real.
2. **`.env.local` did not survive worktree creation** (it is gitignored). Restored from the main checkout before the first test run, exactly as the plan's `<standing_execution_overrides>` anticipates. Not a code change.
3. **`node_modules/` was absent in the worktree.** Ran `pnpm install --frozen-lockfile`. `pnpm-lock.yaml` is byte-identical (`git diff --stat` empty), so this satisfies rather than violates the no-package-installed constraint (T-01I-SC).

## Issues Encountered

- **`const` inside a `case` clause.** The plan's literal instruction ("assign `event.outcome` to a local annotated `never`") trips ESLint's `no-case-declarations` when written directly in the clause. Resolved with a block statement around the assertion, which preserves the plan's shape and keeps the offending literal in the compiler's own error message.
- **Ordering the RED run so it could produce a signal.** Unlike 01-11, no new exports were needed by the Task 1 test, so the whole file could run against unmodified source — the two load-bearing cases failed and the four control cases passed, which is the cleanest form of this evidence: the same file demonstrates both that it can see the defect and that it does not simply fail everything.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change. `exitOwnerUnlock` is a pre-existing surface and the change strictly *narrows* what clears a cookie. No migration, no package, no component, no copy key.

## Known Stubs

None. No hardcoded empty values, placeholder copy or unwired components were introduced. The Supabase clients, `rotateDevicePassword` and the admin-client factory are stubbed **inside the new test file only** — a deliberate, documented scope boundary: the subject is which fact the action decides it is looking at, not PostgREST's or GoTrue's own behaviour. `@/lib/supabase/admin` is mocked with a factory specifically so its `import "server-only"` guard is never evaluated; that guard must not be deleted and no global alias may be added (`deferred-items.md`, WR-a).

## Outstanding human verification (backstop truths, NOT closed by this plan)

Both are carried from `01-VERIFICATION.md` and recorded in this plan's `must_haves` with `verification: backstop`. This executor runs in a headless worktree and cannot drive a browser, so **neither was exercised**.

1. **D-07 idle relock.** Unlock the tablet as the owner and leave it untouched past the idle threshold. The surface must return to the PIN pad with no interaction. `IdleRelock` is a client-side timer and its timing behaviour is not observable by grep or by any test in this suite.
2. **D-08 un-enrol.** On a tablet whose device has been revoked from the dashboard, open `/unlock` and press the un-enrol control. Both cookies must clear and the browser must land on the ordinary login page, without a server-side revoke. While there, confirm the three-minute sign-out loop does not resume.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **`ACCT-05` is deliberately NOT marked complete.** This plan resolves one concrete lifecycle edge under it — a read fault never costs a re-enrolment, and repetition of that fault accumulates no damage. The plan's `<flagged_assumptions>` records that the requirement's wider shape questions remain open (the `unclassified` probe row, row 10 of 11, tracked in `01-13-PLAN.md`'s `<probe_accounting>` table), and that a verifier who cannot confirm the wider requirement with explicit evidence must abstain to `human_needed` rather than pass it silently. `requirements-completed` is therefore `[]`.
- **Both directions of the transient-failure prohibition are now live at once.** Plan 01-10 proved a transient failure cannot brand a laptop as the tablet; this plan proves it cannot un-brand a real tablet. Neither test protects the other's direction, so the policy suite's `staff-mode-enabled` cases and this plan's read-fault cases must stay green together — they are one pair.
- **The two new guards are the reusable artifact for 01-13 and beyond.** Any phase adding an `owner-unlock-exit` outcome now has to give it a case (typecheck), a caller (AST guard) and an enumerated test (AST guard) or the gates go red. The AST-extraction shape in `tests/lib/device-cookie-outcome-coverage.test.ts` generalises to any other closed union with a caller obligation.
- **Plan 01-13 is strictly sequential after this one** and shares the single local Supabase stack.
- **Every other `maybeSingle()` in the codebase is now worth the same read.** This defect is a shape, not an incident: `revokeDevice` in the same file also destructures only `data` from a `venue_devices` read. There it collapses into a generic error message rather than a cookie deletion, so it is not the same severity and was left out of scope — but it is the next place this pattern would bite.

## Self-Check: PASSED

- `lib/device-cookie-policy.ts` — FOUND
- `actions/devices.ts` — FOUND
- `tests/lib/device-cookie-policy.test.ts` — FOUND
- `tests/actions/device-exit-classification.test.ts` — FOUND
- `tests/lib/device-cookie-outcome-coverage.test.ts` — FOUND
- commit `601b352` — FOUND
- commit `f4734fc` — FOUND

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-29*
