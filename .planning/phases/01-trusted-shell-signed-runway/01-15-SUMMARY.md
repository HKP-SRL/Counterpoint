---
phase: 01-trusted-shell-signed-runway
plan: 15
subsystem: ui
tags: [mission, needs-you, trust, drift, e2e, playwright-core, backstop, astryx, react, tanstack-query, sse]

requires:
  - phase: 01-14
    provides: "Needs You API/events, NeedsYouRow/needsYouQuery/NeedsYouEmpty/NeedsYouLoading, change view at /h/{id}/needs-you/phase-{NN}, phases rows with uncommittedEdits"
  - phase: 01-13
    provides: "runway API (count, planCount, items, changedCount), Mission runway card"
  - phase: 01-11
    provides: "doctor API and Trust page verdict wording"
  - phase: 01-12
    provides: "prepareApproval, signAndLand, writeTrust, writeBaseline (library approval path)"
provides:
  - "Mission page: changed-since-signed warning Banner, Couldn't read Badge on runway rows, Needs You card (5 newest, View all Needs You items), Trust card (verdict with the Trust page's words and Badge, last checked, stale age, Not checked yet)"
  - "TrustPage exports doctorQuery, trustVerdict, ResultBadge, CHECK_LOOK/PROBE_LOOK so the page and the card share one verdict"
  - "Phase detail `Review changes` (secondary, links to the change view); D-03 uncommitted hint on Phase detail and the Phases row (UncommittedHint)"
  - "ui/src/live.ts: a `phase` event also invalidates runway and Needs You"
  - "tests/helpers/large-host.ts: buildLargeHost with approveAll / driftAll"
  - "scripts/backstop.ts: 20 UI-SPEC backstop screenshots in .tmp/backstop/"
  - "tests/e2e/needs-you.e2e.test.ts: the drift loop end to end (13 tests)"
affects: [01-16, phase-01-verification]

actuals:
  tokens: 14070   # chars/4 over the added lines of the realized diff (56,282 chars, 9 files)
  tasks: 3
  commits: 5      # MEASURED: git rev-list --count 0114329..HEAD before the SUMMARY commit
plan_head_before: 0114329bbbc4b78b6bc48b4b1d444aa1c3a3cbb8
plan_head_after: 349b6526e5e0b15eb9561ffa4e30abee09c79dbc

tech-stack:
  added: []
  patterns:
    - "Mission cards reuse the owning page's query and row components (needsYouQuery + NeedsYouRow, doctorQuery + trustVerdict), so card and page cannot disagree"
    - "Two-column card Grid from the UI-SPEC `lg` breakpoint via useMediaQuery('(min-width: 1024px)')"
    - "Large synthetic hosts sign through the library path (prepareApproval + signAndLand + the CLI's signature check against the trusted throwaway key)"
    - "Backstop screenshots: system Chrome, theme set via localStorage `counterpoint.theme`, page-level scroller expanded, nested scrollers (480 px diff) kept"

key-files:
  created:
    - tests/helpers/large-host.ts
    - scripts/backstop.ts
    - tests/e2e/needs-you.e2e.test.ts
  modified:
    - ui/src/pages/MissionPage.tsx
    - ui/src/pages/PhaseDetailPage.tsx
    - ui/src/pages/PhasesPage.tsx
    - ui/src/pages/TrustPage.tsx
    - ui/src/live.ts
    - tsconfig.json
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Trust card verdict comes from one shared trustVerdict (extracted from the Trust page's VerdictBanner, behaviour unchanged): Pass badge + `Agents are boxed in`, Reachable + `Agent sandbox is not confining sessions`, Fail or Not checked + `{n} check(s) did not pass`; never all-pass when anything is not checked"
  - "A `phase` SSE event (base tip moved) now also invalidates the runway and Needs You queries: the watcher only publishes runway/needs-you when the value differs from its own last pass, so a change and its revert inside one 2 s poll left an open page stale"
  - "MISN-02 left Pending in REQUIREMENTS.md although requirements.ready-ids reported it ready: Phase 1 delivers only the inbox and one of its six sources (the traceability row records the split), so marking it complete would overstate it. MISN-01 and APPR-02 marked complete"

patterns-established:
  - "UncommittedHint (PhasesPage) is the one rendering of the D-03 soft hint, shared by the Phases row and Phase detail"
  - "Backstop scripts live in scripts/, are type-checked (tsconfig include), and write only under .tmp/"

requirements-completed: [MISN-01, APPR-02]  # plan declares MISN-01, MISN-02, APPR-02; MISN-02 intentionally left Pending (partial in Phase 1)

coverage:
  - id: D1
    description: "Mission: changed-since-signed Banner above the runway card with a link to Needs You; runway 0 on drift and back to 1 on re-sign or revert"
    requirement: MISN-01
    verification:
      - kind: e2e
        ref: "tests/e2e/needs-you.e2e.test.ts#shows a committed input change on Mission, in the badge and in the tab title"
        status: pass
      - kind: e2e
        ref: "tests/e2e/needs-you.e2e.test.ts#resolves with no re-sign when the change is reverted"
        status: pass
    human_judgment: false
  - id: D2
    description: "Mission Needs You card: empty state copy, same row as the inbox with the visible Approved version changed label, capped at 5 rows with View all Needs You items only above 5"
    requirement: MISN-02
    verification:
      - kind: e2e
        ref: "tests/e2e/needs-you.e2e.test.ts#starts with an empty Needs You card and a Trust card that was never checked"
        status: pass
      - kind: e2e
        ref: "tests/e2e/needs-you.e2e.test.ts#shows the five newest rows and View all Needs You items; the inbox shows all seven"
        status: pass
    human_judgment: false
  - id: D3
    description: "Mission Trust card: Not checked yet with Open Trust, Agents are boxed in with the Pass badge, and the `This check is 25 hours old.` stale wording"
    requirement: MISN-01
    verification:
      - kind: e2e
        ref: "tests/e2e/needs-you.e2e.test.ts#shows the stored doctor verdict on the Mission Trust card, and its age when stale"
        status: pass
    human_judgment: false
  - id: D4
    description: "Drift loop in the browser: approve via the real CLI in a pty, commit an input change, SideNav badge 1, `(1)` tab title, inbox row with visible label above the title and `1 file changed`, change view (1 input file changed, Modified, diff with the edited line, re-sign command), Review changes on Phase detail, re-sign resolves (This phase matches what you signed again, runway 1, inbox empty, badge gone); gates-only change gives the Gate config row and resolves on re-sign"
    requirement: APPR-02
    verification:
      - kind: e2e
        ref: "tests/e2e/needs-you.e2e.test.ts (13 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-03 uncommitted hint on the Phases row (under the Status badge) and Phase detail while the status stays On runway"
    requirement: APPR-02
    verification:
      - kind: e2e
        ref: "tests/e2e/needs-you.e2e.test.ts#shows only the soft hint for uncommitted edits, with the phase still on the runway"
        status: pass
    human_judgment: false
  - id: D6
    description: "UI-SPEC backstop screenshots (E1, E3 overflow + long-text, E4 long-text, E6, E7 overflow) at 1024/360 in light/dark"
    verification:
      - kind: automated_ui
        ref: "node scripts/backstop.ts -> .tmp/backstop/*.png (20 files)"
        status: pass
    human_judgment: true
    rationale: "The six backstop rows are visual checks the UI-SPEC reserved for the owner; the script only renders them (no pixel comparison in Phase 1)"
  - id: D7
    description: "Mission layout fit: two-column Grid from lg, one column below; verdict wraps; titles truncate with Tooltip; both themes legible"
    verification: []
    human_judgment: true
    rationale: "Layout and legibility at 360 px and in dark mode are judged by eye; the mission-runway-40 screenshots show the cards but no test asserts the column count"

duration: 22min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 15: Mission cards, drift surfacing, the browser drift loop and the backstop screenshots Summary

**Mission now leads with a changed-since-signed warning, then the runway, then a Needs You card (the five newest items, using the inbox's own row and its visible `Approved version changed` label) next to a Trust card that uses the Trust page's own verdict words. Phase detail offers `Review changes` for a drifted phase, and both phase screens show the D-03 uncommitted-edits hint. A 13-test browser e2e runs the whole drift loop: approve through the real CLI, change, review the diff, then re-sign or revert and see it resolved. A script renders the 20 UI-SPEC backstop screenshots from a generated 50-phase host.**

## Performance

- **Duration:** about 22 min
- **Started:** 2026-11-09T19:09:55Z
- **Completed:** 2026-11-09T19:32:00Z
- **Tasks:** 3, plus 2 fix commits
- **Files:** 3 created, 7 modified (REQUIREMENTS.md included)

## Accomplishments

- **Mission** (`ui/src/pages/MissionPage.tsx`):
  - **Changed banner.** When the runway reports `changedCount > 0`, a warning Banner sits directly above the runway card: `1 approved phase changed since you signed it` or `{k} approved phases changed since you signed them`, with a Link `Review what changed in Needs You`.
  - **Runway rows** for unreadable phases keep their row and now show the error Badge `Couldn't read`; before, this was a text suffix.
  - **Card grid.** Below the runway card is a `Grid`, two columns from 1024 px and one below, `gap={6}`.
  - **Needs You card:**
    - It shows up to five `NeedsYouRow`s, the same component the inbox uses.
    - `View all Needs You items` appears only when there are more than 5.
    - Empty state `Nothing needs you` (with the spec's body text).
    - Skeleton rows on first load.
    - On error, a Banner `Couldn't load Needs You` / `Try loading Needs You again`; the last rows stay on screen.
  - **Trust card:**
    - The verdict line uses the Trust page's Badge and words, and wraps rather than truncating.
    - Then `Checked {Timestamp}`, then `This check is {age} old. Run "counterpoint doctor" again.` when the report is stale.
    - `Not checked yet` when no report exists, and `Couldn't read the last check` for an invalid one.
    - Always an `Open Trust` link.
    - On error, `Couldn't load checks` / `Try loading checks again`.
- **Trust page:** the verdict logic moved into an exported `trustVerdict`. The page Banner and the Mission card now read the same result. Behaviour and wording are unchanged, and every fail-closed rule stays: anything not checked, failed, reachable or missing counts against the verdict. Nothing was special-cased for the gh credentials or Keychain rows.
- **Phase detail and Phases:**
  - A secondary `Review changes` button (a link to `/h/{id}/needs-you/phase-{NN}`) appears for `changed` phases.
  - `UncommittedHint` (info icon plus Supporting text) appears under the header on Phase detail and under the Status badge on the Phases row.
  - `uncommittedEdits` is now parsed from the API.
- **`buildLargeHost`** (`tests/helpers/large-host.ts`):
  - Generates N phases in the GSD shape, each with a CONTEXT and one PLAN, committed on `master`.
  - Phase 01 can carry a 300-character name (which also gives it a long directory slug), a 300-character objective, a 24-level `files_modified` path and long `user_setup` entries.
  - Sets up a throwaway key with `writeTrust` and a `writeBaseline`, in the scratch home only.
  - `approveAll` signs each phase with `prepareApproval` + `signAndLand`, using ssh-keygen and the same signature check against the trusted key that the CLI makes, then nudges the daemon.
  - `driftAll({ bigDiffPhase })` makes one commit that changes every CONTEXT. The chosen phase's CONTEXT becomes 1,000 lines, one of them 400 characters long.
- **`scripts/backstop.ts`:** builds the UI and a 50-phase host, starts the daemon, signs in through system Chrome and writes the 20 PNGs (listed below). It then stops the daemon and removes the scratch dirs.
- **`tests/e2e/needs-you.e2e.test.ts`** (13 tests): everything the plan lists, plus a check that the kind label is rendered above the title (bounding boxes) and that no CSP violations or page errors occur.

## Backstop screenshots (for the owner's end-of-phase review)

Written to `.tmp/backstop/` (gitignored) by `node scripts/backstop.ts`. The last run is in this worktree at `/Volumes/Dock/Projects/HKP/Counterpoint/.claude/worktrees/agent-a5542be304588f045/.tmp/backstop/`; rerun the script in the main checkout after merging to get them there. Each scenario has 4 files: `{scenario}-{1024|360}-{light|dark}.png`.

| Scenario | UI-SPEC row | What to look at |
|----------|-------------|-----------------|
| `phases-40` | E3 overflow, E3 long-text | 50 rows; the table scrolls with the page; the 300-character name truncates to one line |
| `phase-detail-long` | E4 long-text | The heading, objective and `user_setup` text wrap fully; Inputs paths break (`break-all`) |
| `mission-runway-40` | E1 overflow | A 50-row runway list with no inner scroll; the Needs You and Trust cards sit side by side at 1024 |
| `needs-you-50` | E6 overflow | 50 items, no pagination |
| `change-view-1000` | E7 overflow | The diff block stops at about 480 px and scrolls; the 400-character line is diff line about 500 |

Things I saw in the screenshots that are for the owner to judge. I did not change them, because they are existing 01-10/01-13 layout choices:

- **Phases table at 360 px.** The table squeezes rather than scrolling sideways. Names are cut to about one word, and the status Badge truncates to `R…`. The Tooltip still has the full text.
- **Phase detail plans table at 360 px.** The 300-character objective wraps in a very narrow column (a few characters per line). The UI-SPEC wants objectives to wrap, so it does, but the result is tall.

## Copy additions to bring the UI-SPEC in line

| Element | Copy |
|---------|------|
| Changed banner link (Mission) | `Review what changed in Needs You` |
| Trust card link | `Open Trust` |
| Trust card, last checked | `Checked {Timestamp}` |
| Trust card, stale | `This check is {age} old. Run "counterpoint doctor" again.` (warning icon + text; one line instead of the page's Banner) |
| Trust card, verdict Badge | `Pass` (all pass), `Reachable` (probe reachable), `Fail` (any check failed) or `Not checked` (only unchecked gaps), each next to the verdict title |
| Trust card, invalid report | `Couldn't read the last check` / `The saved doctor report is not valid. Run "counterpoint doctor" again.` |
| Needs You card list label | `Newest Needs You items` (accessible name) |
| Error Banner bodies with kept data | `Counterpoint's daemon didn't answer. The last items it sent are still shown.` / `… The last result it sent is still shown.` |

## Task Commits

1. **Task 1: Mission cards, changed banner, Review changes, uncommitted hint**: `be31454` (feat)
2. **Task 2: Large-host generator and backstop screenshots**: `91e699d` (feat)
   - `1d5475d` fix: keep the phase number on one line in the Phases table (found by the backstop)
3. **Task 3: End-to-end drift loop**: `349b652` (test)
   - `4df5bf4` fix: refetch runway and Needs You whenever the base tip moves (found by the e2e)

**Plan metadata:** the docs commit that adds this SUMMARY and the REQUIREMENTS.md update.

## Files Created/Modified

- `ui/src/pages/MissionPage.tsx`: changed banner, runway `Couldn't read` Badge, Needs You and Trust cards, Grid.
- `ui/src/pages/TrustPage.tsx`: exports `doctorQuery`, `trustVerdict`, `ResultBadge`, `CHECK_LOOK`, `PROBE_LOOK`, `DoctorCommand`, `Report`, `DoctorAnswer`.
- `ui/src/pages/PhaseDetailPage.tsx`: `Review changes`, the uncommitted hint.
- `ui/src/pages/PhasesPage.tsx`: `uncommittedEdits` parsing, `UncommittedHint`, the hint under the Status badge, a nowrap phase number.
- `ui/src/live.ts`: `phase` events also invalidate the runway and Needs You queries.
- `tests/helpers/large-host.ts`, `scripts/backstop.ts`, `tests/e2e/needs-you.e2e.test.ts`: new.
- `tsconfig.json`: `include` adds `scripts`.
- `.planning/REQUIREMENTS.md`: MISN-01 and APPR-02 marked complete.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] An open page stayed stale after a change and its revert**
- **Found during:** Task 3 (revert path)
- **Issue:** I committed a CONTEXT change and then its revert, and the open Mission page kept showing runway 0. The server answered runway 1 and no Needs You items. Cause: the watcher publishes `runway` and `needs-you` only when the value differs from its own last pass. When both commits land inside one 2 s poll, the watcher sees 1 → 1, so the page, which fetched the middle state itself, is never told to refetch.
- **Fix:** In `FAMILY_TO_KEYS`, `phase` (the tip moved) now also invalidates `runway` and `needsYou`. The server caches both per tip, so the extra refetch is cheap. The watcher and server are unchanged.
- **Files modified:** ui/src/live.ts (not in files_modified)
- **Verification:** the revert test passes. The full e2e suite gives 44/44.
- **Committed in:** 4df5bf4

**2. [Rule 1 - UI correctness] Phase numbers broke digit by digit in the Phases table**
- **Found during:** Task 2 (reviewing the backstop screenshots)
- **Issue:** At 1024 and 360 px, the squeezed Phase column wrapped `01` onto two lines.
- **Fix:** `textWrap="nowrap"` on the number Text.
- **Committed in:** 1d5475d

**3. [Rule 3 - Structure] One verdict for the Trust page and the Mission card**
- **Found during:** Task 1
- **Issue:** The card has to use the Trust page's words and must never show all-pass when the page would not. Copying the logic would let the two drift apart.
- **Fix:** `VerdictBanner`'s computation was extracted into an exported `trustVerdict`. The page renders exactly as before.
- **Files modified:** ui/src/pages/TrustPage.tsx (not in files_modified)
- **Committed in:** be31454

**4. [Rule 3 - Tooling] Backstop capture height**
- **Found during:** Task 2
- **Issue:** My first capture heuristic grew the viewport to the diff CodeBlock's own scroll height (16,000 px). That showed the whole diff and hid the 480 px cap that E7 checks.
- **Fix:** Only page-level scrollers (at least 80% of the viewport tall) count.
- **Committed in:** 91e699d (the fix was made before the commit)

**5. [Acceptance wording] `Uncommitted edits to this approved phase` in PhaseDetailPage.tsx**
- The hint text lives once, in `UncommittedHint` (PhasesPage.tsx), and Phase detail renders that component. The acceptance grep on PhaseDetailPage.tsx is therefore satisfied by a JSX comment quoting the copy at the call site. The rendered text is asserted in the browser by the e2e test.

---

**Total deviations:** 5 (2 bugs, 2 structure/tooling, 1 acceptance-wording note).
**Impact on plan:** No new packages, and the lockfile is unchanged. Nothing under src/core/security, src/agent/probe.ts, the doctor code, the approval verification or the loopback guard was touched. No fail-closed check was relaxed, and no test was skipped or weakened.

## Issues Encountered

- **Worktree guard.** Commands were refused when they named git inside a compound command, when a heredoc mentioned `.git/config`, and once for `gsd-tools ... ; git diff` chained after `cd`. Each was rerun as a plain separate command from the worktree root, or the edit was made with the Edit tool. No refusal was routed around to reach anything outside the worktree.
- **Plan-commit ledger.** It was not written, because it lives in the shared `.git/worktrees/...` dir. `commits:` is measured from the known base `0114329` (5 commits before this SUMMARY).
- **Intermittent lifecycle failure (01-14).** Not seen: the one full unit run passed (718 passed, 1 skipped).

## Requirement Coverage Note

- **MISN-01, APPR-02:** marked complete.
- **MISN-02:** left **Pending** on purpose. `requirements.ready-ids` reported it ready (no sibling plan declares it), but Phase 1 delivers only the inbox and one of its six sources. REQUIREMENTS.md's traceability row already records that split. The orchestrator or verifier should decide how a partial requirement is tracked at phase close.

## Known Stubs

None.

## Threat Flags

None. No new endpoints, auth paths or trust-boundary file access.
- The Mission cards render server JSON as React text through Astryx. Verdict words come from the validated report fields, never from free text (T-01-56).
- The large host and the backstop script write only to scratch dirs (`.tmp/` or `CP_TEST_SCRATCH`) and `.tmp/backstop/`, with throwaway keys (T-01-55).

## User Setup Required

None.

## Next Phase Readiness

- **Owner review:** the 20 backstop PNGs, plus the 360 px table notes above.
- **01-16:** `buildLargeHost` and `scripts/backstop.ts` can be reused for any further heavy-data visual check.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

## Self-Check: PASSED

- Created files exist: tests/helpers/large-host.ts, scripts/backstop.ts, tests/e2e/needs-you.e2e.test.ts.
- Commits be31454, 91e699d, 1d5475d, 4df5bf4 and 349b652 are on this branch (`git rev-list --count 0114329..HEAD` = 5).
- Acceptance criteria re-run, all PASS:
  - MissionPage has `View all Needs You items`, `changed since you signed`, `Not checked yet` and `Try loading checks again`.
  - PhaseDetailPage has `Review changes` and `Uncommitted edits to this approved phase`. PhasesPage has `Uncommitted edits to this approved phase`.
  - large-host exports `buildLargeHost`.
  - backstop.ts has `1024`, `360`, `counterpoint.theme` and `.tmp/backstop`. tsconfig `include` lists `scripts`.
  - The e2e file has all five required strings.
- Plan verification:
  - `node scripts/backstop.ts` exits 0 and writes 20 PNGs.
  - `pnpm typecheck`, `pnpm lint` and `pnpm build:ui` exit 0.
  - `pnpm test`: 718 passed, 1 skipped (the expected live probe).
  - `pnpm test:e2e`: 44 passed (5 files).
  - `vitest --project e2e tests/e2e/needs-you.e2e.test.ts`: 13 passed.
