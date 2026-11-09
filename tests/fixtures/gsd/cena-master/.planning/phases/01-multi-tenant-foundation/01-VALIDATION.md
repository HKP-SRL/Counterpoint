---
phase: 1
slug: multi-tenant-foundation
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-24
validated: 2026-07-29
blockers_cleared: 2026-07-29 by quick task 260729-pll (G2, G3)
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: RESEARCH.md §Validation Architecture and the **13** PLAN.md task/verify blocks
> (5 original + 01-06…01-10 gap-closure round 1 + 01-11…01-13 round 2).

> **Rewritten 2026-07-29 by `/gsd-validate-phase`.** The prior revision was the plan-time seed:
> it mapped 15 tasks from plans 01-01…01-05 only, listed every row as `⬜ pending`, and recorded
> the framework as "none installed yet". All three were stale. Statuses below are from an
> observed suite run, not from SUMMARY claims.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 (installed, `devDependencies`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm exec vitest run tests/rls/` |
| **Full suite command** | `pnpm exec vitest run` |
| **Typecheck gate** | `pnpm exec tsc --noEmit` — **never** `npx tsc`/`pnpm dlx tsc` (deprecated squatter package; prints a notice instead of typechecking, so the gate passes without checking anything) |
| **Observed runtime** | ~46–55s full suite against the running local stack |
| **Package manager** | pnpm. `supabase` CLI is brew-installed at `/opt/homebrew/bin/supabase` — call directly, never via `pnpm dlx` |

Tests are integration-style: the client SDK runs against a **local Supabase stack**
(`/opt/homebrew/bin/supabase start`), and migration-touching suites prefix `supabase db reset`.

`fileParallelism: false` + `sequence.concurrent: false` are **load-bearing, not performance knobs** —
the whole suite shares one Postgres with real FK'd fixtures. `tests/setup-env.ts` loads `.env.local`
inside the worker and throws if `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SECRET_KEY` are absent. `.env.local` is gitignored, so it must be recreated from
`supabase status` after any worktree removal.

**Known flaky pair.** `tests/staff/pin-verify-backoff.test.ts` and `tests/actions/venue-authority.test.ts`
are timing-sensitive against the live Postgres (signature: a lock read as already expired,
`expected 0 to be greater than 0`). Established by two full runs on one commit. Both pass in
isolation. **Re-run before treating a failure in these two files as real.** Failures in any other
file are genuine.

---

## Suite State (observed 2026-07-29, not inherited from SUMMARY)

| Metric | Value |
|--------|-------|
| Test files | **38** |
| Tests | **387** — 387 passed, 0 failed |
| Failures | **None.** The 4 deliberate defect pins (G2 ×3, G3 ×1) went green when quick task `260729-pll` corrected the implementations — see Escalated Blockers |
| Typecheck | `pnpm exec tsc --noEmit` exit 0 |
| RLS release gate (D-25) | **green** — every `tests/rls/` file passes |
| Server Actions executed by tests | **15 / 15** (was 2 / 15 before this audit) |

---

## Sampling Rate

- **After every task commit:** run the targeted file, e.g. `pnpm exec vitest run tests/rls/venue-isolation.test.ts`.
- **After every plan wave:** `pnpm exec vitest run` (full suite; migration-touching tasks also `supabase db reset`).
- **Before `/gsd-verify-work`:** the **D-25 RLS release gate is non-negotiable** (CONTEXT.md) and is currently green.
- **Max feedback latency:** ~55 seconds.

---

## Per-Task Verification Map

### Original plans 01-01 … 01-05

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test File(s) | Status |
|---------|------|------|-------------|-----------------|--------------|--------|
| 01-01-01 | 01 | 1 | supply-chain (T-01-SC) | Flagged packages verified (>100k weekly dl + official GitHub source) before first install | — checkpoint (blocking-human) | 🔵 manual |
| 01-01-02 | 01 | 1 | ACCT-08 (T-01-01/02) | All tables RLS-enabled in their creation migration; admin/secret key server-only | infra — `supabase db reset && pnpm exec tsc --noEmit` | ✅ green |
| 01-01-03 | 01 | 1 | ACCT-01/02/08 | Owner signs up with recorded consent, creates a venue via bootstrap RPC; a second owner cannot read the first's venue | `tests/auth/signup.test.ts`, `tests/rls/venue-isolation.test.ts` | ✅ green |
| 01-01-04 | 01 | 1 | ACCT-01/02/08 | Live schema matches migration 0001; types generated from live DB | re-run of Task 3 + `supabase gen types` | ✅ green |
| 01-02-01 | 02 | 2 | ACCT-01 (T-02-01) | Password-reset token single-use; reset request does not enumerate users | `tests/auth/login-reset.test.ts` | ✅ green |
| 01-02-02 | 02 | 2 | ACCT-01 (T-02-02/04) | Google One Tap uses hashed nonce + FedCM; first-time Google owner's consent recorded | `tests/auth/google-consent.test.ts` | ✅ green (+ manual E2E) |
| 01-02-03 | 02 | 2 | ACCT-03 (T-02-03) | Venue switcher lists only venues the owner is a member of | `tests/venues/multi-venue.test.ts` | ✅ green |
| 01-03-01 | 03 | 3 | ACCT-04 (T-03-01/02/03) | PIN hashed via pgcrypto; provision/verify only through a SECURITY DEFINER RPC whose authority is checked in the DB | `tests/staff/provision.test.ts`, `tests/staff/rpc-authority.test.ts` | ✅ green |
| 01-03-02 | 03 | 3 | ACCT-04 (T-03-03) | Exponential backoff/lockout after failed PIN attempts; soft-delete lifecycle | `tests/staff/pin-verify-backoff.test.ts` | ✅ green ⚠️ flaky |
| 01-03-03 | 03 | 3 | ACCT-04 | Live staff schema matches migration 0002; types regenerated | re-run `tests/staff/` | ✅ green |
| 01-04-01 | 04 | 4 | ACCT-05 (T-04-01/05) | Device holds a venue-scoped staff session; no orphan principal on failure | `tests/rls/device-session.test.ts`, `tests/rls/device-reenroll.test.ts` | ✅ green |
| 01-04-02 | 04 | 4 | ACCT-05/08 (T-04-03/04) | Remote revoke instant (RLS re-check + global signOut); owner-unlock swap-back + idle relock | `tests/rls/device-revoke.test.ts` | ✅ green |
| 01-04-03 | 04 | 4 | ACCT-05/08 | Live device schema matches migration 0003; types regenerated | re-run device suite | ✅ green |
| 01-05-01 | 05 | 5 | ACCT-06 (T-05-01/04) | Staff toggles availability only via a narrow RPC (with attribution); no blanket UPDATE; cannot touch price | `tests/rls/staff-write-boundary.test.ts` | ✅ green |
| 01-05-02 | 05 | 5 | ACCT-06/07/08 (T-05-02/03) | Full role×venue isolation matrix; direct-RPC abuse blocked; owner full access; availability edges | `tests/rls/venue-isolation-matrix.test.ts`, `tests/rls/rpc-abuse-matrix.test.ts`, `tests/rls/owner-full-access.test.ts`, `tests/rls/availability-toggle-edges.test.ts` | ✅ green |
| 01-05-03 | 05 | 5 | ACCT-08 (D-25 gate) | Full RLS release-gate suite green — the non-negotiable phase gate | `pnpm exec vitest run` (all `tests/rls/`) | ✅ green |

### Gap-closure round 1 — plans 01-06 … 01-10

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test File(s) | Status |
|---------|------|------|-------------|-----------------|--------------|--------|
| 01-06-01 | 06 | 1 | ACCT-04/05 (CR-01) | Owner authority over an enrolled venue is one predicate at one call site | `tests/actions/venue-authority.test.ts` | ✅ green ⚠️ flaky |
| 01-06-02 | 06 | 1 | ACCT-05 | The proven predicate expanded to the two dashboard pages that 404'd for the owner | `tests/actions/venue-authority.test.ts` | ✅ green |
| 01-06-03 | 06 | 1 | ACCT-05 | Both HMAC cookie codecs carrying the tablet's trust boundary are covered | `tests/lib/cookie-codecs.test.ts` | ✅ green |
| 01-07-01 | 07 | 2 | ACCT-01 (T-01G-07/09/14) | Server-held evidence replaces the query parameter as the recovery gate | `tests/auth/recovery-gate.test.ts` | ✅ green |
| 01-07-02 | 07 | 2 | ACCT-01 (WR-04) | The reset redirect origin stops trusting request headers | `tests/lib/site-origin.test.ts` | ✅ green |
| 01-07-03 | 07 | 2 | ACCT-01 (WR-02, D-21) | A failed consent write stops stranding the owner; comments stop claiming absent protections | `tests/auth/consent-evidence.test.ts` | ✅ green |
| 01-08-01 | 08 | 3 | ACCT-04 (D-18/20) | Backoff survives the 33rd wrong PIN — clamp before casting | `tests/staff/pin-verify-backoff.test.ts` | ✅ green ⚠️ flaky |
| 01-08-02 | 08 | 3 | ACCT-04 | Migration 0005 applied to the live DB; full gate re-run | full suite + `supabase gen types` | ✅ green |
| 01-09-01 | 09 | 4 | ACCT-02/07 | Shape of account writes after the blanket UPDATE grant is revoked | — checkpoint (decision) | 🔵 manual |
| 01-09-02 | 09 | 4 | ACCT-01/02/07/08 | Consent evidence and the billing parent stop being self-serve | `tests/rls/venue-isolation-matrix.test.ts`, `tests/rls/owner-full-access.test.ts` | ✅ green |
| 01-09-03 | 09 | 4 | ACCT-02/03 (WR-11) | Venue language, country and currency constrained to real values at **both** layers (Zod enum + DB CHECK) | `tests/venues/venue-value-domains.test.ts`, `tests/rls/venue-isolation.test.ts` | ✅ green |
| 01-09-04 | 09 | 4 | ACCT-02/08 | Migrations 0006 + 0007 applied to the live DB; full gate re-run | full suite + `supabase gen types` | ✅ green |
| 01-10-01 | 10 | 5 | ACCT-05 (WR-05/06) | A tested policy decides every device-cookie set and delete | `tests/lib/device-cookie-policy.test.ts` | ✅ green |
| 01-10-02 | 10 | 5 | ACCT-05 (WR-08/09) | The two lying failure paths in `lib/devices.ts` tell the truth, each failure forced | `tests/lib/device-failure-paths.test.ts` | ✅ green |
| 01-10-03 | 10 | 5 | ACCT-06/07/08 | Denial assertions assert something — `expectDenialError` stops passing vacuously | `tests/rls/setup.ts` + the four `tests/rls/` matrices | ✅ green |

### Gap-closure round 2 — plans 01-11 … 01-13

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test File(s) | Status |
|---------|------|------|-------------|-----------------|--------------|--------|
| 01-11-01 | 11 | 1 | ACCT-01 (D-07, BLOCKER 1) | The recovery grant dies with the change it authorised — proven through an injected path-aware cookie jar | `tests/actions/recovery-cookie-lifecycle.test.ts`, `tests/support/server-action-harness.ts` | ✅ green |
| 01-11-02 | 11 | 1 | ACCT-01 (WR-01) | A grant is minted only for a redeemed `type=recovery` token | `tests/actions/recovery-cookie-lifecycle.test.ts` | ✅ green |
| 01-12-01 | 12 | 2 | ACCT-05 (BLOCKER 2) | A registry read fault is a named fact, not a revoked device — a transient blip stops de-enrolling the estate | `tests/lib/device-cookie-policy.test.ts`, `tests/actions/device-exit-classification.test.ts` | ✅ green |
| 01-12-02 | 12 | 2 | ACCT-05 | An outcome cannot be added that no caller produces and no test covers | `tests/lib/device-cookie-outcome-coverage.test.ts` | ✅ green *(strengthened — see V-05)* |
| 01-13-01 | 13 | 3 | ACCT-07/08 (WR-02) | The venue-detail page gets the gate its siblings have; the route family gets a guard that keeps it | `tests/actions/venue-authority.test.ts`, `tests/lib/venue-page-gate-coverage.test.ts` | ✅ green *(strengthened — see V-05)* |
| 01-13-02 | 13 | 3 | ACCT-02/03 (WR-03) | A failed venues read stops looking like an owner with no venues | `tests/lib/venue-landing.test.ts`, `tests/venues/multi-venue.test.ts` | ✅ green |
| 01-13-03 | 13 | 3 | ACCT-05 (WR-04) | The rotation document tells the truth about `STAFF_SESSION_SECRET` blast radius | `.env.example` — doc-only | 🔵 manual (doc review) |

### Validation audit additions — 2026-07-29

| ID | Requirement | Secure Behavior | Test File | Status |
|----|-------------|-----------------|-----------|--------|
| V-01 | ACCT-02 | `createVenue` action glue: a Zod rejection returns state and writes **nothing** (verified by service-role ground-truth re-read, never through the caller's RLS-scoped client); accepted submission writes exactly one venue; blanks stored as NULL not `""`; replay does not double-write | `tests/actions/create-venue-action.test.ts` (8) | ✅ green |
| V-02 | ACCT-01 | `signUpOwner` / `signInOwner` / `requestPasswordReset` / `ensureAccount`: consent never skipped; consent write retried **exactly once** then fails loudly; WR-07 stranded-owner fall-through fires only for a session holding *that* address; wrong password and unknown address answer **identically** | `tests/actions/auth-actions.test.ts` (17) | ✅ green |
| V-03 | ACCT-05 | `enableStaffMode` / `revokeDevice` / `unenrollThisBrowser`: nothing privileged before the owner check; **no device cookie at any path** when the swap fails (WR-06 — the ordering is the fix); refusals never reach the privileged client | `tests/actions/device-lifecycle-actions.test.ts` (15) | ✅ green |
| V-04 | ACCT-04 / ACCT-06 | `provisionStaffProfile` / `deactivateStaffProfile` / `verifyPin` / `clearStaffSession` / `toggleItemAvailability`: PIN never echoed back; cookie minted on success and nothing else; attribution taken from the **signed cookie**, and a **forged** cookie is ignored | `tests/actions/staff-actions.test.ts` (18) | ✅ green |
| V-05 | ACCT-05 / ACCT-07 | Both structural coverage guards detect a real **call** / real **produced value** via TypeScript AST, not a substring. Each carries a self-check that its detector answers `false` for a mention-only fixture, so it cannot silently regress | `tests/lib/venue-page-gate-coverage.test.ts`, `tests/lib/device-cookie-outcome-coverage.test.ts` | ✅ green |
| V-06 | ACCT-02/07/08 | A read failure is never presented to the operator as an authoritative absent result | `tests/actions/venue-page-read-fault.test.ts` (3 + 3 paired contrast) | ✅ green — G2 closed by `260729-pll` |
| V-07 | ACCT-02/07/08 | The throws this phase relies on have a route error boundary to fail to | `tests/lib/route-error-boundary.test.ts` (2) | ✅ green — G3 closed by `260729-pll` |
| V-08 | ACCT-07/08 | The decision the three `/venues/[venueId]` pages open with is pinned independently of the pages, so a fourth page added later inherits a contract rather than re-deriving it from whichever sibling it copied | `tests/lib/venue-page-read.test.ts` (5) | ✅ green — added by `260729-pll` |

*Status: 🔵 manual · ✅ green · ❌ red · ⚠️ flaky (re-run before believing)*

---

## Escalated Blockers — ✅ BOTH CLOSED 2026-07-29 (quick task `260729-pll`)

These were **not** manual-only. Each had a real automated test that failed, and each went green
when the implementation was corrected. They were the reason `nyquist_compliant: false`; the flag
is now `true`. Both records are kept below rather than deleted — the pins are permanent
regression guards and the reasoning is what stops the shape returning a fourth time.

### G2 — a read fault is reported to the legitimate owner as a 404 · ✅ **CLOSED**

`app/(dashboard)/venues/[venueId]/page.tsx:28`, `.../staff/page.tsx:34-42` and
`.../staff/devices/page.tsx:33-41` each bind only `data` from a `.maybeSingle()` venues read and
answer `notFound()` when it is null. `maybeSingle()` resolves `data: null` **alongside** an error,
so a statement timeout, JWT expiry or any PostgREST fault tells the owner their own venue does not
exist. On the detail page this read runs **before** the honest `resolveVenueOwner` gate and four
lines above a comment forbidding exactly this.

- **Pin:** `tests/actions/venue-page-read-fault.test.ts` drives each real page component with a
  scripted PostgREST `57014` and asserts a throw, not `notFound()`. All three answer `not-found`.
- **Non-vacuity proven:** the paired contrast in the same file — a *clean* read finding no row must
  still 404 — **passes on all three**, so the harness distinguishes the two facts the pages cannot.
- **Fix:** bind the error channel and throw, mirroring `lib/venue-landing.ts:60-65` — preferably as
  a Next-free `lib/` helper, since an inline `if (error) throw` in a Server Component is the shape
  this phase has shipped a defect behind three times.
- **✅ Shipped** `f29ece0` — `lib/venue-page-read.ts` exports `resolveVenueRow`, imports nothing
  from `next/*`, checks the error channel FIRST, and all three pages route their venues read
  through it. `notFound()` stayed in the pages. Pin now 6/6 (3 fault + 3 paired contrast).
  Additionally pinned in isolation by `tests/lib/venue-page-read.test.ts` (V-08).
- **Type note worth keeping.** The natural signature — `result: { data: TRow | null; error: E | null }`
  — does not compile at the call sites. `maybeSingle()` returns
  `PostgrestSingleResponse<Row | null>`, itself a union, and inferring a naked type parameter from
  a union argument collapses `TRow` to `never`, after which every field access reports
  "Property 'name' does not exist on type 'never'". The generic binds the whole response instead
  and projects the row out with an indexed access, which distributes over the union.

### G3 — no route error boundary exists anywhere · ✅ **CLOSED**

`find app -name "error.tsx" -o -name "global-error.tsx"` returns nothing repo-wide, yet
`lib/venue-landing.ts` throws by design and `01-13-SUMMARY.md:324` claims the failure "surfaces
through the existing route error boundary". The claimed artifact does not exist.

- **Pin:** `tests/lib/route-error-boundary.test.ts`. Its own non-vacuity guard (the walk hit a real,
  non-empty `app/`) passes.
- **Coupling — order matters:** G3 is what makes G2's fix *safe to ship*. Correcting G2 without a
  boundary converts a false 404 into Next's unstyled "Application error" screen. **Fix G3 first.**
- **Fix:** create `app/(dashboard)/error.tsx` plus a `COPY.errors.readFailed` entry.
- **✅ Shipped** `8487bfd` — and shipped FIRST, in that order, for the reason stated above.
  `app/(dashboard)/error.tsx` renders `COPY.errors.readFailedHeading` / `readFailed` / `retry`
  with the retry wired to Next's `reset()`. It renders `error.digest` but deliberately never
  `error.message`, which carries PostgREST codes, table names and venue ids from the throw sites.
- **Known scope limit, recorded not deferred.** A throw inside `app/(dashboard)/layout.tsx`
  itself is caught by the parent segment, not by this boundary — that is Next's boundary model.
  The layout does one auth read and redirects rather than throwing, so it is not a live gap; a
  later phase adding a fallible read to the layout needs `app/error.tsx` too.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Google One Tap end-to-end sign-in (real FedCM credential) | ACCT-01 | Needs a live Google OAuth client ID and a browser FedCM prompt that cannot run headless; `tests/auth/google-consent.test.ts` covers only the server-side consent + `signInWithIdToken` DB path with a stubbed token | Configure the Google client ID in Supabase Auth → load `/login` in a real browser signed into a Google account → complete the One Tap prompt → confirm the owner account row and consent row were created |
| Package legitimacy supply-chain gate (`01-01-01`) | supply-chain (T-01-SC) | Blocking-human checkpoint before the first install; verifying npm download counts + GitHub source is human judgment on external web data | Confirm each flagged package shows >100k weekly downloads and an official GitHub source repo before approving |
| Account-write shape decision (`01-09-01`) | ACCT-02/07 | `checkpoint:decision` — an architectural choice, not a behavior | Recorded in `01-09-PLAN.md`; the resulting constraint is pinned by `01-09-02` |
| D-07: `/reset-password` renders no form without a redeemed recovery link | ACCT-01 | Backstop — requires a real signed-in browser session that has *not* redeemed a recovery link | As a signed-in owner who has NOT redeemed a recovery link, navigate to `/reset-password` and `/reset-password?stage=set`; confirm neither renders the "Choose a new password" form. **Run before** completing a reset on the same browser |
| Full GoTrue recovery journey with `secure_password_change = true` | ACCT-01 | Backstop — the measurement at `tests/auth/recovery-gate.test.ts:226-250` is load-bearing for the threat model and depends on the shipped GoTrue build | Drive the full recovery journey on the local stack, then separately attempt an `updateUser` password change from an ordinary (non-recovery) password session. Record what the shipped build reports |
| `.env.example` `STAFF_SESSION_SECRET` rotation blast radius (`01-13-03`) | ACCT-05 | Documentation accuracy — no runtime behavior to assert | Read `.env.example` and confirm the rotation note states that rotating invalidates every enrolled device and staff cookie estate-wide |

---

## Wave 0 Requirements

All shared harness was built in **Plan 01 Task 2 (`01-01-02`)** and is complete:

- [x] `pnpm add -D vitest` — Vitest 4.1.10 installed
- [x] `vitest.config.ts` — sequential execution (`fileParallelism: false` + `sequence.concurrent: false`)
- [x] `tests/rls/setup.ts` — service-role fixture helper + `expectDenialError` (made non-vacuous in `01-10-03`)
- [x] `tests/setup-env.ts` — loads `.env.local` in-worker, throws on missing keys
- [x] `supabase/seed.sql` — local-dev seed data, distinct from test fixtures
- [x] `supabase init` + migration 0001 with RLS enabled **in the creation migration** (D-23)
- [x] `tests/support/server-action-harness.ts` — path-aware cookie jar + redirect sentinel (added `01-11-01`, extended by this audit to cover all 15 Server Actions)

---

## Validation Audit 2026-07-29

| Metric | Count |
|--------|-------|
| Gaps found | 5 |
| Resolved | 3 (G1 Server Action coverage, G4 guard strengthening, G5 this document) |
| Escalated | 2 (G2 read-fault 404, G3 missing error boundary) |
| Tests added | 68 (314 → 382) |
| Test files added | 6 (31 → 37) |
| Server Actions executed by tests | 2 / 15 → **15 / 15** |
| Implementation files modified | 0 |

**Why `nyquist_compliant: false` (at audit time):** every requirement had automated verification —
including the two defects, which were pinned by tests that correctly failed. The flag was false
because the suite was not green: G2 and G3 were open implementation blockers.

**Resolved 2026-07-29 by quick task `260729-pll`.** Both blockers were corrected in the order the
audit prescribed (G3 first — correcting G2 without a boundary would have converted a false 404 into
Next's unstyled "Application error" screen). Observed after: **38 files, 387 tests, 387 passed, 0
failed**, `pnpm exec tsc --noEmit` exit 0. The flag is now `true`.

---

## Validation Sign-Off

- [x] All 38 tasks across 13 plans mapped, with observed status rather than plan-time intent
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — the only manual entries are the two checkpoints (`01-01-01`, `01-09-01`) and a doc review (`01-13-03`), each surrounded by automated tasks
- [x] Wave 0 complete — framework, config, fixtures, seed, migration 0001, Server Action harness
- [x] No watch-mode flags — every command uses `vitest run`
- [x] Feedback latency < 90s (observed ~55s)
- [x] Every claimed-green test was executed, not inferred from SUMMARY
- [x] Structural coverage guards proven red-capable against the deletion each exists to catch
- [x] `nyquist_compliant: true` — G2 and G3 cleared 2026-07-29 by quick task `260729-pll`;
      full suite 387/387 green, typecheck exit 0

**Approval:** validated (PARTIAL) — 2026-07-29
**Blockers cleared:** 2026-07-29 — validated (COMPLETE for automated coverage). What remains for
phase 01 is the Manual-Only Verifications table above, none of which is an implementation defect.
