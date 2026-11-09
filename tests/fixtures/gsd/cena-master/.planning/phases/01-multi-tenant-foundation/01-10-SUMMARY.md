---
phase: 01-multi-tenant-foundation
plan: 10
subsystem: device-lifecycle-and-test-integrity
tags: [devices, cookies, rls, test-integrity, gap-closure]
status: complete

requires:
  - lib/venue-authority.ts (01-06) — the Next-free-decision-module pattern this plan reuses
  - lib/devices.ts (01-04) — enrollDevice/revokeDeviceById, the two failure paths fixed here
  - migrations 0001-0007 — the live schema the RLS gate asserts against
provides:
  - lib/device-cookie-policy.ts — deviceCookieDirectives, the only place a device/staff cookie decision is made
  - unenrollThisBrowser — Server Action clearing a browser's tablet identity locally
  - expectDenialError — the denial-shape assertion used across the four RLS suites
affects:
  - actions/devices.ts — every cookie set/delete now flows through the policy
  - tests/rls/* — every denial branch now asserts an error shape

tech-stack:
  added: []
  patterns:
    - "Decision extraction: a defect that IS a decision moves into a Next-free module before it is fixed, so the fix is provable under Vitest rather than inferred from line ordering"
    - "Proxy-over-real-client fault injection: wrap the real admin client, stub exactly one method, delegate everything else bound to its real target"

key-files:
  created:
    - lib/device-cookie-policy.ts
    - tests/lib/device-cookie-policy.test.ts
    - tests/lib/device-failure-paths.test.ts
    - app/(tablet)/components/UnenrollBrowserButton.tsx
  modified:
    - actions/devices.ts
    - lib/devices.ts
    - lib/copy.ts
    - app/(tablet)/unlock/page.tsx
    - tests/rls/setup.ts
    - tests/rls/rpc-abuse-matrix.test.ts
    - tests/rls/venue-isolation-matrix.test.ts
    - tests/rls/venue-isolation.test.ts
    - tests/rls/staff-write-boundary.test.ts
    - .planning/phases/01-multi-tenant-foundation/deferred-items.md

decisions:
  - "The device cookie is cleared only when the browser is PROVABLY no longer this tablet — two of seven owner-unlock-exit outcomes — never for a transient failure, which would trade a logout loop for a manual re-enrolment"
  - "unenrollThisBrowser deliberately does NOT revoke server-side: the registry row stays visible and revocable from the dashboard, which is why it needs no authority check"
  - "A rotation failure inside revokeDeviceById is logged and swallowed, because both real revocation steps have already committed by the time it runs"
  - "expectDenialError accepts only 42501 and PGRST3xx; a P0001 trigger raise (venues.account_id, 01-09) is deliberately NOT routed through it and keeps its explicit assertion"

metrics:
  duration_minutes: 20
  completed: 2026-07-28
  tasks: 3
  files: 14
  tests_before: 230
  tests_after: 250
---

# Phase 01 Plan 10: Device Lifecycle and Test Integrity Gap Closure Summary

The device cookie got a lifecycle decided by a tested policy instead of by
scattered call sites, the two failure paths in `lib/devices.ts` that reported
the opposite of what happened stopped lying, and every denial branch in the D-25
release gate now asserts an error shape instead of asserting nothing.

## What Was Built

**Task 1 — `lib/device-cookie-policy.ts` (WR-05, WR-06).** Both defects were
*decisions* — whether to write the cookie, and when to clear it — living inside
`actions/devices.ts`, which imports `next/headers` and cannot be loaded under
Vitest. Proving a line moved is not proving a decision changed; that is the shape
of evidence that let CR-01 ship behind a green suite. So the decision moved into
a Next-free module first, exactly as 01-06 did for owner authority.

`deviceCookieDirectives` implements one organising rule: **a cookie is cleared
when the browser is provably no longer this tablet, and never for a failure that
is merely transient.** That is why only two of the seven `owner-unlock-exit`
outcomes are terminal (`no-device-cookie`, `device-not-active`) and three return
nothing at all (`no-session`, `rotation-failed`, `swap-back-failed`) — each of
those leaves a device whose `venue_devices` row is still active, so clearing
would cost the venue a manual re-enrolment in exchange for nothing.

`enableStaffMode` now writes the cookie only after `signInWithPassword` returns
clean; `exitOwnerUnlock`'s seven branches each classify themselves and apply what
the policy returns; `revokeDevice` clears this browser's cookies when the owner
revoked the browser they were sitting at. A new `unenrollThisBrowser` action and
a `ghost`-variant `UnenrollBrowserButton` render on both `/unlock` branches where
`deviceUserId` is non-null.

**Task 2 — the two lying failure paths (WR-08, WR-09).** `enrollDevice`'s
reconcile discarded the `deleteUser` result; the Supabase admin client returns
`{ data, error }` rather than throwing, so success and failure read identically.
It now throws a compound error naming the orphaned auth user id, the original
failure and the cleanup failure — an auth user that is a member of nothing is
invisible to every screen in the product, so that id is the only handle a human
has on it. `revokeDeviceById` now logs and continues when the defence-in-depth
rotation fails, because the membership delete and the registry stamp have both
already committed; previously the owner saw generic error copy for a fully
effective revocation and `revalidatePath` never ran, during precisely the
lost-tablet panic the feature exists for.

**Task 3 — `expectDenialError` (WR-13).** `if (error === null) { expect(...) }`
with no `else` asserts nothing when the query errors, for any reason — a typo'd
column, a renamed table, a dropped RPC and a transport failure all take the
silent path and report green. The helper asserts the error is a permission
denial (`42501` or `PGRST3xx`) and names the received code and message when it
is not. Added at all eight standalone sites plus inside `expectWriteDenied`,
whose two existing proofs are unchanged.

## Verification Evidence

| Gate | Result |
|------|--------|
| `pnpm exec vitest run` | 24 files / 250 tests passed (from 22/230 at plan start) |
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | clean; route list includes `/unlock` |
| `pnpm lint` | exit 0, zero problems |
| migrations `0001`–`0007` recorded | 7 |
| `accounts` UPDATE grant for `authenticated` | 0 |
| `venues_account_id_immutable` trigger | present (1) |
| venue value-domain CHECK constraints | 4 (language + country) |
| SECURITY DEFINER fns in `public` without empty `search_path` | 0 |

**The denial helper was observed failing, as the plan required.** One probe was
deliberately broken — `deviceA.from("staff_profiles").select("pin_hash")` renamed
to `select("pin_hash_renamed_by_a_future_migration")` — and the suite went RED
with:

```
AssertionError: the tablet selecting staff_profiles.pin_hash: the query failed,
but not with a permission denial. Received code "42703" and message "column
staff_profiles.pin_hash_renamed_by_a_future_migration does not exist". A denial
must arrive as PostgreSQL 42501 (insufficient privilege) or a PostgREST PGRST3xx
schema-permission code. Any other error means the probe itself broke — a renamed
column, a dropped RPC or a transport failure — and this assertion was proving
nothing.
```

Before this plan, that exact rename would have turned the test **green**. The
break was reverted and the file's diff confirmed to carry only the nine intended
insertions.

**Both new suites were written RED first and observed failing for the right
reason**, not merely failing:

- `device-cookie-policy.test.ts` against a stub encoding today's behaviour: the
  swap-failed case failed with `expected [ …(2) ] to deeply equal []` — i.e. a
  set-device directive existed on the failure path, which is WR-06 stated as
  behaviour; `device-not-active` failed with `expected [] to deeply equal [ …(2) ]`,
  which is WR-05.
- `device-failure-paths.test.ts` against the unfixed `lib/devices.ts`: the WR-08
  case failed with `expected 'enrollDevice: could not grant staff m…' to match
  /ceca03f5-…/` (the orphan id absent from the message), and all three WR-09
  cases failed with `Error: rotateDevicePassword: could not rotate the device
  credential: forced rotation failure` — rejecting instead of returning.

## Deviations from Plan

### 1. [Rule 1 — Acceptance criterion unsatisfiable by construction] The `awk` line-ordering gate

- **Found during:** Task 1 verification.
- **Issue:** the plan's secondary structural check
  `awk '/if \(swapError\)/{a=NR} /cookieStore.set\(DEVICE_COOKIE_NAME/{b=NR} END{exit !(b>a)}'`
  exits 1 — because after the refactor there is **no** `cookieStore.set(DEVICE_COOKIE_NAME`
  literal left in `actions/devices.ts` at all. The plan's own instruction to
  centralise the name mapping inside `applyCookieDirectives` (so a future branch
  cannot reintroduce an ad-hoc write) removes the literal the `awk` greps for.
  The two requirements are mutually exclusive.
- **Fix:** kept the centralisation — it is the stronger property — and replaced
  the gate with two checks that assert what the `awk` was proxying for:
  - `grep -c 'cookieStore.set(DEVICE_COOKIE_NAME' actions/devices.ts` returns **0**
    (no ad-hoc device cookie write exists anywhere), and the only `cookieStore.set`
    / `cookieStore.delete` in the file are the two inside `applyCookieDirectives`,
    both taking a computed `name`.
  - a scoped `awk` over `enableStaffMode` confirms `signInWithPassword` at line 172
    precedes the first `applyCookieDirectives` call at line 187 — **swap first**.
- **Why this is not a weakening:** the plan and threat register both state the
  `awk` is "retained only as a secondary structural check" behind the behavioural
  assertion. That assertion — `{ kind: "staff-mode-enabled", swapFailed: true }`
  `toEqual([])` — is green.
- **Commit:** `8bdbe78`

### 2. [Rule 3 — Blocking] Test file failed `tsc` while passing under Vitest

- **Found during:** Task 2.
- **Issue:** `await enrollDevice(...).catch(e => e as Error)` types as
  `EnrolledDevice | Error`, so six `.message` assertions failed `tsc` (TS2339)
  even though the suite was green. A spread through the `createUser` recording
  stub also failed TS2556.
- **Fix:** added a `captureThrow` helper that returns a narrowed `Error` and —
  more importantly — **throws if the call resolves**, so a path that stopped
  throwing fails the test rather than sailing through as a resolved value. Typed
  the `createUser` stub against `Parameters<typeof ...>[0]`.
- **Commit:** `87fd2a7`

### 3. [Carried-forward finding, pre-approved] `search_path` predicate and `psql`

The plan's acceptance criterion `p.proconfig @> array['search_path=']` returns
**8** — a false positive on correctly-hardened functions, because Postgres stores
the setting as `search_path=""`. Used the corrected literal
`array['search_path=""']`, which returns **0**. This is the third phase-01 plan
to confirm it (01-08, 01-09, 01-10). `psql` is not installed on this host, so all
catalog checks ran via `docker exec -i supabase_db_cena psql -U postgres -d postgres`.

### 4. [Scope note] `deferred-items.md` heading count

The plan's check `grep -c '^### '` on the file counts headings across the **whole**
file, which already carried two from earlier plans. The new section
`## From the phase 01 code review (2026-07-27)` carries exactly **9** entries as
required (IN-01..IN-06, WR-a, IN-a, the legal-routes decision), verified with an
`awk` scoped to that section.

## Interaction with 01-09, Handled as Instructed

The `accounts` UPDATE denials now arrive as `42501` from 01-09's revoked grant
and pass `expectDenialError` cleanly. The `venues.account_id` denial arrives as a
`P0001` trigger raise, which is deliberately **not** a permission denial — it was
left with 01-09's explicit assertion and not routed through the helper, exactly as
the plan directed. No site turned red for having a denial code outside the
permission class, so no investigation was needed. All of 01-09's inverted
assertions in these four files were preserved.

## Known Stubs

None. No hardcoded empty values, placeholder text or unwired components were
introduced.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or schema change at
a trust boundary was introduced. `unenrollThisBrowser` is the only new reachable
surface and is already carried in the plan's register as **T-01G-31 (Information
Disclosure, low, disposition: accept)** — it clears cookies and signs out, grants
nothing, and does not revoke server-side.

## HUMAN VERIFICATION REQUIRED — two items, neither closed by this plan

Both are `backstop` truths in the plan. This executor has no browser, so neither
was exercised; they are surfaced, not claimed.

**(1) SC1 — the full owner self-serve journey.** In a browser against the local
stack, with no developer assistance: sign up at `/signup` with email, password
and the Terms checkbox; create a venue picking RON, then repeat for HUF and EUR;
confirm country and timezone auto-derive for RON and HUF, stay blank for EUR, and
remain overridable; sign out; log back in at `/login`; confirm the venue is still
listed and the switcher appears only from the second venue onward. Then request a
password reset and follow the Mailpit link to the set-password stage.
**EXPECTED AND NOT A REGRESSION:** the Terms and Privacy links 404 — `/legal/terms`
and `/legal/privacy` are a recorded deferral (see `deferred-items.md`).

**(2) D-07 — idle relock.** Unlock the tablet as the owner, leave it past the idle
threshold, confirm it returns to the PIN surface with no interaction. `IdleRelock`
is a client-side timer whose timing behaviour no test in this suite can observe.

**(3) Task 1's own human-check, also unexercised.** On an enrolled tablet browser
whose device has been revoked from the dashboard, open `/unlock`: the un-enrol
control must be visible, and pressing it must land on `/login` and stop the
repeated three-minute sign-outs. Separately confirm the normal enrolment flow
still reaches the PIN grid, and that an owner signed in normally on their own
laptop is never signed out for going idle.

## Self-Check: PASSED

All four created files exist on disk; all three commits resolve in `git log`.
No tracked file was deleted by any commit. The only untracked path in the tree is
`.vscode/`, which predates this plan.
