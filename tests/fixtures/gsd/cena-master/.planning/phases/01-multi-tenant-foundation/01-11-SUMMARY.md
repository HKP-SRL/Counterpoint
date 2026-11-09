---
phase: 01-multi-tenant-foundation
plan: 11
subsystem: auth
tags: [cookies, rfc6265, next16, server-actions, route-handler, vitest, recovery, session]

# Dependency graph
requires:
  - phase: 01-multi-tenant-foundation
    provides: "01-07's signed, user-bound recovery grant (lib/recovery-session.ts, app/auth/confirm/route.ts, completePasswordReset)"
  - phase: 01-multi-tenant-foundation
    provides: "01-10's Next-free decision-module precedent (lib/device-cookie-policy.ts) and its directive shape"
provides:
  - "RECOVERY_COOKIE_PATH — one exported path constant both recovery-cookie sites are forced through"
  - "A recovery-cookie directive shape (set/clear directives + one applier) mirroring lib/device-cookie-policy.ts"
  - "tests/support/server-action-harness.ts — the project's first Server Action test harness: a browser-faithful (name, path) cookie jar and a next/navigation redirect sentinel"
  - "tests/actions/recovery-cookie-lifecycle.test.ts — the first suite in this repo to execute actions/ and app/**/route.ts"
  - "A recovery grant minted only for a redeemed type=recovery OTP"
affects: [01-12, 01-13, any phase adding a Server Action or Route Handler test]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cookie lifecycle expressed as typed directives from a Next-free module, applied by one structural applier that both production call sites and the test double satisfy"
    - "Server Action / Route Handler tests: vi.mock next/headers + next/navigation + @/lib/supabase/server, real action, real codec, browser-faithful cookie jar"
    - "A test double must be observed FAILING against the shipped defect before the fix lands"

key-files:
  created:
    - tests/support/server-action-harness.ts
    - tests/actions/recovery-cookie-lifecycle.test.ts
  modified:
    - lib/recovery-session.ts
    - actions/auth.ts
    - app/auth/confirm/route.ts

key-decisions:
  - "RECOVERY_COOKIE_PATH is ASSIGNED from PASSWORD_RESET_PATH, not re-declared — a second copy of the string is a second thing that can drift from the route"
  - "Neither recovery directive accepts a path argument; a caller-supplied path is the defect restated as an API"
  - "The cookie test double models the BROWSER (keyed on name+path), not Next's ResponseCookies map (keyed on name) — a name-keyed double passes against the exact bug it exists to catch"
  - "The opaque PKCE `code` branch at /auth/confirm mints NO grant: it cannot prove which factor was redeemed. A deployment without supabase/templates/recovery.html lands on the request stage, by design, and must not repair that by widening the mint"
  - "The mint is gated on the OTP type literal, never on the client-supplied `next` parameter (01-07 prohibition)"

patterns-established:
  - "Directive + applier for request-I/O side effects: the decision lives in a Next-free module the suite can drive, the Server Action keeps only the glue"
  - "RED-first for regression guards: the observed failure output against unmodified source is recorded in the summary, because a guard never seen failing is not a guard"
  - "Enumerate variants one test each, never a loop — a variant added without a test then shows up as an absent case"

requirements-completed: []

coverage:
  - id: D1
    description: "A completed password reset cannot be replayed: a second completePasswordReset from the same browser is refused with COPY.passwordReset.noRecoverySession and performs no redirect"
    requirement: ACCT-01
    verification:
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#REFUSES a second submission from the same browser, and does not redirect"
        status: pass
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#leaves no cena_recovery entry at ANY path — a clear that landed elsewhere is not a clear"
        status: pass
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#leaves no cena_recovery cookie visible to a request for /reset-password"
        status: pass
    human_judgment: false
  - id: D2
    description: "The mint and the clear read one RECOVERY_COOKIE_PATH; neither call site spells a path of its own"
    requirement: ACCT-01
    verification:
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#puts both sides on the same RECOVERY_COOKIE_PATH"
        status: pass
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#puts both sides on the same RECOVERY_COOKIE_NAME"
        status: pass
      - kind: other
        ref: "grep -c 'from \"next/' lib/recovery-session.ts -> 0 (module stays Next-free and Vitest-reachable)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The cookie double reproduces Next's delete normalisation, so it fails against the shipped defect rather than only against a hypothetical one"
    verification:
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#keeps a /reset-password entry alive through the STRING form of delete — the shipped defect, reproduced"
        status: pass
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#removes the entry when delete names the path it was stored at"
        status: pass
    human_judgment: false
  - id: D4
    description: "A recovery grant is minted only for a redeemed type=recovery token; every other OTP type and the opaque code exchange complete and redirect but mint nothing"
    requirement: ACCT-01
    verification:
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#mints the grant at RECOVERY_COOKIE_PATH for type=recovery, then redirects to the reset page"
        status: pass
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#mints NOTHING for type=email, and still redirects"
        status: pass
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#mints NOTHING for type=invite, and still redirects"
        status: pass
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#mints NOTHING for type=magiclink, and still redirects"
        status: pass
      - kind: unit
        ref: "tests/actions/recovery-cookie-lifecycle.test.ts#mints NOTHING for the opaque code exchange — it cannot prove which factor was redeemed"
        status: pass
    human_judgment: false
  - id: D5
    description: "The three comments at the recovery-grant sites name RECOVERY_COOKIE_PATH and the normalisation rule that makes the property hold"
    verification:
      - kind: other
        ref: "grep -B 30 'export async function completePasswordReset' actions/auth.ts | grep -c 'RECOVERY_COOKIE_PATH' -> 1"
        status: pass
      - kind: other
        ref: "grep -B 4 'recoveryGrantClearDirective()' actions/auth.ts | grep -c 'RECOVERY_COOKIE_PATH' -> 1"
        status: pass
      - kind: other
        ref: "grep -B 12 'export const RECOVERY_GRANT_TTL_SECONDS' lib/recovery-session.ts | grep -c 'RECOVERY_COOKIE_PATH' -> 1"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-07 — a signed-in owner who has NOT redeemed a recovery link sees the request stage at /reset-password and /reset-password?stage=set, never the 'Choose a new password' form"
    verification: []
    human_judgment: true
    rationale: "Requires a human driving a real browser session on the local stack. Carried as a `verification: backstop` truth in the plan; the executor runs in a worktree with no browser."
  - id: D7
    description: "The full GoTrue recovery journey with secure_password_change = true, and an updateUser password change attempted from an ordinary non-recovery password session"
    verification:
      - kind: integration
        ref: "tests/auth/recovery-gate.test.ts#records what GoTrue does to an ordinary password session under the flag (measurement, deliberately not asserted)"
        status: pass
    human_judgment: true
    rationale: "The measurement at tests/auth/recovery-gate.test.ts is load-bearing for this plan's threat model but is recorded via console.info rather than asserted, because 'recently authenticated' is a property of whichever GoTrue build the CLI ships. A human must drive the Mailpit link end to end and record the observed outcome."

# Metrics
duration: 25min
completed: 2026-07-29
status: complete
---

# Phase 01 Plan 11: Recovery Grant Single-Use Summary

**The `cena_recovery` grant is now cleared at the same (name, path) pair it was minted at, proven by driving the real `completePasswordReset` twice through a browser-faithful cookie jar — the first suite in this repository to execute anything in `actions/`.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-29T08:40:00Z
- **Completed:** 2026-07-29T09:05:29Z
- **Tasks:** 2
- **Files modified:** 5 (3 modified, 2 created)

## Accomplishments

- **BLOCKER 1 closed.** `app/auth/confirm/route.ts` wrote `cena_recovery` at `Path=/reset-password`; `completePasswordReset` cleared it with a bare `cookieStore.delete(RECOVERY_COOKIE_NAME)`. In `next@16.2.12` that desugars to `set({ name, value: "", expires: new Date(0) })` and `normalizeCookie()` then fills `path = "/"`, so the emitted `Set-Cookie` expired a *different, empty* cookie and the real grant kept riding every request to `/reset-password` for the rest of its 900s TTL — on a browser the action deliberately leaves signed in. On the D-07 shared floor tablet that is a full account takeover.
- **One `RECOVERY_COOKIE_PATH`, assigned from `PASSWORD_RESET_PATH`,** read by a set directive and a clear directive through one `applyRecoveryCookieDirective`. Neither directive takes a path argument, so the two sides cannot name different paths. `lib/recovery-session.ts` stays Next-free (`grep -c 'from "next/'` → 0) and therefore Vitest-reachable.
- **The project's first Server Action test harness.** `tests/support/server-action-harness.ts` is keyed on (name, path) as RFC 6265 requires, resolves `get()` by path-match preferring the longest match, and reproduces Next's delete desugaring exactly. It carries its own self-checks proving the string-form `delete` does NOT clear a path-scoped entry — so the double was demonstrated able to see the defect before anything leaned on it.
- **The mint narrowed (WR-01 / T-01H-02).** A grant now requires a redemption the handler established as a recovery. `type=email`, `invite`, `magiclink` and the opaque `code` exchange all still redeem and redirect, and mint nothing.
- **21 tests in the new file, 293 across the repository, all green.** `pnpm exec tsc --noEmit`, `pnpm build` and `pnpm lint` clean; `git diff --stat pnpm-lock.yaml` empty (no dependency added).

## Task Commits

1. **Task 1 (tracer, tdd): The recovery grant dies with the change it authorised** — `7e27ea2` (fix)
2. **Task 2 (auto, tdd): The grant is minted only for a redemption that was actually a recovery** — `c9be623` (fix)

## Files Created/Modified

- `lib/recovery-session.ts` — exports `RECOVERY_COOKIE_PATH`, `RecoveryCookieOptions`, `RecoveryCookieSetDirective`, `RecoveryCookieClearDirective`, `RecoveryCookieDirective`, `RecoveryCookieStore`, `recoveryGrantSetDirective`, `recoveryGrantClearDirective`, `applyRecoveryCookieDirective`. TTL comment rewritten to name the mechanism.
- `actions/auth.ts` — `completePasswordReset` clears through the applier; the docblock and the clear-site comment rewritten.
- `app/auth/confirm/route.ts` — mints through the applier; `redeemed` split into `redeemed` + `redeemedRecovery`; the `code`-branch trade-off stated in a comment naming `supabase/templates/recovery.html`.
- `tests/support/server-action-harness.ts` (new) — `createCookieJar` (`get` / `getAll` / `set` / `delete` / `entries` / `visibleTo`), `createRedirectError`, `redirectTargetOf`, `captureRedirect`.
- `tests/actions/recovery-cookie-lifecycle.test.ts` (new) — 21 tests.

## RED-first observations (required evidence)

**A guard never seen failing against the shipped defect is not a guard.** Both RED runs below were executed against the unmodified source before the corresponding fix was written.

### Task 1, Step 1 — against unmodified `actions/auth.ts`

`pnpm exec vitest run tests/actions/recovery-cookie-lifecycle.test.ts` → **3 failed | 10 passed (13)**.

```
FAIL > completePasswordReset — the grant dies with the change it authorised
     > leaves no cena_recovery cookie visible to a request for /reset-password
AssertionError: expected [ 'cena_recovery' ] to deeply equal []
  ❯ tests/actions/recovery-cookie-lifecycle.test.ts:229:54

FAIL > completePasswordReset — the grant dies with the change it authorised
     > leaves no cena_recovery entry at ANY path — a clear that landed elsewhere is not a clear
AssertionError: expected [ { name: 'cena_recovery', …(2) } ] to deeply equal []
+   {
+     "name": "cena_recovery",
+     "path": "/reset-password",
+     "value": "recovery.11111111-1111-4111-8111-111111111111.1785316243.58844648f7…",
+   },
  ❯ tests/actions/recovery-cookie-lifecycle.test.ts:235:82

FAIL > completePasswordReset — the grant dies with the change it authorised
     > REFUSES a second submission from the same browser, and does not redirect
AssertionError: expected { kind: 'redirected', …(1) } to deeply equal { kind: 'returned', state: { …(2) } }
- "kind": "returned",
- "state": { "formError": "This reset link is no longer active. Request a new one and use the newest email.", "status": "error" },
+ "kind": "redirected",
+ "target": "/venues",
  ❯ tests/actions/recovery-cookie-lifecycle.test.ts:242:20
```

The third is the blocker itself: the second `completePasswordReset` **succeeded and redirected to `/venues` a second time**, and the surviving cookie in the second failure is the grant, still at `/reset-password`, still decodable.

### Task 2 — against the un-narrowed mint in `app/auth/confirm/route.ts`

`pnpm exec vitest run tests/actions/recovery-cookie-lifecycle.test.ts` → **4 failed | 17 passed (21)**.

```
FAIL > GET /auth/confirm — a grant is minted only for a redeemed type=recovery
     > mints NOTHING for type=email, and still redirects
AssertionError: expected [ 'cena_recovery' ] to deeply equal []
  ❯ tests/actions/recovery-cookie-lifecycle.test.ts:377:33
```

The same assertion message and shape failed for `type=invite` (`:384`), `type=magiclink` (`:391`) and the opaque `code` branch (`:398`) — every one of them was minting a password-change authority.

## The three rewritten comments, verbatim

**Comment 1 — `actions/auth.ts:265-275`, the `completePasswordReset` docblock:**

```
 * HOW SINGLE-USE IS ACTUALLY HELD, because this comment used to claim it while
 * the code lacked it. The grant is cleared at `RECOVERY_COOKIE_PATH` — the same
 * exported constant the mint writes at — and neither site spells a path of its
 * own. That is load-bearing: RFC 6265 keys a cookie on (name, domain, path),
 * and Next normalises a delete with no path to "/", so a path-less clear
 * expired an empty cookie at "/" while the real grant at /reset-password kept
 * riding every request for the rest of its 900s TTL, on a browser this action
 * deliberately leaves signed in. Driving this action twice through a
 * browser-faithful cookie jar is what proves the second call is refused
 * (tests/actions/recovery-cookie-lifecycle.test.ts); do not downgrade that to a
 * mock call count.
```

**Comment 2 — `actions/auth.ts:314-318`, the clear site:**

```
  // Single-use: the grant dies with the change it authorised, so a tablet left
  // on the success screen carries nothing anyone can spend. The directive is
  // what makes that true — it clears at RECOVERY_COOKIE_PATH, the same (name,
  // path) pair the mint wrote. A bare `cookieStore.delete(name)` here silently
  // expired a different cookie at "/", because Next fills an omitted path in.
```

**Comment 3 — `lib/recovery-session.ts:36-50`, above `RECOVERY_GRANT_TTL_SECONDS`:**

```
/**
 * Fifteen minutes. Long enough to read the page, think of a password and type
 * it twice; short enough that a grant left behind on a shared tablet after the
 * owner wanders off is worthless by the time anyone else picks the device up.
 *
 * THE TTL IS THE CEILING ON AN ABANDONED FLOW, NOT ON A COMPLETED ONE — AND
 * THIS IS THE MECHANISM THAT MAKES THAT TRUE, not merely the intention.
 * `completePasswordReset` clears the cookie through `recoveryGrantClearDirective`,
 * which names `RECOVERY_COOKIE_PATH`, the same constant the mint in
 * app/auth/confirm/route.ts writes at. That matters because RFC 6265 keys a
 * cookie on (name, domain, path) and Next's `delete(name)` normalises an
 * OMITTED path to "/" — so a path-less clear expires a different, empty cookie
 * and the real grant rides on for the full 900s below. Naming the path is not
 * decoration; it is the single-use property.
 */
```

## Verification gate results

| Gate | Result |
|---|---|
| `pnpm exec vitest run tests/actions/recovery-cookie-lifecycle.test.ts` | 21 passed (plan floor: 17) |
| `pnpm exec vitest run` (full suite) | 27 files, 293 tests passed |
| `pnpm exec tsc --noEmit` | exit 0, no output |
| `pnpm build` | succeeded; `/auth/confirm` listed as ƒ (dynamic) |
| `pnpm lint` | zero problems |
| `git diff --stat pnpm-lock.yaml` | empty — no package installed |
| `grep -c 'RECOVERY_COOKIE_PATH' lib/recovery-session.ts` | 5 (floor: 3) |
| `grep -c 'RECOVERY_COOKIE_PATH' actions/auth.ts` | 2 (floor: 2; both are the rewritten comments — no code in this file names the constant) |
| `grep -B 4 'recoveryGrantClearDirective()' actions/auth.ts \| grep -c 'RECOVERY_COOKIE_PATH'` | 1 |
| `grep -B 30 'export async function completePasswordReset' actions/auth.ts \| grep -c 'RECOVERY_COOKIE_PATH'` | 1 |
| `grep -B 12 'export const RECOVERY_GRANT_TTL_SECONDS' lib/recovery-session.ts \| grep -c 'RECOVERY_COOKIE_PATH'` | 1 |
| `grep -c 'applyRecoveryCookieDirective'` in `actions/auth.ts` / `app/auth/confirm/route.ts` | 2 / 2 |
| `grep -c 'from "next/' lib/recovery-session.ts` | 0 |
| `grep -c '"recovery"' app/auth/confirm/route.ts` | 1 |
| `grep -c 'recovery.html' app/auth/confirm/route.ts` | 2 |
| `deferred-items.md` unchanged (IN-03 still deferred) | confirmed — `git diff --stat` empty |

## Decisions Made

- **`RECOVERY_COOKIE_PATH` is assigned from `PASSWORD_RESET_PATH`, not re-declared.** A second copy of the string is a second thing that can drift from the route. `lib/validation/auth` imports only `zod`, so borrowing it keeps `lib/recovery-session.ts` Next-free.
- **Neither directive takes a path argument.** A path the caller supplies is a path two callers can disagree about — which is this defect stated as an API.
- **The cookie double models the browser, not Next's response object.** Next's `ResponseCookies._parsed` is a `Map` keyed by name alone, because it represents outgoing headers. A double that copies it reports success against the exact bug it exists to catch. The jar keys on (name, path) and reproduces Next's delete desugaring; it also diverges from `normalizeCookie` in one documented place — an expired `set` *removes* the entry rather than storing an empty value, because that is what a browser does.
- **`redirect()` throwing is load-bearing.** `completePasswordReset` and `GET` both have no statement after their `redirect(...)`, so a mock that returned normally would let execution fall off the end and the test would assert a control flow the product does not have. The sentinel throws with a `NEXT_REDIRECT;<target>` digest, and `captureRedirect` re-throws anything that is not a redirect so a real error can never read as "declined to redirect".
- **The opaque `code` branch mints nothing, deliberately.** It proves a session was established, not which factor established it. A deployment that has not shipped `supabase/templates/recovery.html` lands the owner on the *request* stage of `/reset-password`. That trade is stated in a comment naming the template, so a future deployment that removes it knows what it is giving up — and must not repair it by widening the mint.
- **The mint is gated on the OTP type literal, never on `next`.** The `type` value is client-supplied, but it is used only to NARROW the mint, so a caller can only ever talk itself *out* of a grant. Consulting `next` would reintroduce the client-input-drives-security-decision prohibition 01-07 raised and `01-VERIFICATION.md` records as verified.

## Deviations from Plan

None — plan executed as written. Two environment restorations were required before any task could run, both anticipated by the plan's own standing overrides:

1. **`.env.local` did not survive worktree creation** (it is gitignored). Restored from the running local stack before the first test run, exactly as the plan's `<standing_execution_overrides>` instructs. Not a code change.
2. **`node_modules/` was absent in the worktree.** Ran `pnpm install --frozen-lockfile`. `pnpm-lock.yaml` is byte-identical (`git diff --stat` empty), so this satisfies rather than violates the "no package installed" constraint (T-01H-SC).

## Issues Encountered

- **`vi.mock` factory hoisting vs. the harness import.** `vi.mock` factories are hoisted above every import, so the `next/navigation` factory cannot close over a top-level import binding safely. Resolved by making that factory `async` and using a dynamic `await import("../support/server-action-harness")` inside it; the mutable per-test state the other two factories close over is declared with `vi.hoisted`.
- **Sequencing the RED run against exports that did not exist yet.** The directive-symmetry assertions import `RECOVERY_COOKIE_PATH` / `recoveryGrantSetDirective` / `recoveryGrantClearDirective`, which do not exist before Step 2 — a missing named export fails the whole module at link time and would have destroyed the RED signal. The Step 1 file therefore contained only the assertions that *can* run against unmodified source (13 tests, 3 red); the two symmetry tests were added with the fix in Step 2. The load-bearing replay cases were genuinely observed failing.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change was introduced. `app/auth/confirm` and `completePasswordReset` are pre-existing surfaces, and both changes strictly *narrow* them.

## Known Stubs

None. No hardcoded empty values, placeholder copy, or unwired components were introduced. GoTrue's `auth.getUser` / `updateUser` / `verifyOtp` / `exchangeCodeForSession` are stubbed **inside the new test file only** — a deliberate, documented scope boundary (T-01H-04, disposition `accept`): the subject is the cookie effect, the grant codec and gate run unmodified, and GoTrue's own behaviour is measured separately against the live stack in `tests/auth/recovery-gate.test.ts`.

## Outstanding human verification (backstop truths, NOT closed by this plan)

Both are carried from `01-VERIFICATION.md` and are recorded in this plan's `must_haves` with `verification: backstop`. This executor runs in a headless worktree and cannot drive a browser, so neither was exercised. They are `human_judgment: true` in the coverage block above.

1. **D-07 gate.** As a signed-in owner who has NOT redeemed a recovery link, navigate to `/reset-password` and to `/reset-password?stage=set`. Neither URL may render the "Choose a new password" form; both must show the request stage. **Run this BEFORE completing a reset on the same browser.**
2. **Full GoTrue recovery journey with `secure_password_change = true`.** Request a reset from `/login`, follow the Mailpit link, set a new password, land on `/venues`. Then navigate back to `/reset-password` on that same browser and confirm the set-password stage does **not** render — that is this plan's blocker, closed, observed by a human. Separately attempt an `updateUser` password change from an ordinary (non-recovery) password session and record whatever the shipped GoTrue build reports; the measurement at `tests/auth/recovery-gate.test.ts` is load-bearing for this plan's threat model.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **`tests/support/server-action-harness.ts` is the reusable artifact.** Plans 01-12 and 01-13 (and every later phase with a Server Action or Route Handler to test) should import `createCookieJar` and the redirect sentinel rather than writing a second double. The `<reversibility rating="costly">` note in the plan was about exactly this: the convention is now set.
- **`ACCT-01` is deliberately NOT marked complete.** This plan closes the recovery-replay half concretely; the plan's own `<flagged_assumptions>` records that the wider requirement's shape questions remain open and that a verifier who cannot confirm it with explicit evidence must abstain to `human_needed` rather than pass it silently. `requirements-completed` is therefore `[]`.
- **`IN-03` remains a recorded deferral.** This plan narrowed *which* OTP types mint a grant; it did not close the general unvalidated `as EmailOtpType` cast on the query parameter. `deferred-items.md` is unchanged.
- **Plans 01-12 and 01-13 are strictly sequential after this one** and share the single local Supabase stack.

## Self-Check: PASSED

- `lib/recovery-session.ts` — FOUND
- `actions/auth.ts` — FOUND
- `app/auth/confirm/route.ts` — FOUND
- `tests/support/server-action-harness.ts` — FOUND
- `tests/actions/recovery-cookie-lifecycle.test.ts` — FOUND
- commit `7e27ea2` — FOUND
- commit `c9be623` — FOUND

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-29*
