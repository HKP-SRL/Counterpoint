---
phase: 01-trusted-shell-signed-runway
plan: 22
subsystem: security
tags: [doctor, permission-mode, auto-mode, trust-page, astryx, e2e, ui-spec, gap-closure]

# Dependency graph
requires:
  - phase: 01-24
    provides: "AGENT_PERMISSION_MODE ('auto') in src/agent/claude-argv.ts, and live proof that SCRUB=0 sessions report permissionMode auto with no notice"
  - phase: 01-25
    provides: "DoctorReport.sandboxIsolation, judgeSandboxIsolation wording, the Not counted as Blocked rewrite and the scratch settingsLocations source scan"
  - phase: 01-26
    provides: "the ninth probe row credential-env and the owner's sandbox-proxy-login exception"
provides:
  - "sessionModeEvidence(run): one permissionMode per system/init event (null when missing), plus stderr lines matching /permission mode|auto mode/i"
  - "AgentModeCheck, judgeAgentMode and DoctorReport.agentMode (additive, optional; schema stays counterpoint/doctor/v1); reportVerdict fails without it or when it is not pass"
  - "counterpoint doctor: ProbeSummary.agentSession, expected = AGENT_PERMISSION_MODE, the Agent permission mode line first in Sandbox probe, counted by doctorVerdict"
  - "Trust page: the two session check rows at the top of the Sandbox probe card, nine probe targets, the scoped all-pass wording; a report without either check never reads all-pass"
  - "UI-SPEC: Copywriting rows for both checks, the Trust screen rows, the CLI order, and E8 populated/partial/overflow"
affects: [01-23, 01-19, 01-20, 01-16, phase-02-builders]

# Actuals (#2632): chars/4 over the realized diff (78,151 chars, git diff 25bd20e..fea0cd5)
actuals:
  tokens: 19538
  tasks: 2
  commits: 2
plan_head_before: 25bd20ef191fc2486ec6ab0141a126feffd07f6a
plan_head_after: fea0cd5bbe4b959a8821a466fed212376f94cf5b

tech-stack:
  added: []
  patterns:
    - "A session-level check (mode, isolation) renders as a Check row at the top of the probe card; probe rows keep their Blocked/Reachable words"
    - "Core judges receive the launched value as a parameter (expected), so core imports nothing from src/agent/ and the launched and checked values come from one constant"
    - "e2e Trust cases each write their report and navigate to Trust themselves, so every case passes alone with -t"

key-files:
  created: []
  modified:
    - src/agent/runner.ts
    - src/core/security/doctor-report.ts
    - src/doctor/run.ts
    - tests/doctor/doctor.test.ts
    - tests/core/security/sandbox-settings.test.ts
    - tests/server/phases.test.ts
    - ui/src/pages/TrustPage.tsx
    - tests/e2e/phases.e2e.test.ts
    - tests/e2e/needs-you.e2e.test.ts
    - .planning/phases/01-trusted-shell-signed-runway/01-UI-SPEC.md

key-decisions:
  - "ProbeSummary.agentSession is a required field, so every DoctorProbe (live or test) must state what the treatment reported; nothing can omit it and pass by default"
  - "A notice that sanitises to an empty string still counts as a notice (fail closed); the judge never filters notices"
  - "When a later attempt reports null, effective is null and the detail reads 'an unknown mode' (rule 3 as planned)"
  - "The UI-SPEC Sandbox isolation row lists every fix judgeSandboxIsolation can emit (the three finding fixes plus the unreadable-source and launch-missing fixes), copied word for word, so no stored fix is missing from the contract"

requirements-completed: [FOUND-03, FOUND-04]  # copied from the plan; shared IDs, requirements.ready-ids reports both blocked, so REQUIREMENTS.md is not marked here

coverage:
  - id: D1
    description: "sessionModeEvidence reads every init event's permissionMode (null when missing) and the stderr mode notices"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/doctor/doctor.test.ts#sessionModeEvidence (01-22)"
        status: pass
    human_judgment: false
  - id: D2
    description: "judgeAgentMode passes only on auto from every attempt with no notice; default, missing, mixed or noticed fails with the fix; probe not run reads not-checked; notices sanitised and capped at 300"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/doctor/doctor.test.ts#judgeAgentMode (01-22)"
        status: pass
    human_judgment: false
  - id: D3
    description: "agentMode is additive in counterpoint/doctor/v1; reportVerdict and the Trust API fail a report without it or with it not pass"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/core/security/sandbox-settings.test.ts#DoctorReport (older report without agentMode; fail/not-checked; strict id and expected)"
        status: pass
      - kind: integration
        ref: "tests/server/phases.test.ts#fails a stored report that lacks the agent permission mode check (01-22)"
        status: pass
    human_judgment: false
  - id: D4
    description: "counterpoint doctor prints the Agent permission mode line first in Sandbox probe (PASS / FAIL with Fix / NOT CHECKED), counts it, and exits 1 on anything but auto; the real probe pipeline feeds it from the treatment's init events and stderr"
    requirement: FOUND-03
    verification:
      - kind: integration
        ref: "tests/doctor/doctor.test.ts#the Agent permission mode check (01-22)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Trust page: Agent permission mode and Sandbox isolation settings rows first in the Sandbox probe card, nine targets, scoped all-pass wording; eight-row, missing-check, default-mode and isolation-off reports never read all-pass"
    requirement: FOUND-04
    verification:
      - kind: e2e
        ref: "tests/e2e/phases.e2e.test.ts (Trust verdict test plus 7 new cases; each new case also passes alone with -t)"
        status: pass
      - kind: e2e
        ref: "tests/e2e/needs-you.e2e.test.ts#Mission Trust card (Agents are boxed in, one Pass)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The Trust page's visual fit of the two check rows above the probe table (spacing, wrapping of long details and fixes)"
    verification: []
    human_judgment: true
    rationale: "The e2e asserts the rows, words and order, not how the card looks; layout and wrapping need a human look at /h/{host}/trust"

# Metrics
duration: 12min
completed: 2026-11-10
status: complete
---

# Phase 1 Plan 22: Agent permission mode check and the Trust page for the whole gap chain Summary

**`counterpoint doctor` now records the permission mode the probe's treatment session really ran in, from claude's own `system/init` events (every attempt) cross-checked with stderr, and fails anything but `auto` (`AGENT_PERMISSION_MODE`, the mode the argv launches with). The check is an additive `agentMode` field in `counterpoint/doctor/v1`, and no report without it reads pass in `reportVerdict`, the CLI, the Trust API or the console. The Trust page now shows that check and 01-25's Sandbox isolation settings check at the top of the Sandbox probe card, lists all nine probe targets, and uses the scoped all-pass wording that names the sandbox's own local proxy login.**

## Performance

- **Duration:** about 12 min
- **Started:** 2026-11-10T14:34:53Z
- **Completed:** 2026-11-10T14:46:46Z
- **Tasks:** 2 of 2
- **Files modified:** 10 (4 source, 5 test, the UI contract)

## Accomplishments

- **Mode evidence (src/agent/runner.ts).** `sessionModeEvidence` returns one entry per `system`/`init` event in order (its `permissionMode` when a string, else `null`). It also returns every trimmed, non-empty stderr line matching `/permission mode|auto mode/i`. It never reads the argv, the version or the model's prose.
- **Judge and verdict (src/core/security/doctor-report.ts).**
  - `AgentModeCheck` extends `Check` with `id: 'agent-mode'`, `expected` and `effective`.
  - `judgeAgentMode` applies the plan's five rules in order with the planned detail and fix words.
  - Notices are sanitised: control characters (C0, DEL, C1, U+2028, U+2029) become spaces, then the text is trimmed and capped at 300 characters.
  - `reportVerdict` fails when `agentMode` is missing or not `pass`.
  - `DOCTOR_SCHEMA` is unchanged.
  - Core still imports nothing from `src/agent/`.
- **Doctor (src/doctor/run.ts).**
  - `ProbeSummary.agentSession` is required. `liveSandboxProbe` fills it from `sessionModeEvidence(outcome.treatment)`. `outcome.treatment` already merges both attempts, so a retry's init event counts.
  - `runDoctor` judges the mode with `expected: AGENT_PERMISSION_MODE`. A probe that throws gives `modes: null`, so the check reads Not checked.
  - The `Sandbox probe` group prints, in order: the mode line, 01-25's isolation line, then the probe rows. An older report prints `NOT CHECKED  Agent permission mode: not recorded in this report`.
  - `doctorVerdict` counts a missing or failed mode check.
- **Trust page (ui/src/pages/TrustPage.tsx).**
  - `Report` gains `agentMode` and `sandboxIsolation`, parsed with `parseCheck`. Extra fields such as `expected`, `effective` and `sources` are ignored.
  - `PROBE_TARGETS` now holds nine targets.
  - `allChecks` includes both checks, and `trustVerdict` adds 1 for each one that is missing. The Mission Trust card follows through the shared `trustVerdict`.
  - The Sandbox probe card starts with a two-row `Table<CheckRow>`. A missing check shows `Not recorded in this report. Run "counterpoint doctor" again.` with `Not checked`.
  - The all-pass body is the planned text exactly.
  - Astryx components only; no new dependency.
- **UI contract.** 01-UI-SPEC.md has the five planned amendments: the all-pass copy, two Copywriting rows with the doctor words, the Trust screen rows, the CLI order sentence, and the three E8 statements. Nothing else changed.

## Task Commits

1. **Task 1 (tracer): mode evidence, judge, verdict and CLI.** `f896129` (feat). Tracer gate: interactive run, `end-of-phase`, automated-only verify. After the commit I re-ran the targeted verify (3 files, 151 passed). It passed, so I moved on to Task 2.
2. **Task 2: Trust page, e2e and UI-SPEC.** `fea0cd5` (feat).

## Files Created/Modified

- `src/agent/runner.ts`: `sessionModeEvidence` and its notice pattern.
- `src/core/security/doctor-report.ts`: `AgentModeCheck`, `judgeAgentMode`, `DoctorReport.agentMode`, the verdict rule and the header note.
- `src/doctor/run.ts`: `ProbeSummary.agentSession`, the live probe's evidence, `report.agentMode`, the CLI line, the not-recorded line and the verdict count.
- `tests/doctor/doctor.test.ts`:
  - `fakeProbe` takes `agentSession` (default `{ modes: ['auto'], notices: [] }`).
  - The existing Sandbox probe line indexes moved by one.
  - The two real-pipeline fake runners now emit an `init` event with `permissionMode: 'auto'` and pass `sessionModeEvidence(outcome.treatment)`.
  - New: a 6-case "Agent permission mode check (01-22)" describe (one case drives the real `runSandboxProbe` with an auto runner and a forced-default runner), 3 `sessionModeEvidence` cases and 7 `judgeAgentMode` cases.
- `tests/core/security/sandbox-settings.test.ts`: `validReport()` carries a passing `agentMode`. New cases: an older report parses but fails, `fail`/`not-checked` fail, and a wrong id or missing `expected` is rejected.
- `tests/server/phases.test.ts`: the route's `report()` carries `agentMode`. A stored report without it returns `verdict: 'fail'`.
- `ui/src/pages/TrustPage.tsx`: described above.
- `tests/e2e/phases.e2e.test.ts`:
  - `doctorReport()` takes `agentMode`, `sandboxIsolation` and `probe` options.
  - The Trust helpers (`writeReport`, `nudgeUntil`, `showTrust`, `trustRow`) moved to describe scope.
  - The all-pass case now pins: `Blocked` ×9, `Pass` ×9, both new rows with their Supporting words, the banner clause, both check rows with their details, and the card order (mode, isolation, then the probe rows).
  - Seven new cases, as the plan lists them.
- `tests/e2e/needs-you.e2e.test.ts`: `allPassReport()` carries a passing `agentMode`.
- `.planning/phases/01-trusted-shell-signed-runway/01-UI-SPEC.md`: the five amendments.

## Verification

All commands ran with `CP_TEST_SCRATCH=/Volumes/Dock/Dev/Caches/cp-test-0122` and the Dock pnpm env. The e2e commands also set `PLAYWRIGHT_BROWSERS_PATH=/Volumes/Dock/Dev/Caches/ms-playwright`. `pnpm install --frozen-lockfile` ran first.

- Task 1: `pnpm exec vitest run --project unit tests/doctor/doctor.test.ts tests/core/security/sandbox-settings.test.ts tests/server/phases.test.ts`: 3 files, 151 passed. `pnpm typecheck`, `pnpm lint` (`biome ci .`, 132 files) and `pnpm test` (31 files passed, 3 skipped; 995 passed, 4 skipped) all exit 0.
- Task 2:
  - `pnpm typecheck && pnpm lint && pnpm build:ui`: exit 0.
  - `pnpm exec vitest run --project e2e tests/e2e/phases.e2e.test.ts tests/e2e/needs-you.e2e.test.ts`: 2 files, 27 passed.
  - `... -t "without the agent permission mode as not passing"`: `Tests  1 passed | 13 skipped (14)`.
  - The other six new cases also pass alone: `Tests  6 passed | 8 skipped`. That run also matched one existing case.
  - `pnpm test && pnpm test:e2e`: unit 995 passed with 4 skipped; e2e 5 files, 51 passed.
- Acceptance greps:
  - Every planned string is in its file. The baseline for each was 0.
  - The `tr -s` banner grep prints 1.
  - `DOCTOR_SCHEMA` is still `counterpoint/doctor/v1`.
- No live probe ran. No test read the owner's real keys, `~/.claude/settings.json`, `~/.ssh` or Counterpoint home. Every new doctor call goes through `runDoctorCommand` with scratch `settingsLocations`, and 01-25's source scan passes inside `pnpm test`.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

None in substance; the plan was executed as written. Two small additions stay inside its scope and only add strictness:

- The all-pass e2e case also checks the Sandbox probe card's row order and the `cannot write` / `cannot read` Supporting words of the two new rows.
- The UI-SPEC Sandbox isolation row lists every fix template `judgeSandboxIsolation` can emit. The plan said "the three Fix templates", and the judge also has an unreadable-source fix and a launch-missing fix. All are copied word for word.

## Command-guard refusals (surfaced verbatim)

1. The combined worktree branch-check command was refused: "This agent is isolated in the worktree /Volumes/Dock/Projects/HKP/Counterpoint/.claude/worktrees/agent-a43d97b20a2700d7c, but this command names git in a form too complex to verify that it stays inside the worktree. Refusing to run it — a worktree-isolated agent's git operations must target its own worktree. Split it into plain, separate commands and run them from /Volumes/Dock/Projects/HKP/Counterpoint/.claude/worktrees/agent-a43d97b20a2700d7c." I ran `git symbolic-ref --quiet HEAD` and `git rev-parse HEAD` as plain separate commands. The branch was `worktree-agent-a43d97b20a2700d7c` and the base was `25bd20e`, so both assertions held.
2. Two heredoc commands were refused with "… but this command is too complex to verify that it stays inside the worktree. Refusing to run it … Split it into plain, separate commands …":
   - a Python edit script for tests/doctor/doctor.test.ts;
   - an append to the same file.

   In both cases I used the Write tool to put the script in the session scratchpad and ran it with `python3 -I`, or used the Edit tool. That is an editing mechanism only; nothing was routed around.

## Issues Encountered

None.

## Known Stubs

None. The Trust page's `Not recorded in this report` row is the planned rendering of a stored report that lacks a check, not a stub.

## Threat Flags

None. The new surface (stderr notice text shown in the CLI and the console) is T-01-89 in the plan's threat model. It is mitigated: control characters are replaced, the text is capped at 300 characters, and React renders it as text.

## User Setup Required

None.

## Next Phase Readiness

- 01-23 (the live run that closes WINDOWS.md #3) will store `agentMode` from a real treatment. 01-24's evidence shows what that should look like: `auto` in every init event and empty stderr.
- 01-16 (owner-run `counterpoint doctor cena`) is the first real check of the mode on the owner's machine.
- FOUND-03 and FOUND-04 stay unmarked in REQUIREMENTS.md, because `requirements.ready-ids` reports both blocked by sibling plans.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-10*

## Self-Check: PASSED

- This SUMMARY exists, and every modified file is in commits `f896129` and `fea0cd5`.
- `git log --oneline -4` shows `cb105e8` (this SUMMARY), `fea0cd5`, `f896129` and the base `25bd20e`, so `git rev-list --count 25bd20e..HEAD` was 2 before the SUMMARY commit. The working tree was clean.
- The guard refused the combined self-check command (a loop over `git merge-base`) with the same "names git in a form too complex" text. I reran it as plain `git log` and `git status` commands.
- STATE.md, ROADMAP.md and REQUIREMENTS.md were not touched (worktree mode; FOUND-03 and FOUND-04 are blocked in `requirements.ready-ids`).
