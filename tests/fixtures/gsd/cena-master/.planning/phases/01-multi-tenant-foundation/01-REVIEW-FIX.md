---
phase: 01-multi-tenant-foundation
fixed_at: 2026-08-04T17:02:00Z
review_path: .planning/phases/01-multi-tenant-foundation/01-REVIEW.md
iteration: 1
findings_in_scope: 18
fixed: 18
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-08-04
**Source review:** `.planning/phases/01-multi-tenant-foundation/01-REVIEW.md`
**Iteration:** 1
**Scope:** `all` — Critical (2), Warning (8) and Info (8)

**Summary:**
- Findings in scope: 18
- Fixed: 18
- Skipped: 0

## Verification gate

Run in an isolated worktree (`/tmp/sv-01-reviewfix-aGBfyq`, branch
`gsd-reviewfix/01-19060`) after the last fix commit.

**Typecheck** — `pnpm exec tsc --noEmit`:

```
TSC_EXIT=0
```

(no output, exit 0)

**Full suite** — `pnpm exec vitest run`:

```
 RUN  v4.1.10 /private/tmp/sv-01-reviewfix-aGBfyq

 Test Files  47 passed (47)
      Tests  462 passed (462)
   Start at  17:00:16
   Duration  48.45s (transform 472ms, setup 130ms, import 2.67s, tests 40.76s, environment 1.26s)
```

Neither of the two known-flaky files (`tests/staff/pin-verify-backoff.test.ts`,
`tests/actions/venue-authority.test.ts`) failed, so no re-run was needed.

Net test count moved from 445 to 462 — 17 new assertions added by these fixes,
none removed.

**Lint** — `pnpm lint`:

```
/private/tmp/sv-01-reviewfix-aGBfyq/tests/actions/staff-actions.test.ts
  34:15  warning  'CookieJar' is defined but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```

Pre-existing — confirmed present at `7ff13d2`
(`git show 7ff13d2:tests/actions/staff-actions.test.ts` line 34), untouched by
this pass.

Each fix was additionally verified in isolation before its commit, and the three
fixes whose regression tests could plausibly have been vacuous were checked by
temporarily reverting the source change and confirming the new test went red
(WR-07, WR-08; CR-01's two new tests are unreachable without the `onError`
handler and the `throw`, by construction).

## Fixed Issues

### CR-01: Ticking consent with GSI unavailable produced an empty section with no error

**Files modified:** `app/(auth)/components/GoogleOneTap.tsx`,
`tests/auth/google-affordance.test.tsx`
**Commit:** `8becf83`

`startOneTap`'s `if (!clientId || !window.google) return` and
`if (!container) return` now throw instead of returning — a normal return
*resolves* the promise, so the effect's `.catch` never ran and the owner was left
with an empty container. `<Script>` gained `onError={() => setError(...)}` for the
bundle that never arrives at all. `if (!clientId) return` is the one silent return
left, and is annotated as inert-by-configuration.

The `next/script` mock was made outcome-switchable (`scriptState.outcome`) so the
blocked-bundle path is reachable from a test for the first time, and two
regression tests were added: one driving `onError`, one deleting `window.google`.

### CR-02: The device registry reported a read fault as "No devices enrolled"

**Files modified:** `lib/venue-page-read.ts`,
`app/(dashboard)/venues/[venueId]/staff/devices/page.tsx`,
`app/(dashboard)/venues/[venueId]/staff/page.tsx`,
`tests/lib/venue-page-read.test.ts`
**Commit:** `4f1ec2d`

Added the `resolveVenueRows` sibling the review suggested, rather than an inline
`if (error) throw` repeated twice — same argument that module's own header makes
for the single-row case, and it keeps the discipline testable without a renderer
or a database. Both list reads (`venue_devices` and `staff_profiles`) now go
through it. Six tests added, including the ordering assertion that stops a future
edit reinstating the defect by moving the `data` test above the `error` test.

### WR-01: `isVenueIdSegment` inert in the switcher; its test asserted an attribute nothing sets

**Files modified:** `app/(dashboard)/components/venue-switcher-menu.tsx`,
`tests/lib/create-venue-affordance.test.tsx`
**Commit:** `4af7dfd`

Took the first branch of the review's either/or: the switcher now gives the
current venue a real treatment (`aria-current="true"` on the matching row), which
is what makes the existing `aria-current` assertion capable of failing. Added the
positive control — deliberately `TWO_VENUES[1]`, not `[0]`, so it cannot be
satisfied by the `?? venues[0]` fallback — asserting both the trigger label and
that exactly one row is marked. The switcher's comment was also corrected to say
the predicate is defensive here rather than load-bearing, which is the honest
reading.

### WR-02: `VenueSwitcherMenu` dereferenced `active.name` with no empty-list guard

**Files modified:** `app/(dashboard)/components/venue-switcher-menu.tsx`,
`tests/lib/create-venue-affordance.test.tsx`
**Commit:** `b0b722e`

`if (!active) return null;` plus an explicit `SwitchableVenue | undefined`
annotation, with a test rendering `venues={[]}`. Chose the runtime guard over the
non-empty tuple type because the prop is consumed from a Server Component that
builds the array from a query, where a tuple type would only move the assertion.

### WR-03: The unconditional "Create venue" link was shown to device and staff principals

**Files modified:** `app/(dashboard)/layout.tsx`, `actions/venues.ts`,
`lib/copy.ts`, `tests/actions/create-venue-action.test.ts`
**Commit:** `a0795d5`

**Adapted, not applied verbatim — the review's literal fix has two defects.**
`redirect("/tablet")` names a route that does not exist (the tablet surface is
`/`, via the `(tablet)` route group). And redirecting on `!account` alone creates
an infinite loop: `app/(tablet)/page.tsx` sends any principal *without* a staff
membership straight back to `/venues`, so a signed-in owner with no accounts row —
precisely the state WR-07 describes — would ping-pong forever.

Implemented instead: read `accounts` (error channel bound, throws per CR-02's
rule); if absent, read `venue_members` and redirect to `/` only when a `staff`
membership is present. A device or staff principal always has one, so `/` renders
for them and the loop is structurally impossible. A half-provisioned owner falls
through and keeps the shell, which is where they can still be recovered. The link
itself was not touched — a condition around it would reopen G-01-7.

Also added `COPY.errors.accountSetupIncomplete` and used it for `createVenue`'s
no-account branch, replacing `COPY.errors.generic`, which described a permanent
authorization refusal as a transient fault. The pinning test was updated and
strengthened with an inequality assertion so it cannot silently regress to
`generic`.

### WR-04: The CTA guard's binding check accepted a same-named import from any module

**Files modified:** `tests/lib/unconditional-cta-coverage.test.ts`
**Commit:** `371ca27`

Added `from` to `CtaRow`, checked the module specifier in the import branch of
`constantIsBound`, declared `from: "@/lib/venue-routes"` on the layout row, and
added the third guard-of-the-guard fixture: same identifier, wrong module,
expected `matched: false`.

### WR-05: The headline G-01-12 assertion was satisfied by a permanently-disabled button

**Files modified:** `tests/auth/google-affordance.test.tsx`
**Commit:** `ed30b96`

Retitled assertion #1 to "renders a PRE-CONSENT control…" and added the
post-consent structural test: container mounted, `renderButton` called into it,
and no error banner — "surface OR explanation, never neither", which is the
strongest honest claim available where Google's own button cannot render. The
file header's numbered list was updated to describe both states.

### WR-06: `lib/copy.ts` forward-referenced a reconciliation that already ran and declined

**Files modified:** `lib/copy.ts`
**Commit:** `22ebebd`

All three blocks now point at `01-UAT.md` `## Copywriting Contract — additions
from the gap round`, which is verified on disk as the live record. The file
header's own "diff this against 01-UI-SPEC.md" premise was also qualified, since
it was false for six strings and nothing said so.

### WR-07: `error` was never cleared; the `ensureAccount` branch stranded a signed-in owner

**Files modified:** `app/(auth)/components/GoogleOneTap.tsx`,
`tests/auth/google-affordance.test.tsx`
**Commit:** `d7f75df`

**Adapted.** The review's `setError(null)` at the top of `startOneTap` is exactly
what `react-hooks/set-state-in-effect` rejects — the component's own comment says
so. The obvious alternative, clearing in a `.then` on the effect's promise, was
implemented, tested, and **rejected on evidence**: it clears on *success*, so it
silently wipes the sign-in and consent errors the credential callback sets later,
which broke a test in a way that revealed the flaw. The error is now cleared on
the consent checkbox's `onCheckedChange` — a real event handler, lint-safe, and
the exact moment the previous outcome stops describing anything.

The `ensureAccount` failure branch now surfaces
`COPY.errors.accountSetupIncomplete` instead of `generic`, naming the signed-in-
but-unrecorded state and giving the one action that resolves it.

Two tests added. Also fixed a latent hazard the work surfaced: the file's
`useRouter` mock minted a fresh object per render, unlike Next's stable router,
which made `startOneTap`'s `useCallback` identity churn and re-run the effect —
so every `toHaveBeenCalledTimes(1)` in the file was measuring re-render count
rather than the property it claimed.

### WR-08: Unchecking every menu language left the form in an unsubmittable state

**Files modified:** `components/venue-form.tsx`,
`tests/venues/venue-form-languages.test.tsx` (new)
**Commit:** `6f48037`

`toggleLanguage` refuses the last uncheck (`if (next.length === 0) return;`), the
`?? ""` fallback is gone, and the checkbox for the sole remaining language is
disabled so the refusal is visible rather than a dead click. New test file with
four cases, two of which are controls (initial multi-language state; the
second-to-last uncheck still works) so the refusal cannot pass vacuously against
a form whose checkboxes do nothing.

### IN-01: Header said "TWO THINGS" and enumerated three

**Files modified:** `app/(auth)/components/GoogleOneTap.tsx`
**Commit:** `35be340`

### IN-02 / IN-03: Phantom `enabledFrom` field; shadowed `segment`

**Files modified:** `components/dashboard-nav.tsx`
**Commit:** `941dc5b`

References renamed to `enabled` (the field that exists), with a note recording
what the name used to be; the outer binding renamed to `pathSegment` so it no
longer collides with the `NAV_ITEMS` row's own `segment`.

### IN-04: `isVenueIdSegment("")` unreachable from both call sites

**Files modified:** `lib/venue-routes.ts`, `tests/lib/venue-routes.test.ts`
**Commit:** `6c24815`

Reworded to "defensive: no current caller can produce it, because both extract
with `[^/]+`", in both the predicate and the test that reads as coverage of a
live path. The branch was kept.

### IN-05: The CTA detector stopped at the first matching href

**Files modified:** `tests/lib/unconditional-cta-coverage.test.ts`
**Commit:** `5527c42`

`analyse` now collects every occurrence; `blockingAncestor` is null the moment
one is unconditional, and the conditional ones are reported through a new
`conditionalOccurrences` field as context rather than as failures. Two fixtures
added: a file whose *first* occurrence is conditional but which also has a plain
one (must pass — this was the false positive), and one where every occurrence is
conditional (must still fail — collecting all matches must not soften the guard).

### IN-06 / IN-07: Dead assertion; magic 15ms sleeps

**Files modified:** `tests/venues/second-venue-route.test.ts`
**Commit:** `ef19a1d`

Dropped the unreachable `expect(target).not.toBeNull()` and kept the inner throw,
which is the branch that actually carries the returned state into the failure
message. The five sleeps became a named `CREATED_AT_TIE_BREAK_MS` behind a
`tieBreak()` helper carrying the reasoning once.

### IN-08: `formatEnrolledAt` threw on an unparseable timestamp

**Files modified:** `app/(dashboard)/venues/[venueId]/staff/devices/page.tsx`
**Commit:** `16f8b46`

`Number.isNaN(parsed.getTime())` guard returning `—`, so a single bad value costs
one cell rather than the whole page including every revoke control on it.

## Skipped Issues

None.

## Notes for the human reviewer

Three fixes departed from the review's literal suggestion and are worth a second
look:

1. **WR-03** — the biggest behavioural change in this pass, and the only one with
   no runtime test coverage anywhere in the suite (nothing drives
   `app/(dashboard)/layout.tsx`). The redirect target and the loop analysis are
   reasoned from `app/(tablet)/page.tsx`'s own predicate; worth confirming by hand
   with a real enrolled-tablet session.
2. **WR-07** — the clear-on-gesture placement, and the `useRouter` mock change
   that came out of it. The mock change means the component now depends on Next's
   router identity being stable across renders, which it is, but that dependency
   is newly load-bearing for the `toHaveBeenCalledTimes(1)` assertions.
3. **CR-02** — `resolveVenueRows` changes two pages from "renders an empty list"
   to "throws a 500" on a read fault. That is the intended behaviour and matches
   the sibling `resolveVenueRow`, but it is a live behaviour change on the staff
   and devices pages.

---

_Fixed: 2026-08-04_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
