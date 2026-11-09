---
phase: 01-trusted-shell-signed-runway
plan: 17
subsystem: security
tags: [sandbox, claude-code, permissions, probe, doctor, gap-closure]

# Dependency graph
requires:
  - phase: 01-04
    provides: buildAgentSandboxSettings, the differential probe (planProbe, buildProbeLaunch, runSandboxProbe), frozen live streams
  - phase: 01-05
    provides: evaluateProbe and the denial-text classifier (mode denials read Not checked)
  - phase: 01-10
    provides: counterpoint doctor (runDoctor, doctor report schema v1, CLI output)
  - phase: 01-11
    provides: the doctor report route and Trust page consumers
provides:
  - "One production launch profile: allowedTools exactly Bash/Read/Grep/Glob (AGENT_TOOLS), permissions.allow exactly Edit(//{workdir}/**) and absent without a workdir"
  - "fileEditGrants(profile): where Write/Edit/MultiEdit/NotebookEdit may write; bare names and unknown scopes fail closed as everywhere"
  - "Eighth probe target outside-workdir ('Files outside the working folder') through planner, evaluator, report and counterpoint doctor"
  - "Scoped evaluator rule isUnlistedPathDenial (MATCHER_REVISION 2), recorded in matcherVersion as {claude}+r2"
  - "Stale outside-canary sweep under the user home (PROBE_OUTSIDE_DIR_RE, PROBE_OUTSIDE_ARTIFACT_RE)"
affects: [01-18, 01-19, 01-20, phase-02-builders]

# Actuals (#2632): chars/4 over the realized diff (93,917 chars)
actuals:
  tokens: 23479
  tasks: 2
  commits: 2
plan_head_before: 92f4f1d780011e8d0acefb4e928977792421b9c3
plan_head_after: 40bf513

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Launch profile = settings + allowedTools from one builder; probe launches plan.treatmentProfile unchanged"
    - "Grant analysis (fileEditGrants) read off the exact launched profile and handed to the evaluator"
    - "Scoped, record-agreeing, grant-aware acceptance of a mode denial for one probe row only"

key-files:
  created: []
  modified:
    - src/core/security/sandbox-settings.ts
    - src/agent/probe.ts
    - src/agent/probe-evaluator.ts
    - src/core/security/doctor-report.ts
    - src/doctor/run.ts
    - src/core/ids.ts
    - tests/core/security/sandbox-settings.test.ts
    - tests/agent/probe-plan.test.ts
    - tests/agent/probe-evaluator.test.ts
    - tests/doctor/doctor.test.ts
    - tests/server/phases.test.ts
    - tests/e2e/phases.e2e.test.ts
    - tests/e2e/needs-you.e2e.test.ts

key-decisions:
  - "Allow-only-workdir (Edit(//{workdir}/**) as the only grant, no bare Write/Edit) fixes WINDOWS.md #2; an Edit(//**) deny with a workdir exception was rejected because deny wins over allow"
  - "Without a workdir the builder emits no allow key at all, so nothing can be edited (fail closed)"
  - "fileEditGrants treats any scope it does not understand (relative, ~, glob, .., filesystem root, lowercase tool name) as a grant everywhere"
  - "The mode-denial acceptance is scoped to the outside-workdir Write and Edit steps; every other target keeps mode denials Not checked"
  - "Schema stays counterpoint/doctor/v1 with an additive row; the classifier revision rides in matcherVersion"

patterns-established:
  - "New probe rows append their steps after existing ones so frozen fixture indices stay valid"
  - "Probe artifacts outside the probe dir: exclusive create, remove only known names, then rmdir; never recursive"

requirements-completed: []  # FOUND-03, FOUND-04 are shared with 01-16, 01-18, 01-19, 01-20 (shared-ID gate: blocked until the last declaring plan finishes)

coverage:
  - id: D1
    description: "The production launch profile grants file edits only inside the workdir (allow = Edit(//workdir/**), tools = Bash/Read/Grep/Glob, every deny kept)"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/core/security/sandbox-settings.test.ts#grants file edits only inside the workdir: permissions.allow is exactly Edit(//work/**)"
        status: pass
      - kind: unit
        ref: "tests/core/security/sandbox-settings.test.ts#fileEditGrants"
        status: pass
      - kind: unit
        ref: "tests/agent/probe-plan.test.ts#launches the treatment with the production profile: Bash, Read, Grep, Glob and Edit(//probeDir/**)"
        status: pass
    human_judgment: false
  - id: D2
    description: "counterpoint doctor plans, evaluates, stores and prints the eighth row 'Files outside the working folder'; an outside write reads REACHABLE end to end with a fake claude"
    requirement: FOUND-03
    verification:
      - kind: integration
        ref: "tests/doctor/doctor.test.ts#reads Files outside the working folder REACHABLE through the real probe pipeline (fake claude)"
        status: pass
      - kind: unit
        ref: "tests/agent/probe-plan.test.ts#launches both sessions through buildProbeLaunch and cleans up every artifact"
        status: pass
    human_judgment: false
  - id: D3
    description: "Scoped evaluator rule: agreed mode denials count only for the outside-workdir Write/Edit steps with no covering grant; mode-only.jsonl stays Not checked for git-hooks and git-info"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/agent/probe-evaluator.test.ts#the outside-workdir row (scoped mode-denial rule)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A seven-row (pre-gap) report still parses as schema v1 and fails reportVerdict"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/core/security/sandbox-settings.test.ts#fails a report that holds only the seven pre-gap probe rows"
        status: pass
    human_judgment: false
  - id: D5
    description: "Stale outside canaries under the home are swept (known names only, never recursive, symlinks not followed) and named in the outside-workdir row"
    verification:
      - kind: unit
        ref: "tests/agent/probe-plan.test.ts#removes stale outside-workdir canary dirs under the home, and nothing else"
        status: pass
      - kind: integration
        ref: "tests/doctor/doctor.test.ts#names a stale outside-workdir canary in the Files outside the working folder row"
        status: pass
    human_judgment: false
  - id: D6
    description: "Real claude refuses Write/Edit outside the workdir under the new profile (live probe)"
    requirement: FOUND-04
    verification: []
    human_judgment: true
    rationale: "Out of scope for this plan by design: 01-18 runs the live probe on the owner's claude, refreezes fixtures and marks WINDOWS.md #2 fixed. Nothing here proves live behaviour."

# Metrics
duration: 16min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 17: Confined file edits and the outside-workdir probe row Summary

**The one production launch profile now grants file edits only through `Edit(//{workdir}/**)`, with the tools `Bash, Read, Grep, Glob`. Under dontAsk, every Write or Edit outside the session folder is refused. `counterpoint doctor` measures this as an eighth probe row, "Files outside the working folder", through a scoped, grant-aware evaluator rule. This plan proves that end to end with a fake claude only; 01-18 does the live proof.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-11-09T21:57:28Z
- **Completed:** 2026-11-09T22:13:34Z
- **Tasks:** 2 of 2
- **Files modified:** 13

## Accomplishments

- **Cause of WINDOWS.md #2 removed from the launch profile.**
  - What changed: `buildAgentSandboxSettings` now returns `allowedTools` (always `AGENT_TOOLS` = Bash/Read/Grep/Glob) and `workdir`. `permissions.allow` is exactly `Edit(//{workdir}/**)`, and there is no `allow` key at all without a workdir.
  - The probe no longer has its own bare `Write`/`Edit` tool list (`TREATMENT_TOOLS` is deleted). It launches `plan.treatmentProfile`, whose workdir is always the probe directory.
  - Every existing deny is unchanged, including `Edit(//{workdir}/.claude/**)`.
- **`fileEditGrants(profile)`** reports where file-edit tools may write. A bare name, an unknown scope, a glob, `..`, `~`, a relative path, the filesystem root and lowercase names all count as `everywhere`, so it fails closed.
- **The eighth probe row, `outside-workdir`.**
  - The treatment session uses the canary dir `{homeDir}/.cp-outside-{nonce}`, which is validated (absolute, exact name, no quote, disjoint from the probe dir and all protected paths). It runs three steps: Write, a preparatory Read before Edit, and Edit (old/new strings), appended after the git steps so the 01-04 indices hold.
  - The control session runs the same steps against the twin `{mirror}/outside-workdir`.
  - The probe checks the post-state: the Write file existing, or the Edit file changed or missing, makes the row Reachable.
  - Cleanup creates the dir exclusively, removes only the two known names, then calls rmdir.
- **Scoped evaluator rule (MATCHER_REVISION 2).**
  - `isUnlistedPathDenial` accepts a mode denial only for the outside-workdir Write/Edit steps. Every record must agree: is_error, mode text, reject with reason_type mode, listed in `permission_denials`, and the `permission_denied` event (if present) gives `mode`. The treatment's `fileEditGrants` must also show no grant covering the path.
  - Evidence label: `denied: no allow rule covers this path`.
  - A Read before Edit that did not reach the file makes the row Not checked.
- **Report and doctor.**
  - `PROBE_TARGET_IDS` has 8 entries, with `probeTargetMode(id)`. The schema is still `counterpoint/doctor/v1`.
  - `matcherVersion` is now `2.1.319+r2`.
  - Stale outside leftovers are attributed to the new row.
  - Synthesized rows use the correct mode.
- **Stale outside-canary sweep** under the user home: real directories only (a symlink is never followed), `cp-{nonce}-w|e` regular files only, then rmdir.

## Task Commits

1. **Task 1 (tracer): confine file edits to the workdir and carry the outside-workdir row to `counterpoint doctor`.** `08da0ec` (feat)
2. **Task 2: scoped evaluator rule, stale outside-canary sweep, eighth row in every stored-report fixture.** `40bf513` (feat)

Tracer feedback gate after Task 1: the run is interactive, the mode is `end-of-phase`, and the verify is automated-only. I re-ran the verify, it passed, and Task 2 followed with no checkpoint.

## Verification Results

| Command | Result |
|---------|--------|
| `pnpm typecheck && pnpm lint` | exit 0 (after each task) |
| `vitest run --project unit` on the five Task 1 files | 181 passed |
| `vitest run --project unit tests/core/security/sandbox-settings.test.ts -t "fails a report that holds only the seven pre-gap probe rows"` | `1 passed` (70 skipped) |
| `vitest run --project unit` on the three Task 2 files | 115 passed |
| `pnpm build:ui && pnpm test` | 765 passed, 1 skipped (the gated live probe), 30 files |
| `pnpm test:e2e` | 44 passed, 5 files |

Every test command ran with `CP_TEST_SCRATCH=/Volumes/Dock/Dev/Caches/cp-test-0117` and the Dock pnpm env vars. The e2e run also set `PLAYWRIGHT_BROWSERS_PATH=/Volumes/Dock/Dev/Caches/ms-playwright`. No live probe ran. The only runners and KeychainPorts used were fakes.

## Files Created/Modified

- `src/core/security/sandbox-settings.ts`: AGENT_TOOLS, FILE_EDIT_TOOLS, fileEditGrants. The builder emits the workdir edit grant, `allowedTools` and `workdir`. The header explains why bare Write/Edit are gone.
- `src/agent/probe.ts`:
  - treatmentProfile, outsideRoot/outside/outsideMirror, and ProbeWriteTarget.
  - The Write / Read-before-Edit / Edit steps.
  - `LaunchSession.allowedTools`, and `ProbeLaunchInput.treatment`.
  - Outside canary lifecycle and post-state leftovers.
  - Passes `treatmentEditGrants`.
  - `sweepStaleArtifacts({ homeDir })`.
- `src/agent/probe-evaluator.ts`: Edit matching and rule text, outside-row logic, MATCHER_REVISION, isUnlistedPathDenial, `denied-unlisted`, `EvaluateProbeOptions.treatmentEditGrants`.
- `src/core/security/doctor-report.ts`: eighth target and label, probeTargetMode, header.
- `src/doctor/run.ts`: matcherVersion `{claude}+r{revision}`, outside-dir leftovers mapped to `outside-workdir`, probeTargetMode for synthesized rows.
- `src/core/ids.ts`: PROBE_OUTSIDE_DIR_RE, PROBE_OUTSIDE_ARTIFACT_RE.
- `tests/...`:
  - Profile and grants tests, and the seven-row report test.
  - Outside step and validation tests, the lifecycle test with an outside write, and the sweep tests.
  - Scoped-rule tests with synthetic outside events.
  - The doctor end-to-end REACHABLE test, plus `+r2`, stale-leftover and mode tests.
  - Route and e2e fixtures with eight rows.

## Decisions Made

- Allow-only-workdir, following the plan's design notes. An `Edit(//**)` deny with a workdir exception was rejected because deny is evaluated before allow, so it would also block the workdir.
- `fileEditGrants` also fails closed on lowercase tool names and on a `//` root that is the filesystem root. Neither form appeared in the plan's list, but both are unknown or over-broad scopes.
- `targetOfPath` in doctor compares against both the given home and its realpath, so a symlinked home still attributes swept outside dirs to the right row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Wider fail-closed parsing in `fileEditGrants`**
- **Found during:** Task 1
- **Issue:** The plan listed bare names and "any other argument form" as `everywhere`. A literal reading would accept `Edit(//x/*/y/**)`, `Edit(//x/../y/**)`, `Edit(///**)` or `edit` as a scoped root or as no grant.
- **Fix:** Globs, `.`/`..` segments, the filesystem root and case-insensitive tool names all count as `everywhere`.
- **Verification:** The `fileEditGrants` `fails closed on …` test cases.
- **Committed in:** `08da0ec`

**2. [Test construction] The git-info scope pin needs a mutated copy of mode-only.jsonl**
- **Found during:** Task 2
- **Issue:** In `mode-only.jsonl`, git-info's Write is refused by a deny rule, and the existing 01-05 test pins git-info Blocked for that stream. Only git-hooks carries the mode denial. So "mode-only.jsonl yields Not checked for git-hooks and git-info" cannot hold for the unmodified file.
- **Fix:** The scope-pin test uses the unmodified file for git-hooks. For git-info, it uses a copy whose git-info Write is refused by the mode with every record agreeing. Both read Not checked with grants `{ everywhere: false, roots: [] }`, and `isUnlistedPathDenial` returns false for both. No check was weakened. The pin is stricter than the plan text: the git-info record agrees fully, and the row still is not accepted.
- **Committed in:** `40bf513`

**3. [Updated existing test] "all seven targets Blocked" became "the seven earlier targets Blocked, outside-workdir Not checked"**
- **Found during:** Task 1
- **Issue:** The frozen 01-04 pair predates the new row, so its outside steps read skipped.
- **Fix:** Renamed the test and asserted the eighth row is Not checked. A new Task 2 test shows all eight Blocked once synthetic agreed outside events are added.
- **Committed in:** `08da0ec`

---

**Total deviations:** 1 auto-fixed (Rule 2), 2 test-construction notes. **Impact:** Every fail-closed check is as strict as before or stricter. No scope creep.

## Issues Encountered

- **Command-guard refusals (reported verbatim; no workarounds attempted):**
  - The first combined worktree-check shell command was refused: "this command names git in a form too complex to verify that it stays inside the worktree". I ran the same assertions as separate plain commands. Branch `worktree-agent-abce8904f364b3465` and base `92f4f1d` were both confirmed.
  - A Python heredoc edit was refused as "too complex to verify". I made those edits with the Edit/Write tools instead.
  - Writing the plan commit ledger to `.git/worktrees/agent-abce8904f364b3465/gsd-plan-head-before-01-17` was refused: "Edit the worktree copy of this file instead of the shared-checkout path". I did not write it elsewhere. Commits were measured against the base SHA given in the prompt (`git rev-list --count 92f4f1d..HEAD` = 2).

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. The new home-directory canary is T-01-68, mitigated as planned: exclusive create, known names only, rmdir, regex-limited sweep, symlinks not followed.

## User Setup Required

None.

## Next Phase Readiness

- **01-18 (live slice):**
  - Run the live probe. Refreeze `live-treatment.jsonl`/`live-control.jsonl` so they contain the outside steps, then update the evaluator test's nonce and canary values.
  - Add the row to the Trust page (`ui/src/pages/TrustPage.tsx` still lists seven) and to its e2e Blocked count.
  - Update `tests/agent/probe.live.test.ts` (COUNTERPOINT_LIVE_PROBE-gated, untouched here). Its expected verdict map and header comment still list seven targets, so a live run will fail that `toEqual` on the new eighth row until it is updated.
  - Expected live evidence for the new row: Write and Edit refused with `reason_type` mode ("…running in don't ask mode") and listed in `permission_denials`, the Read before Edit reached, and the control reaching all three mirror steps.
- **Recommendations for 01-18-SUMMARY:**
  - The owner decision on `permissions.blockWritesOutsideWorkingDirectories` as a second layer.
  - The Claude-managed exempt files residual (T-01-70).
- **Phase 2 builders** inherit this profile: their workdir is the only edit grant, and any narrower builder grant must still pass through `fileEditGrants` analysis.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

## Self-Check: PASSED

- All six modified source files and this SUMMARY exist on disk.
- Commits `08da0ec`, `40bf513` and `f161255` are on this branch (`git log 92f4f1d..HEAD`), and the working tree is clean.
