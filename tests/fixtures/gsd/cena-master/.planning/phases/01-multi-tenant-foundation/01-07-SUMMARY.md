---
phase: 01-multi-tenant-foundation
plan: 07
subsystem: auth
tags: [supabase, gotrue, hmac, cookies, next-server-actions, gdpr-consent, vitest]

# Dependency graph
requires:
  - phase: 01-02
    provides: "The recovery journey (app/auth/confirm route handler, reset page, completePasswordReset) and the mailbox-driven test that proves it end to end"
  - phase: 01-06
    provides: "lib/venue-authority.ts — the precedent that a security decision belongs in one shared, tested predicate rather than inline at each call site"
provides:
  - "lib/recovery-session.ts — a signed, user-bound, expiring recovery grant; the only thing that authorises a password change"
  - "lib/site-origin.ts — a pure origin resolver that never reads a request header"
  - "secure_password_change = true in supabase/config.toml (GoTrue reauthentication, as defence in depth)"
  - "A recoverable signup path when the consent RPC fails, without opening an enumeration oracle"
  - "First-version-wins consent semantics pinned by a test that reads the stored column back"
  - "tests/auth/mailbox.ts — shared real-mailbox recovery-token helper"
affects: [phase-01-08, phase-01-09, phase-01-10, password-recovery, consent-evidence, deployment-configuration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Signed, domain-prefixed, user-bound cookie grants as server-held evidence for a security decision"
    - "Pure resolver functions that take env values as parameters so the production branch is testable"
    - "Recording measured third-party behaviour in a test comment without asserting it"

key-files:
  created:
    - lib/recovery-session.ts
    - lib/site-origin.ts
    - tests/auth/recovery-gate.test.ts
    - tests/lib/site-origin.test.ts
    - tests/auth/consent-evidence.test.ts
    - tests/auth/mailbox.ts
  modified:
    - actions/auth.ts
    - app/auth/confirm/route.ts
    - app/(auth)/reset-password/page.tsx
    - app/(auth)/components/GoogleOneTap.tsx
    - lib/validation/auth.ts
    - supabase/config.toml
    - .env.example
    - tests/auth/login-reset.test.ts

key-decisions:
  - "The recovery grant is bound to a user id, not merely to 'a recovery happened' — an unbound grant would authorise a password change on whichever account the shared tablet is signed in as"
  - "The stage query parameter was deleted rather than kept alongside the real gate — two sources of truth for one security decision is how the weaker one wins"
  - "ensure_account's SQL was deliberately NOT changed to refresh the consent version; restamping would record consent to terms the owner was never shown"
  - "The production-unset origin error propagates rather than being caught, because requestPasswordReset's uniform-response property forbids adding an error branch"
  - "GoTrue's secure_password_change was measured PERMITTING an ordinary-session password change, so the app-layer gate is load-bearing rather than belt-and-braces"

patterns-established:
  - "Domain-prefixed signed cookies: a value minted for one purpose cannot be replayed as another even when both share a signing key"
  - "Injectable clock (nowSeconds parameter) so expiry is asserted at its exact boundary rather than near it"
  - "Env-derived config passed as parameters into pure resolvers, keeping the fail-loud production branch reachable from tests"

requirements-completed: [ACCT-01]

coverage:
  - id: D1
    description: "The set-new-password stage and the password write are both gated on a signed, user-bound, server-issued recovery grant that only a redeemed token can mint"
    requirement: ACCT-01
    verification:
      - kind: unit
        ref: "tests/auth/recovery-gate.test.ts#refuses a structurally valid, unexpired grant belonging to a different user"
        status: pass
      - kind: unit
        ref: "tests/auth/recovery-gate.test.ts#expires at the boundary, not one second past it"
        status: pass
      - kind: unit
        ref: "tests/auth/recovery-gate.test.ts#rejects a tampered user id"
        status: pass
      - kind: integration
        ref: "tests/auth/recovery-gate.test.ts#redeems an emailed token, sets a new password, and kills the old one"
        status: pass
    human_judgment: false
  - id: D2
    description: "The stage query parameter no longer exists anywhere in the codebase; the reset page branches only on the decoded grant cookie"
    requirement: ACCT-01
    verification:
      - kind: other
        ref: "grep -rn 'PASSWORD_RESET_STAGE' actions app lib tests -> no matches"
        status: pass
      - kind: other
        ref: "pnpm exec tsc --noEmit && pnpm build -> exit 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "The password-reset redirect origin comes from explicit configuration or a development default, never from a request header, and a production omission is a hard error"
    requirement: ACCT-01
    verification:
      - kind: unit
        ref: "tests/lib/site-origin.test.ts#throws in production when the origin is unset, naming the variable to set"
        status: pass
      - kind: unit
        ref: "tests/lib/site-origin.test.ts#ignores process.env entirely — the caller supplies both inputs"
        status: pass
      - kind: other
        ref: "grep -c 'headerList' actions/auth.ts -> 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "secure_password_change = true is applied to the local GoTrue and the legitimate recovery journey still completes under it"
    requirement: ACCT-01
    verification:
      - kind: integration
        ref: "tests/auth/login-reset.test.ts#recovers a lost password through the emailed link and signs in with the new one"
        status: pass
      - kind: other
        ref: "docker inspect supabase_auth_cena -> GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION=true"
        status: pass
    human_judgment: false
  - id: D5
    description: "ensure_account keeps the FIRST accepted consent version and its timestamp, and the calling JSDoc now says so"
    requirement: ACCT-01
    verification:
      - kind: integration
        ref: "tests/auth/consent-evidence.test.ts#keeps the FIRST accepted version when called again with a different one"
        status: pass
      - kind: integration
        ref: "tests/auth/consent-evidence.test.ts#leaves terms_accepted_at byte-identical after a second call"
        status: pass
    human_judgment: false
  - id: D6
    description: "A failed consent write is recoverable from the signup form — the RPC is retried once, and a re-submit that already holds a session for that address falls through instead of dead-ending"
    requirement: ACCT-01
    verification: []
    human_judgment: true
    rationale: "The dead-end is a browser-observable UX state across two form submissions with an induced RPC failure in between. Reproducing it under test would require injecting a transient ensure_account failure into a live Server Action, which the suite has no seam for — the RPC is called through the same client the action builds internally. The control flow is verified by inspection and by build/typecheck; whether the owner actually gets carried forward needs a human at the form."
  - id: D7
    description: "Neither /reset-password nor /reset-password?stage=set renders the choose-a-new-password form for a signed-in owner who merely types the URL"
    requirement: ACCT-01
    verification:
      - kind: unit
        ref: "tests/auth/recovery-gate.test.ts#refuses undefined, the empty string and a forged value"
        status: pass
    human_judgment: true
    rationale: "The render branch itself is a React Server Component reading next/headers cookies; the suite has no RSC render harness, and `pnpm dev` is forbidden in this execution environment. The decision function it calls is exhaustively unit-tested and the action-layer gate is independently proven, but the page's actual rendered output under a live owner session needs a browser."

# Metrics
duration: 18min
completed: 2026-07-28
status: complete
---

# Phase 01 Plan 07: Recovery Gate, Origin Hardening and Honest Consent Summary

**A signed, user-bound, 15-minute HMAC recovery grant replaces a client-supplied `?stage=set` query parameter as the sole authority for a password change, the reset-link origin stops being derived from `x-forwarded-host`, and the consent path becomes both recoverable and truthfully documented.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-28T09:00:32Z
- **Completed:** 2026-07-28T09:18:40Z
- **Tasks:** 3
- **Files modified:** 14 (6 created, 8 modified)

## Accomplishments

- **Closed a full account-takeover primitive (CR-03, T-01G-07).** `/reset-password?stage=set` rendered the change-password form for anyone who typed the URL, and `completePasswordReset` accepted any live `getUser()` result. On the D-07 shared tablet — which by design rests holding a full-privilege owner session — that combination meant anyone who walked up to the device could take the account over. Authority now comes from a signed grant only `app/auth/confirm/route.ts` can mint, and only after redeeming a real emailed token.
- **Bound the grant to a user id.** A grant that merely attested "a recovery happened" would still authorise a password change on whichever account the browser is signed in as. `assertRecoveryGrant` compares the grant's `userId` strictly against the session's own, and that case is asserted explicitly.
- **Removed the reset-link poisoning vector (WR-04, T-01G-08).** `requestOrigin()` built the redirect from `x-forwarded-host`, letting a client choose the origin of a link that then arrived pre-trusted in a real owner's inbox — and sniffed the protocol with `host.startsWith("localhost")`, which also matches `localhost.attacker.example` and downgraded that link to plain http. Both halves are gone.
- **Made a failed consent write survivable (WR-07, T-01G-12).** A stranded owner (session, no `accounts` row) could previously only fail the form forever.
- **Made three comments true.** The reset page, `ensureAccount`'s JSDoc and `GoogleOneTap`'s header each claimed a protection that did not exist. Each now states what the code actually does — including, for `ensureAccount`, a residual that is explicitly *not* closed.

## Task Commits

1. **Task 1 (tracer, TDD): The recovery gate, end to end** — `5c9c938` (feat)
2. **Task 2 (TDD): The reset redirect origin stops trusting request headers** — `8c56553` (fix)
3. **Task 3: Recoverable consent write + honest consent comments** — `546246c` (fix)

**Plan metadata:** see final `docs(01-07)` commit.

## Files Created/Modified

**Created**
- `lib/recovery-session.ts` — `RECOVERY_COOKIE_NAME`, `RECOVERY_GRANT_TTL_SECONDS` (900), `RecoveryGrant`, `encodeRecoveryGrant`, `decodeRecoveryGrant`, `assertRecoveryGrant`. HMAC-SHA256 with a `recovery` domain prefix, `timingSafeEqual` compare, injectable clock.
- `lib/site-origin.ts` — `resolveSiteOrigin({ siteUrl, nodeEnv })` and `DEVELOPMENT_SITE_ORIGIN`.
- `tests/auth/recovery-gate.test.ts` — 14 tests: codec, predicate, expiry boundary, cross-user refusal, and the full mailbox-to-new-password journey under the tightened flag.
- `tests/lib/site-origin.test.ts` — 7 tests including the production throw and a guard that the resolver ignores ambient `process.env`.
- `tests/auth/consent-evidence.test.ts` — 5 tests pinning first-version-wins, timestamp stability, blank-version refusal and cross-tenant separation.
- `tests/auth/mailbox.ts` — the real-mailbox recovery-token helper, extracted so `login-reset` and `recovery-gate` drive an identical journey.

**Modified**
- `actions/auth.ts` — grant check before `updateUser` and cookie deletion after it; `requestOrigin` deleted and replaced by `resolveSiteOrigin`; `headers` import removed; consent retry and stranded-owner fall-through in `signUpOwner`; `ensureAccount` JSDoc rewritten.
- `app/auth/confirm/route.ts` — mints the grant after redemption (`httpOnly`, `sameSite: lax`, `path: /reset-password`, `secure` in production, 15-min `maxAge`).
- `app/(auth)/reset-password/page.tsx` — branches on the decoded cookie; `searchParams` now used only for the `expired` alert.
- `app/(auth)/components/GoogleOneTap.tsx` — the "consent gates the prompt" claim replaced with the actual residual.
- `lib/validation/auth.ts` — `PASSWORD_RESET_STAGE_PARAM` / `PASSWORD_RESET_STAGE_SET` removed.
- `supabase/config.toml` — `secure_password_change = true`.
- `.env.example` — `NEXT_PUBLIC_SITE_URL` documented as required in production, with the WR-04 rationale.
- `tests/auth/login-reset.test.ts` — now imports the shared mailbox helper.

## Decisions Made

1. **Bind the grant to a user id, not just to "a recovery happened."** The unbound version would still be a takeover primitive on a shared device.
2. **Delete the stage parameter rather than keep it beside the real gate.** Two sources of truth for one security decision is how the weaker one eventually wins.
3. **Do NOT change `ensure_account`'s SQL to refresh the consent version (WR-02).** The defect was the comment, not the behaviour. Restamping would record an owner as having accepted terms they were never shown — a GDPR evidence problem, and the same class of defect as CR-04 pointed the other way. The consequence is stated plainly in the JSDoc: bumping `TERMS_VERSION` does nothing to existing owners, and a Terms change requires building a re-consent screen first. **Carried forward as a required item before any Terms bump.**
4. **Let the production origin error propagate.** `requestPasswordReset`'s uniform-response property forbids adding an error branch; catching would mean either a new distinguishable response or silently emailing a link built from nothing. A misconfigured deployment should fail at the first reset request.
5. **Record, do not assert, GoTrue's behaviour under the flag** — see "Issues Encountered" for what was measured.
6. **Retry the consent RPC exactly once.** Safe by construction (`on conflict do nothing`), and a transient blip is the difference between "signed up" and "permanently stuck".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `psql` is not installed on the host, so the migration-ledger assertion was run inside the database container**
- **Found during:** Task 1 (stack restart)
- **Issue:** The plan's acceptance criterion runs `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "select count(*) …"`. The host has no `psql` binary, so the command could not run as written — and this check is the one guarding against the restart silently discarding migrations `0001`-`0004`.
- **Fix:** Ran the identical query against the identical database via `docker exec supabase_db_cena psql …`. Also cross-checked with `supabase migration list --local`.
- **Verification:** Returns `4` both before and after the `stop`/`start` cycle. `supabase migration list --local` shows `0001`-`0004` local and remote.
- **Committed in:** `5c9c938` (no file change — verification mechanism only)

**2. [Rule 1 - Bug] The recorded-behaviour assertion was tautological**
- **Found during:** Task 1
- **Issue:** The environment-dependent GoTrue observation was written as `expect(typeof error === "object").toBe(true)`, which is true for both `null` (permitted) and an error object (refused) — it could never fail, and would have survived even an SDK change that started throwing.
- **Fix:** Narrowed to `expect(error === null || typeof error.message === "string").toBe(true)`, which still refuses to pin the environment-dependent outcome but does fail if the call resolves into neither known shape.
- **Files modified:** `tests/auth/recovery-gate.test.ts`
- **Verification:** Test still passes; the recorded value is emitted via `console.info`.
- **Committed in:** `5c9c938`

**3. [Rule 3 - Blocking] Lint failed on an unused `eslint-disable no-console` directive**
- **Found during:** Task 3 (`pnpm lint` gate)
- **Issue:** The project's ESLint config has no `no-console` rule, so the suppressing comment was itself reported as an unused directive — one warning, breaking the "zero problems" acceptance criterion.
- **Fix:** Removed the directive.
- **Files modified:** `tests/auth/recovery-gate.test.ts`
- **Verification:** `pnpm lint` now exits clean with no output.
- **Committed in:** `546246c`

### Documented divergences from the plan text (not auto-fixes)

**A. Plan-level verification step 5 (`grep -rn 'x-forwarded' actions app lib` → no matches) does not hold, by the planner's own design.**
Two matches remain, both inside explanatory comments that document the removed defect (`actions/auth.ts:240`, `lib/site-origin.ts:5`). Task 2's own acceptance criterion anticipates exactly this and supersedes it: it gates on `grep -c 'headerList' actions/auth.ts` returning `0`, noting that "the gate matches the variable name rather than the header names, so an explanatory comment cannot invalidate it." The header-reading *code* is gone; the comments explaining why are deliberately retained. `grep -c 'headerList'` returns `0`.

**B. Task 1's `<human-check>` was not performed, and neither was Task 3's.**
Both require a browser against a running dev server, and `pnpm dev` is explicitly forbidden in this execution environment (it never exits). The plan carries `autonomous: true` with no `checkpoint:*` tasks, so execution continued and both checks are carried into this SUMMARY as human-judgment coverage items **D6** and **D7** for `/gsd-verify-work`.

**C. `tests/auth/mailbox.ts` was created; it is not in the plan's file list.**
The plan said to "reuse the token-from-mailbox approach in `tests/auth/login-reset.test.ts`". That helper was file-local. Copying it would have produced two drifting definitions of the recovery journey, so it was extracted to a shared module and both files now import it. `tests/auth/login-reset.test.ts` was modified accordingly (also not in the plan's list) and still passes.

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug) + 3 documented divergences
**Impact on plan:** No scope creep. All three auto-fixes were required to satisfy the plan's own acceptance gates. Divergence A is the planner's stated intent; B is an environment constraint routed to UAT rather than skipped; C reduces duplication in a load-bearing test.

## Issues Encountered

**GoTrue's `secure_password_change = true` does not do what its name suggests, and this materially validates the plan's premise.**

After the stack restart, `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION=true` was confirmed set on the auth container. A test then drove an ordinary `signInWithPassword` session into `updateUser({ password })` and recorded the result:

```
[recovery-gate] ordinary-session updateUser under secure_password_change=true -> permitted
```

A session minted seconds earlier already satisfies GoTrue's "recently authenticated" test, so **the flag alone does not stop someone who reaches a live session from changing the password** — which is precisely the D-07 shared-tablet scenario. The plan treated the flag as defence in depth beneath the app-layer gate; that ordering turns out to be not merely prudent but necessary. The outcome is deliberately recorded rather than asserted (it is a property of whichever GoTrue build the installed CLI ships, v2.109.1 here), with a comment in the test warning any future reader against relaxing the grant check on the strength of the flag's name.

**Stack restart cost nothing.** `supabase stop` (no `--no-backup`) then `start` preserved the migration ledger at 4 and reissued identical keys, so `.env.local` needed no change.

## Known Stubs

None. No `TODO`, `FIXME`, placeholder value or skipped test was introduced. Two coverage items (**D6**, **D7**) carry `human_judgment: true` — these are unrun browser verifications, not stubs; the underlying code is complete and its decision functions are unit-tested.

## Forward Items

- **A re-consent flow does not exist and is required before any `TERMS_VERSION` bump.** Because `ensure_account` is first-version-wins by design, bumping the constant leaves every existing owner on the string they actually accepted with no way to move them. Honest re-consent needs a screen that shows the new terms and takes a fresh affirmative action. Recorded in the `ensureAccount` JSDoc and pinned by `tests/auth/consent-evidence.test.ts`.
- **T-01G-10 remains open and accepted at ASVS L1.** Any session-holder can POST `ensureAccount` and stamp a valid-looking consent row; the version check only stops a client choosing its own wording. Closing it needs a server-issued "terms presented" token minted when the terms are actually rendered. Documented in full on `ensureAccount`.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or trust-boundary schema change was introduced beyond those already enumerated in the plan's threat register. The one new cookie (`cena_recovery`) is covered by T-01G-09 and is `httpOnly`, `sameSite: lax`, path-scoped and 15-minute TTL'd.

## User Setup Required

**`NEXT_PUBLIC_SITE_URL` must be set in production before deployment.** It is the deployment's own public origin (Vercel project settings → Environment Variables), e.g. `https://cena.app`. Leaving it unset in production is now a **hard error** at the first password-reset request rather than a silent fallback — that is the WR-04 fix working as intended. Unset locally, the app uses `http://127.0.0.1:3000`. Documented in `.env.example`.

## Next Phase Readiness

- Plan 01-08 may proceed. The Supabase stack is running, the migration ledger is intact at 4, and `.env.local` matches the post-restart `supabase status` output.
- Full suite: **21 files / 206 tests passing**. `pnpm exec tsc --noEmit` exits 0, `pnpm build` succeeds, `pnpm lint` reports zero problems.
- Two browser UAT items (**D6**, **D7**) are outstanding for `/gsd-verify-work`.
- `supabase/config.toml` now carries an `[auth.*]` change. Any future plan touching that block must remember it needs a full `stop`/`start`, not a `db reset` — the note is inline in the file.

## Self-Check: PASSED

All created files verified present on disk (`lib/recovery-session.ts`, `lib/site-origin.ts`, `tests/auth/recovery-gate.test.ts`, `tests/lib/site-origin.test.ts`, `tests/auth/consent-evidence.test.ts`, `tests/auth/mailbox.ts`). All three task commits verified in `git log`: `5c9c938`, `8c56553`, `546246c`.

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-28*
