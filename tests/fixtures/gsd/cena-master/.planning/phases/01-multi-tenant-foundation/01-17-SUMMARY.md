---
phase: 01-multi-tenant-foundation
plan: 17
subsystem: planning-records
tags: [reconciliation, uat, verification, requirements, gap-closure]

requires:
  - "01-14-SUMMARY.md, 01-15-SUMMARY.md, 01-16-SUMMARY.md — the three gap-closure plans whose outcomes this pass records"
provides: "01-RECONCILIATION.md — a standing evidence ledger; corrected 01-UAT.md and 01-VERIFICATION.md; an adjudicated ACCT requirements table"
affects: "Any later phase that reads Phase 1's status instead of re-deriving it"

tech-stack:
  added: []
  patterns:
    - "Evidence ledger before edit: every document change cites a ledger row carrying the command that was run and its real output; a row with no command is not evidence"
    - "Write-once snapshot baseline (/tmp/gsd-01-17, mkdir without -p) instead of a git baseline, so preservation guards cannot be silently rebaselined and pre-existing working-tree dirt is not attributed to this plan"
    - "Closed findings are re-statused in place, never deleted — regressions move to regressions_closed, gaps keep their root_cause and missing analysis"

key-files:
  created:
    - ".planning/phases/01-multi-tenant-foundation/01-RECONCILIATION.md"
  modified:
    - ".planning/phases/01-multi-tenant-foundation/01-UAT.md"
    - ".planning/phases/01-multi-tenant-foundation/01-VERIFICATION.md"
    - ".planning/REQUIREMENTS.md"
    - ".planning/WINDOWS.md"

key-decisions:
  - "01-VERIFICATION.md status STAYS gaps_found even though every gaps: and regressions: entry is closed at the code layer — three human legs are owed and the rule is that a human-owed row blocks the status move"
  - "UAT tests 7 and 12 stay result: issue rather than moving to pass — their code gaps are closed but both entries describe browser journeys nobody has walked"
  - "ACCT-01, ACCT-03 and ACCT-05 stay unticked despite green suites, because each rests on an unrun human leg; 01-15-SUMMARY.md's requirements-completed: [ACCT-01] claim was overruled on that basis"
  - "ACCT-06 and ACCT-07 recorded as honestly incomplete — proven at the RLS layer only, with the reason written into the traceability row itself"
  - "The six new COPY keys are recorded in 01-UAT.md rather than added to 01-UI-SPEC.md, which is a checker-approved artifact this plan does not own"

requirements-completed: [ACCT-02, ACCT-04, ACCT-08]

coverage:
  - id: D1
    deliverable: "01-RECONCILIATION.md — 24-row evidence ledger with completeness assertion"
    verification:
      - kind: command
        ref: "grep -cE 'stale-fix-it|still-true-leave-it|human-owed|out-of-scope-leave-it' 01-RECONCILIATION.md -> 32 (>=12 required)"
        status: pass
      - kind: command
        ref: "cmp -s against all three /tmp/gsd-01-17 snapshots -> all byte-identical at end of Task 1"
        status: pass
    human_judgment: false
  - id: D2
    deliverable: "01-UAT.md test 1 corrected to pass; its own severity removed while G-01-1's is preserved"
    verification:
      - kind: command
        ref: "grep -cE '^severity: blocker' -> 0; grep -c 'severity: blocker' -> 1; grep -cE '^  severity: blocker' -> 1"
        status: pass
    human_judgment: false
  - id: D3
    deliverable: "01-VERIFICATION.md status/score re-derived; regressions and gaps re-statused without deletion"
    verification:
      - kind: command
        ref: "grep -cE '^  - test:' 01-VERIFICATION.md -> 9 (all human_verification items retained and annotated)"
        status: pass
      - kind: command
        ref: "git diff --stat -> 21 deletions across two files totalling 1192 lines (scoped, not a rewrite)"
        status: pass
    human_judgment: false
  - id: D4
    deliverable: "REQUIREMENTS.md ACCT-01..08 adjudicated; checkbox list and traceability table agree"
    verification:
      - kind: command
        ref: "node comparison of both places -> all eight AGREE; grep -cE '^- \\[x\\] \\*\\*ACCT-0[67]\\*\\*' -> 0; grep -c 'Gaps Found' -> 1"
        status: pass
      - kind: command
        ref: "diff -U0 vs REQUIREMENTS.before, non-ACCT requirement ids on changed lines -> 0"
        status: pass
    human_judgment: false
  - id: D5
    deliverable: "UAT test 26 rollup re-derived; item 1 no longer PARTIAL-for-a-seeded-venue"
    verification:
      - kind: command
        ref: "test 26 result stays [pending] with its three owed legs named in a table"
        status: pass
    human_judgment: true
    rationale: "Whether the roll-up may close is a judgment about three browser journeys that have not been walked. The machine can only confirm the entry was not flipped to pass."
  - id: D6
    deliverable: "Six new COPY keys recorded against the Copywriting Contract"
    verification:
      - kind: command
        ref: "grep -c 'createAnotherHeading' -> 1; grep -c 'googleUnavailable' -> 3; grep of all six in 01-UI-SPEC.md -> 0 contract rows"
        status: pass
      - kind: command
        ref: "git status --porcelain 01-UI-SPEC.md -> empty (artifact not edited)"
        status: pass
    human_judgment: false

metrics:
  duration: ~18 min
  completed: 2026-08-04
  tasks: 3
  files_changed: 5

status: complete
---

# Phase 01 Plan 17: Reconcile the Phase's Own Records Summary

An evidence ledger of 24 re-derived claims, three corrected status documents, and
an eight-row requirements adjudication in which every unticked box is unticked for
a written reason — five of eight ACCT requirements remain unticked, three of them
because a human leg is owed and two because Phase 1 genuinely cannot finish them.

## What this pass actually found

**Plan 01-16 landed.** All three conditional legs in this plan resolve to the
"01-16 executed" branch: `depends_on` stayed as planned, G-01-6 moved to resolved
at the code layer, and the device-enrolment human leg is recorded *owed* rather
than *skipped-by-scope*. Verified by reading the source, not the summary: the
`registry.length === 0` ternary in `staff/devices/page.tsx` opens at :95 and
closes at :141, and the `<Link href="/enable-staff-mode">` renders at :166 —
after it, under a comment headed "OUTSIDE THE BRANCH ABOVE, DELIBERATELY". The
`grep -c` for that href returns 1 rather than 2 because 01-16 **hoisted** the CTA
rather than duplicating it, which would have read as a failure to anyone checking
the count alone.

**Every stale claim was stale in the direction the plan predicted, and one was
stale in the opposite direction.** `01-15-SUMMARY.md` carries
`requirements-completed: [ACCT-01]`. Its own decision-table cell makes ACCT-01
`Satisfied` only if the Google live round trip is recorded run and passing, and it
is not. That claim was overruled and ACCT-01 left unticked (ledger row 20). This
is the exact shape of T-01-17-01 arriving from a sibling plan rather than from
this one, and it is the reason the plan insisted on per-requirement adjudication
instead of trusting the summaries.

**The full-suite figure was stale by construction, as predicted.** `01-UAT.md`
recorded "40 files / 411 tests" from 2026-08-03. Observed this session:

```
 Test Files  46 passed (46)
      Tests  442 passed (442)
   Start at  16:00:49
   Duration  49.42s (transform 466ms, setup 116ms, import 2.53s, tests 41.92s, environment 1.01s)
```

The Summary block now carries the observed figure. The dated per-test `verified:`
lines keep theirs — they are records of what was true on their date, not claims
about today.

## Ledger completeness arithmetic

- Claims extracted from `01-UAT.md`: **13**
- Claims extracted from `01-VERIFICATION.md`: **11**
- Claims extracted from `REQUIREMENTS.md` / sibling summaries: **3**
- Overlaps counted in more than one bucket above (rows 19, 22, 23, 24): **3**
- Distinct claims: **24** · Ledger rows: **24** · **Match.**

Verdicts: `stale-fix-it` 13 · `still-true-leave-it` 3 · `out-of-scope-leave-it` 3
· `human-owed` 4. Verdict-token grep returns 32 (≥12 required).

## Which branch was taken for `01-VERIFICATION.md` status, and why

**`status` stays `gaps_found`, with a `stale_note`.**

Every entry in the `gaps:` block and all three `regressions:` are closed at the
code layer — each re-derived from source rather than accepted from the commit
message. `f29ece0` is real (`lib/venue-page-read.ts:86` is `if (result.error) {
throw new Error(`, and all three `[venueId]` pages route through it);
`app/(dashboard)/error.tsx` exists (`8487bfd`); both coverage guards now parse the
AST; and all six Server Actions the WR-10 residual named as "executed by nothing"
are now driven by tests.

The rule the plan set is that the status may move only if no `human-owed` row
blocks it. Three do. Truth 1 / SC1 is behaviour-unverified for the fourth pass
running — but for a *different* reason than before: its recorded justification
("no test invokes signUpOwner, signInOwner or createVenue") is now false, and what
remains is purely the unwalked browser journey. `score` was re-derived by counting
the eleven truths against current evidence: **7/11 → 10/11**, never arithmetic on
the old number.

## Human legs — each with its recorded state

| Leg | Recorded state | What it gates |
|-----|---------------|---------------|
| Owner self-serve journey (UAT 26 item 1, UAT 7) — signup, RON/HUF/EUR from inside the product, switcher from the second venue, sign out, log back in | **UNRUN** | UAT 7 stays `issue`; test 26 stays `[pending]`; ACCT-01 and ACCT-03 unticked |
| Google live round trip (UAT 12), including the suppressed-prompt case | **UNRUN** | UAT 12 stays `issue`; ACCT-01 unticked |
| Device-enrolment reachability on a revoked-only registry (G-01-6) | **UNRUN** — 01-16 landed, so this is *owed*, not skipped-by-scope | ACCT-05 stays `Gaps Found`, unticked |

`workflow.human_verify_mode` is `end-of-phase`, so no leg was walked at execution
time. All three are recorded in `.planning/WINDOWS.md` as `unrun-verify`
(`open_count: 3`) so they survive past this session's context.

## Requirements adjudication — checkbox vs traceability, all eight

| Req | Box | Traceability status | Agree |
|-----|-----|--------------------|-------|
| ACCT-01 | `[ ]` | Verified (email); Google live round-trip owed | ✓ |
| ACCT-02 | `[x]` | Satisfied | ✓ |
| ACCT-03 | `[ ]` | Verified (code + data); owner journey owed | ✓ |
| ACCT-04 | `[x]` | Satisfied | ✓ |
| ACCT-05 | `[ ]` | Gaps Found | ✓ |
| ACCT-06 | `[ ]` | Verified at the RLS layer; user-flow re-test deferred to Phase 2 | ✓ |
| ACCT-07 | `[ ]` | Verified at the RLS layer; the surfaces it names arrive in Phases 2 and 4 | ✓ |
| ACCT-08 | `[x]` | Satisfied | ✓ |

**`grep -c 'Gaps Found'` returns 1 — the middle case**, and the summary is
required to name which: **01-16 landed but its device-enrolment human leg is
UNRUN.** A count of 0 here would have meant ACCT-05 was ticked on a browser check
nobody performed, which the plan flags as a failure rather than an achievement.

Requirement-id prefix set observed at execution time (13, enumerated from the file
rather than hard-coded): `ACCT ANLY BILL DINE FISC INGEST LANG MENU ORDER PAY TAB
TABLE THEME`. No non-ACCT id appears on any changed line (drift check → 0).

## Recomputed UAT Summary counters, with the arithmetic

| Counter | Before | After | Why |
|---------|--------|-------|-----|
| passed | 21 | **22** | test 1 moves from `issue` to `pass` on `55f3b69` |
| issues | 3 | **2** | test 1 leaves the set; tests 7 and 12 **remain** — code closed, browser legs unwalked |
| pending | 1 | 1 | test 26 |
| skipped | 1 | 1 | test 6, untouched |

**22 + 2 + 1 + 1 = 26.** ✓

## Preservation — before/after, every protected string

| Check | Before | After | Required |
|-------|--------|-------|----------|
| `^severity: blocker` (test 1's own) | 1 | **0** | 0 |
| `severity: blocker` total | 2 | **1** | exactly 1 — G-01-1's indented field survives |
| `^  severity: blocker` (G-01-1's) | 1 | **1** | 1 |
| `result: skipped` (test 6) | 1 | **1** | 1 |
| `MIS-DERIVED` | 3 | **3** | unchanged |
| `mobile friendly` | 2 | **2** | unchanged |
| `root_cause` | 4 | **5** | ≥4 |
| `partial_pass` | 1 | **2** | ≥1 |
| `supabase_analytics_cena` (test 1 `reported:`) | 1 | **2** | ≥1 |
| `resolved_by` | 1 | **7** | ≥3 |
| `^  - test:` (human_verification) | 9 | **9** | 9 |

`diff -U0` against the Task 1 snapshot, spanning Tasks 2 **and** 3, finds
`MIS-DERIVED|mobile friendly` on **0** changed lines. `git status --porcelain
01-UI-SPEC.md` is empty. `git diff --stat -- . ':(exclude).planning'` is empty in
all three tasks — no application code changed.

## Line counts — scoped edits, not rewrites

| File | Before | After | Δ |
|------|--------|-------|---|
| `01-UAT.md` | 708 | 906 | +198 |
| `01-VERIFICATION.md` | 484 | 627 | +143 |
| `REQUIREMENTS.md` | 189 | 207 | +18 |

Across the two Task-2 documents the diff was 300 insertions against **21
deletions** on 1,192 lines. The growth is annotation — `resolved_by`, `state:`,
`resolution_evidence` — not replacement. Nothing was rewritten.

## Deviations from Plan

**1. [Rule 2 — missing critical] Two of three owed human legs were absent from the
broken-windows ledger**

- **Found during:** Task 3 close-out
- **Issue:** `.planning/WINDOWS.md` (created by 01-16) held one `unrun-verify`
  entry, covering only the device-enrolment leg. The owner self-serve journey and
  the Google round trip — both blocking requirement ticks — were recorded nowhere
  that outlives this session's context. A ship gate would not have seen them.
- **Fix:** appended both via `gsd-tools windows append --kind unrun-verify`.
  `open_count` 1 → 3.
- **Files modified:** `.planning/WINDOWS.md`
- **Commit:** with the summary commit

**2. [Documented, not fixed] The 01.1 design-system phase directory does not exist**

- **Found during:** Task 1, ledger row 16
- **Issue:** the plan's check expects `.planning/phases/01.1-design-system-migration/`
  to exist as the home for the mobile-responsiveness deferral. `ls` exits 1 in this
  worktree; `.planning/phases/` holds only `01-multi-tenant-foundation`. The phase
  **is** in ROADMAP.md (success criteria at :124); its directory is untracked in the
  main checkout and therefore absent here.
- **Action taken:** recorded honestly in the ledger rather than asserted, and the
  deferral was left exactly where it was — a Deferred Follow-Up against test 11,
  whose `result:` remains `pass`. Per standing override 1, a documentation plan
  does not create the directory to make its own check pass.

**Total deviations:** 1 auto-fixed (Rule 2), 1 documented-not-fixed.
**Impact:** none on scope. The second is a note for whoever creates that phase.

## Deferred / not closed, deliberately

- **The `ensureAccount` consent residual** — POST-reachable, `TERMS_VERSION`
  already client-side. `01-15-SUMMARY.md:327` states it is unmodified; this pass
  records it as open (ledger row 18) and does **not** describe it as closed.
- **UAT test 6** — stays `skipped`, MIS-DERIVED rationale intact. `ls` of the
  `[venueId]` route family returns `page.tsx` and `staff` only: still no menu
  surface, so still nothing to click.
- **Accepted items untouched:** the `anon`/`authenticated` TRUNCATE grants, the
  `rls_test_items` placeholder, every `deferred-items.md` entry, and the missing
  `/legal/terms` and `/legal/privacy` routes.
- **The outcome clause's second half** — "without limited-role staff changing
  prices, content, or settings" — remains RLS-layer-only and was explicitly *not*
  upgraded. The re-derived clause says so in as many words.

## Known Stubs

None. This plan changed no application code.

## Issues Encountered

None blocking. The one surprise worth carrying forward is the sibling-summary
requirement claim (ledger row 20): a plan's own `requirements-completed` is not
self-certifying, and this reconciliation existed partly to catch that.

## Next Phase Readiness

Phase 1's records are now true. What stands between this phase and a clean close
is **three browser journeys, not three defects** — every code gap this round
opened with is closed and re-derived. Run the three legs in the table above, then
tick ACCT-01, ACCT-03 and ACCT-05 and close test 26 by flipping the rows that
already name what they need.

## Self-Check: PASSED

- `01-RECONCILIATION.md` exists on disk ✓
- Commits `500edae`, `b334cd4`, `cd56e89` all present in `git log` ✓
- All Task 1, 2 and 3 acceptance criteria re-run and passing (tabulated above) ✓
- Plan-level `<verification>`: ledger ≥12 rows with real commands ✓ · ≥3
  `human-owed` (4) ✓ · suite counts from a run in this plan ✓ · exactly one
  `severity: blocker` surviving ✓ · nine `human_verification:` items retained ✓ ·
  checkbox/traceability agreement for all eight ✓ · test 26 `result:` consistent
  with unrun legs ✓ · no application code changed in any task ✓
- Full suite green at close: 46 files / 442 tests ✓
