---
phase: 01-multi-tenant-foundation
reconciled: 2026-08-04
source: [01-UAT.md, 01-VERIFICATION.md, REQUIREMENTS.md]
plans_landed: [01-14, 01-15, 01-16]
suite_state: "46 files / 442 tests passed — `pnpm exec vitest run`, 2026-08-04, 56.70s"
---

# Phase 01 Reconciliation Ledger

Every claim below was re-derived against live source, a named commit, or a real
suite run **before** any document was edited. Nothing here is recalled; each row
carries the command that produced it.

The verdict vocabulary is closed: `stale-fix-it`, `still-true-leave-it`,
`human-owed`, `out-of-scope-leave-it`. Only `stale-fix-it` rows license an edit.

## Environment note

This ledger was produced in a headless git worktree. `.env.local` was recreated
from the main checkout and `pnpm install --frozen-lockfile` was run before the
suite. The local Supabase stack was up throughout (`docker ps`: db, auth, rest,
kong, realtime, storage, studio, pg_meta, inbucket — **no analytics or vector
container present**, which is itself evidence for row 1).

## Evidence table

| # | Claim | Recorded state | Check run | Actual result | Verdict |
|---|-------|----------------|-----------|---------------|---------|
| 1 | 01-UAT.md test 1 — cold start tears the stack down (`01-UAT.md:34-36`) | `result: issue`, `severity: blocker` | `git log -1 --format='%h %ad %s' --date=short 55f3b69` and `grep -A2 '\[analytics\]' supabase/config.toml` | `55f3b69 2026-07-30 fix(01): an optional analytics container stops destroying the whole stack`; config.toml reads `[analytics]` / `enabled = false` / `port = 54327`. `docker ps` shows nine healthy supabase containers and **no** `supabase_analytics_cena` / `supabase_vector_cena`. | `stale-fix-it` |
| 2 | 01-UAT.md test 7 — no route to a second venue (`01-UAT.md:82-89`) | `result: issue`, G-01-7 open | `ls 'app/(dashboard)/venues/new/page.tsx'`; `pnpm exec vitest run tests/venues/second-venue-route.test.ts tests/lib/unconditional-cta-coverage.test.ts`; read `01-14-SUMMARY.md` | Route exists. Both suites green: **2 files / 7 tests passed**. Plan 01-14 added `/venues/new`, `lib/venue-routes.ts`, an unconditional sidebar entry and a trailing switcher item. | `stale-fix-it` (code half only — see row 22) |
| 3 | 01-UAT.md test 12 — no visible Google control (`01-UAT.md:127-129`) | `result: issue`, G-01-12 open | `pnpm exec vitest run tests/auth/google-affordance.test.tsx tests/lib/google-affordance-coverage.test.ts`; read `01-15-SUMMARY.md` | Both suites green: **2 files / 10 tests passed**. A Google control now renders on `/login` **and** `/signup`. | `stale-fix-it` (code half only — see row 23) |
| 4 | 01-UAT.md gap G-01-6 — enrolment CTA bound to the empty state | `status: failed` | `grep -n 'enable-staff-mode\|registry.length' 'app/(dashboard)/venues/[venueId]/staff/devices/page.tsx'` + read lines 88-172 | Ternary `registry.length === 0` opens at **:95** and closes at **:141**. The `<Link href="/enable-staff-mode">` is at **:166**, after the ternary, under a comment headed "OUTSIDE THE BRANCH ABOVE, DELIBERATELY". Count is 1 because 01-16 **hoisted** the CTA rather than duplicating it. | `stale-fix-it` (reachability half only — see row 24) |
| 5 | 01-VERIFICATION.md regression 1 — three `[venueId]` pages bind only `data` | listed under `re_verification.regressions` | `grep -c 'resolveVenueRow'` on the three pages; `git log -1 --format='%h %s' f29ece0`; `grep -n 'throw\|error' lib/venue-page-read.ts` | 3 occurrences in **each** of the three pages. `f29ece0 fix(quick-260729-pll): a read fault stops being an absent venue`. `lib/venue-page-read.ts:86` is `if (result.error) { throw new Error(` — the read fault now throws instead of resolving to `notFound()`. | `stale-fix-it` |
| 6 | 01-VERIFICATION.md regression 2 — no route error boundary exists anywhere | listed under `re_verification.regressions` | `ls 'app/(dashboard)/error.tsx'`; `git log -1 --format='%h %s' 8487bfd` | File exists. `8487bfd fix(quick-260729-pll): the designed throws get a boundary to fail to`. | `stale-fix-it` |
| 7 | 01-VERIFICATION.md regression 3 — both coverage guards are raw substring checks | listed under `re_verification.regressions` | `grep -c 'import ts from "typescript"' tests/lib/venue-page-gate-coverage.test.ts tests/lib/device-cookie-outcome-coverage.test.ts` | 1 in each — both guards are now AST-based rather than substring-based. Both green in the full run. | `stale-fix-it` |
| 8 | 01-VERIFICATION.md `gaps_remaining` — WR-10 residual, six Server Actions executed by nothing | "signUpOwner, signInOwner, createVenue, enableStaffMode, revokeDevice and unenrollThisBrowser are still executed by nothing" | `ls tests/actions/{create-venue-action,auth-actions,device-lifecycle-actions,staff-actions}.test.ts`; `grep -rn '@/actions/' tests/` and read each destructuring site | All four files exist. `auth-actions.test.ts:63` drives `signUpOwner, signInOwner, requestPasswordReset, ensureAccount`; `create-venue-action.test.ts:61` and `second-venue-route.test.ts:62` drive `createVenue`; `device-lifecycle-actions.test.ts:130` drives `enableStaffMode, exitOwnerUnlock, revokeDevice, unenrollThisBrowser`; `staff-actions.test.ts:58` drives the staff actions. **All six named actions are now executed.** | `stale-fix-it` |
| 9 | 01-VERIFICATION.md `status: gaps_found` | frontmatter | derived from rows 5, 6, 7, 8 — every entry in the `gaps:` block re-checked | All three `gaps:` entries are closed at the code layer. But rows 22-24 are `human-owed`, so the phase is not clean. | `stale-fix-it` **with a `stale_note`** — status stays `gaps_found`; see the decision recorded below |
| 10 | 01-VERIFICATION.md `score: 7/11 must-haves verified` | frontmatter | re-counted the 11 truths in the Observable Truths table against rows 5-8 | Truths 2-8 unchanged VERIFIED. Truth 9 closed (row 5, 6). Truth 10 closed (row 7). Truth 11 closed (row 8). Truth 1 (SC1) — its stated reason ("no test invokes signUpOwner, signInOwner or createVenue") is now false, but the truth asserts a *browser* journey that is still unrun. **Re-derived score: 10/11, with truth 1 behaviour-unverified pending the human leg.** | `stale-fix-it` |
| 11 | 01-VERIFICATION.md `human_verification:` block of nine items | nine items listed | `grep -cE '^  - test:' 01-VERIFICATION.md` | Returns **9**. Items 2-9 are closed by UAT 19/17/23/21/20/24/22 and the item-2 session record; item 1 is the SC1 journey. | `stale-fix-it` (annotate in place; delete nothing) |
| 12 | UAT 24 / ordering-under-tie backstops | test 24 `result: pass` | `git log -1 --format='%h %s'` for `b296bf6`, `46aee48`, `c8fd468`; `grep -c 'order("id"' 'app/(dashboard)/venues/page.tsx' 'app/(dashboard)/components/VenueSwitcher.tsx'` | `b296bf6 fix(quick-260803-vo2): give every position-selecting list read a total order`; `46aee48 test(...): mirror the production tiebreaker in both helper reads`; `c8fd468 docs(...): add a deterministic tiebreaker to every list read`. Tiebreaker present (1) in both list reads. | `still-true-leave-it` |
| 13 | 01-UAT.md full-suite figure "40 files / 411 tests" (recorded 2026-08-03, appears at :194, :258, :276, :291, :345, :359, :378, :482) | 40 files / 411 tests | `pnpm exec vitest run` | **46 files / 442 tests passed**, duration 56.70s. Stale by construction — four plans have since added files. | `stale-fix-it` (Summary/notes figure only; the per-test `verified:` lines are dated historical records and stay) |
| 14 | 01-UAT.md Notes — "01-VERIFICATION.md is stale … Re-verification is queued for after this UAT pass" | open queue item | this plan | The queued re-verification is being performed now. | `stale-fix-it` |
| 15 | 01-UAT.md test 6 skip rationale (MIS-DERIVED CHECKPOINT) | `result: skipped` | `ls 'app/(dashboard)/venues/[venueId]/'` | Returns `page.tsx` and `staff` only — **no menu route exists**. Phase 1 ships no menu surface, so there is still nothing to click. | `out-of-scope-leave-it` |
| 16 | 01-UAT.md test 11 mobile-responsiveness note | `result: pass` + Deferred Follow-Up | read test 11; `ls -d .planning/phases/01.1-design-system-migration/`; `grep` ROADMAP | Test 11 is `result: pass` — confirmed. The ROADMAP **does** carry a design-system phase (`01.1`, "Success Criteria" at ROADMAP:124). Its phase **directory does not exist in this worktree** (`ls` exits 1; `.planning/phases/` holds only `01-multi-tenant-foundation`) — it is untracked in the main checkout. Recorded honestly rather than asserted. | `out-of-scope-leave-it` |
| 17 | Accepted items — `anon`/`authenticated` TRUNCATE grants, `rls_test_items` placeholder, `deferred-items.md`, missing `/legal/terms` and `/legal/privacy` | "Not counted as gaps … all accepted and recorded" (`01-VERIFICATION.md:479`) | read `01-VERIFICATION.md` Gaps Summary; `<scope_boundary>` of this plan | Each was weighed and accepted by a prior pass. Erasing an accepted risk is prohibition 2. | `out-of-scope-leave-it` |
| 18 | `ensureAccount` consent residual (POST-reachable; `TERMS_VERSION` already client-side) | deferred, recorded on `actions/auth.ts` | `grep -rn 'ensureAccount' 01-15-SUMMARY.md` | `01-15-SUMMARY.md:327`: the paragraph on `actions/auth.ts` is "**unmodified** by this plan … Deferred, and explicitly **not** re-described as closed here." | `still-true-leave-it` |
| 19 | 01-VERIFICATION.md Bookkeeping — 8 unticked boxes and 8 `Gaps Found` rows "should stay until the gaps above close" | all 8 ACCT rows `Gaps Found` | read `.planning/REQUIREMENTS.md:12-19` and `:135-142` | Confirmed: 8 unticked checkboxes, 8 `Gaps Found` traceability rows. The verifier's instruction is **per requirement**, not a bulk flip. | `stale-fix-it` (adjudicate per requirement — Task 3's decision table) |
| 20 | `01-15-SUMMARY.md` frontmatter claims `requirements-completed: [ACCT-01]` | ACCT-01 claimed complete | `grep -n 'requirements-completed' -A3` on all three sibling summaries | 01-14: `[]`. 01-16: `[]`. **01-15: `[ACCT-01]`.** But ACCT-01's own decision-table cell makes `Satisfied` conditional on the Google live round trip, which is unrun (row 23). The summary's claim outruns its evidence. | `human-owed` — ACCT-01 stays unticked |
| 21 | The six COPY keys added by plans 01-14 and 01-15 | four in `COPY.venues`, two (`consent.googleGate`, `errors.googleUnavailable`) | `grep -n` the six key names in `lib/copy.ts` and in `01-UI-SPEC.md` | All six exist in `lib/copy.ts` (:87-91, :63-64, :221). In `01-UI-SPEC.md` the grep returns **0** — none of the six has a Copywriting Contract row. `lib/copy.ts:83` says outright "plan 01-17 reconciles these four keys against `01-UI-SPEC.md`". | `stale-fix-it` (record the divergence in 01-UAT.md; `01-UI-SPEC.md` itself is not this plan's to edit) |

## Claims only a human can settle

These are recorded `human-owed`. **None is resolved by this plan**, and none may
tick a checkbox or turn a `result:` green. `workflow.human_verify_mode` is
`end-of-phase`, so no leg below has been walked at the time of writing.

| # | Claim, verbatim | Why automation cannot reach it | Verdict |
|---|-----------------|-------------------------------|---------|
| 22 | UAT 26 item 1 / UAT 7 — "Complete the full owner self-serve journey in a browser: /signup with the Terms checkbox, create venues in RON, HUF and EUR, sign out, log back in." The switcher must appear from the second venue onward and list all three in a stable order; country/timezone auto-derive for RON and HUF, stay blank for EUR, and remain overridable. | A multi-step session-state transition (signup → cookie write → redirect → read-back → logout → login) across rendered Server Components. The suite now drives `signUpOwner`, `signInOwner` and `createVenue` directly (row 8), which is strictly more than before — but it renders no page and holds no browser session. The Terms/Privacy links are **expected** to 404 (recorded deferral, row 17). | `human-owed` |
| 23 | UAT 12 — "With the real client id set and the provider enabled, a Google control is visible on both /login and /signup, completes a live sign-in, and lands a first-time Google owner on /venues with an accounts row and recorded consent." Plus the suppressed-prompt case: with One Tap's floating prompt absent, the control must still be visible and still work. | Requires live Google Identity Services, a real OAuth client id and a real consent screen. The suite asserts the control renders and is wired; it cannot complete a third-party round trip. | `human-owed` |
| 24 | G-01-6 / UAT 6 enrolment reachability — "As the owner of a venue whose registry holds only a REVOKED tablet, open the Devices page: a route to enrolment is visible without typing a URL, and the revoked row is still listed under its muted badge." | Plan 01-16 **landed** (row 4), so this leg is owed rather than skipped-by-scope. The structural guard proves the CTA is outside the conditional; only a browser proves the owner sees it in the revoked-only registry state. `01-16-SUMMARY.md` records its own browser check as unrun and created `.planning/WINDOWS.md` saying so. | `human-owed` |

## Completeness assertion

- Claims extracted from `01-UAT.md`: **13** (rows 1, 2, 3, 4, 12, 13, 14, 15, 16, 21, 22, 23, 24 — the last three shared with 01-VERIFICATION.md's human block).
- Claims extracted from `01-VERIFICATION.md`: **11** (rows 5, 6, 7, 8, 9, 10, 11, 17, 19, 22, 23).
- Claims extracted from `REQUIREMENTS.md` / sibling summaries: **3** (rows 18, 19, 20).
- Rows in the two tables above: **24** (21 evidence rows + 3 human-owed rows).
- Distinct claims after removing the overlaps counted twice above: **24**.

**Rows = claims. No claim was extracted without a row.**

Verdict distribution: `stale-fix-it` 13 · `still-true-leave-it` 3 ·
`out-of-scope-leave-it` 3 · `human-owed` 4 (rows 20, 22, 23, 24).

## Decision recorded for `01-VERIFICATION.md` `status`

**Branch taken: `status` stays `gaps_found`, with a `stale_note`.**

Every entry in the `gaps:` block is verdicted `stale-fix-it` and is closed at the
code layer (rows 5-8). The plan's rule is that the status may move off
`gaps_found` "only if the ledger shows every `gaps:` entry verdicted
`stale-fix-it` **and no `human-owed` row blocks it**." Rows 22-24 block it: the
SC1 browser journey is the sole remaining reason truth 1 is behaviour-unverified,
and the phase's own headline calls SC1 "the only thing standing between ACCT-01/
ACCT-02 and a pass." Moving to `verified` while three legs are unwalked would be
exactly threat T-01-17-01.
