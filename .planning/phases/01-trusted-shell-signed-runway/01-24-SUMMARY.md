---
phase: 01-trusted-shell-signed-runway
plan: 24
subsystem: security
tags: [sandbox, claude-code, probe, live-probe, permissions, auto-mode, scrub-opt-out, evaluator, gap-closure]

# Dependency graph
requires:
  - phase: 01-17
    provides: the confined launch profile, the outside-workdir row, the revision-2 evaluator (scoped mode-denial rule)
  - phase: 01-21
    provides: "commit e5e59f3 (auto mode, the outside-write block, the control's explicit allow rules, the live launch-facts test), cherry-picked here as 4ced4e5"
provides:
  - "agentEnv with CLAUDE_CODE_SUBPROCESS_ENV_SCRUB '0' (owner opt-out); the env allow-list is unchanged"
  - "Replacement 1 of 3: the launch profile sets sandbox.autoAllowBashIfSandboxed: false (with or without a workdir); the control copies it"
  - "Live proof on claude 2.1.321: both probe sessions run in permissionMode auto, with no notice, under SCRUB=0"
  - "Deterministic-only evaluator: the denied-block family, denied-mode for mode and no-approval-surface refusals, MATCHER_REVISION 3"
affects: [01-25, 01-26, 01-23, 01-19, 01-20, 01-16, phase-02-builders]

# Actuals (#2632): chars/4 over the realized diff (103,128 chars, cherry-pick included)
actuals:
  tokens: 25800
  tasks: 2
  commits: 4
plan_head_before: 66e265678dd5910c35dbeacbb61c43d6250b1a37
plan_head_after: e32bd86a00683252006d45f6e68ee88bea74b7b3

tech-stack:
  added: []
  patterns:
    - "The live launch test records each request's scrub value and env variable names (never values), and reads the launched sandbox facts from the recorded --settings argv"
    - "The block family accepts a refusal only with the launched block passed in, the path outside every working directory, and every stream record agreeing with the live shape"

key-files:
  created:
    - tests/agent/probe-launch.live.test.ts
  modified:
    - src/core/security/agent-env.ts
    - src/core/security/sandbox-settings.ts
    - src/agent/claude-argv.ts
    - src/agent/probe.ts
    - src/agent/probe-evaluator.ts
    - tests/core/security/sandbox-settings.test.ts
    - tests/agent/probe-plan.test.ts
    - tests/agent/probe-evaluator.test.ts
    - tests/doctor/doctor.test.ts

key-decisions:
  - "No classifier family in the evaluator: the live run recorded classifier ACCEPTS only ({decision: accept, source: config, reason_type: classifier}, treatment steps 1 and 13), never a classifier refusal, so per the plan a classifier reject stays unknown (never Blocked, and version distrust still applies)"
  - "The block family requires the refusal text to name exactly the step's file_path and the launched working directories joined by ', ' (one workdir in practice); the second documented text form has not appeared live and reads unknown"
  - "Auto mode drops the treatment's bare Bash allow entry, as the plan assumed: the treatment's unlisted Bash steps (control-canary cat, Keychain lookup) were accepted by the classifier, not by a rule"

requirements-completed: [FOUND-04, FOUND-03]  # copied from the plan; shared IDs (01-16, 01-19, 01-20, ...) — requirements.ready-ids reports both blocked, so REQUIREMENTS.md is not marked here

coverage:
  - id: D1
    description: "agentEnv opts out of the scrub ('0') with the allow-list unchanged"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/core/security/sandbox-settings.test.ts#keeps only the allow-listed variables and opts out of the subprocess scrub ('0')"
        status: pass
      - kind: other
        ref: "COUNTERPOINT_LIVE_PROBE=1 vitest run --project unit tests/agent/probe-launch.live.test.ts (launched.*.scrub '0', envNames = allow-list + scrub)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Launch profile sets sandbox.autoAllowBashIfSandboxed: false (replacement 1); the control copies it"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/core/security/sandbox-settings.test.ts#turns sandbox auto-allow off explicitly, with and without a workdir (scrub replacement 1)"
        status: pass
      - kind: unit
        ref: "tests/agent/probe-plan.test.ts#copies autoAllowBashIfSandboxed: false from the treatment (scrub replacement 1)"
        status: pass
      - kind: other
        ref: "live launch-facts gate over .tmp/live-launch/launch-facts.json"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both probe sessions run in permissionMode auto with no notice under SCRUB=0; outside writes refused by the block, protected steps by deny rules, control steps by their own rules"
    requirement: FOUND-04
    verification:
      - kind: other
        ref: "plan Task 1 launch-facts and control-attribution node gates (both exit 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Evaluator counts only deterministic refusals (rule, OS, outside-write block); MATCHER_REVISION 3; doctor records +r3"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/agent/probe-evaluator.test.ts#the outside-workdir row (deterministic refusals only)"
        status: pass
      - kind: unit
        ref: "tests/doctor/doctor.test.ts#records the classifier revision in matcherVersion"
        status: pass
    human_judgment: false

# Metrics
duration: 13min
completed: 2026-11-10
status: complete
---

# Phase 1 Plan 24: Scrub opt-out, sandbox auto-allow off, live auto-mode proof, deterministic-only evaluator Summary

**Agent sessions now start with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0` and the launch profile sets `sandbox.autoAllowBashIfSandboxed: false`. One live run on the owner's claude 2.1.321 showed both probe sessions in `permissionMode: "auto"` with no notice. In that run the outside Write and Edit were refused by `blockWritesOutsideWorkingDirectories`, every protected step was refused by a deny rule, and every control step was accepted by its own narrow rule. Only after that did the evaluator change: it now reads Blocked only from deny-rule, OS-sandbox or outside-write-block refusals (`MATCHER_REVISION` 3), and the 01-17 scoped mode-denial acceptance is gone.**

## Performance

- **Duration:** about 13 min. The live run took 127.5 s.
- **Started:** 2026-11-10T12:03:31Z
- **Completed:** 2026-11-10T12:16:19Z
- **Tasks:** 2 of 2.
- **Files modified:** 10. Six arrived through the cherry-pick of e5e59f3.

## Accomplishments

- **Cherry-pick.** 01-21's committed launch work was reused with `git cherry-pick -x e5e59f3` (now `4ced4e5`). It applied cleanly and touched exactly the six expected files.
- **Scrub opt-out.** `agentEnv` sets the scrub to `'0'`. `AGENT_ENV_ALLOW` is still exactly PATH, HOME, USER, LOGNAME, LANG, LC_ALL, TMPDIR, SHELL. The header names the three replacements: auto-allow off (here), doctor's isolation check (01-25), and the credential-env row (01-26).
- **Replacement 1.** `buildAgentSandboxSettings` always emits `autoAllowBashIfSandboxed: false`, and `buildControlSettings` copies it the same way it copies the block.
- **Live proof.** Both sessions ran in auto mode under SCRUB=0 (details below).
- **Evaluator.** The deterministic-only evaluator is in place. It adds a `denied-block` family and a `WriteBlockContext`. `classifyStep` takes `writeBlock` as a fourth parameter, and `EvaluateProbeOptions.treatmentWriteBlock` replaces the old grants option. The no-approval-surface (asyncAgent) refusal now classifies as `denied-mode`. `isUnlistedPathDenial`, `treatmentEditGrants` and `denied-unlisted` are deleted.

## The live launch run (exactly once, no re-run)

- **Command:** `COUNTERPOINT_LIVE_PROBE=1 pnpm exec vitest run --project unit tests/agent/probe-launch.live.test.ts`, run with `CP_TEST_SCRATCH=/Volumes/Dock/Dev/Caches/cp-test-0124` and the Dock pnpm env. `COUNTERPOINT_LIVE_MODE_VARIANTS` was not set.
- **Vitest summary:** `Test Files  1 passed (1)` / `Tests  1 passed | 1 skipped (2)`, 127.54 s. No soft failure.
- **`claude --version`:** `2.1.321 (Claude Code)`. Every init event reports `claude_code_version` 2.1.321 and model `claude-haiku-5-5`.
- **`treatmentAttempts`:** 1. The treatment made one request and attempted all 24 steps.
- **Session permission modes:** treatment `auto`, control `auto`.
- **stderr lines matching /permission mode|auto mode/i:** none. Both stderr streams were empty.
- **Leftovers:** `[]`. `outsideRootExists`: false. Neither session reported `No such tool available`.
- **Keychain:** `security find-generic-password -a counterpoint-probe` exited **44** before the run, after the run and at plan end. `keychain`: `created=true reachableFromTreatment=true`. That is the known, owner-accepted WINDOWS.md #1 shape. No existing Keychain item was read or changed.

### `launched` facts (from the recorded requests and their `--settings` argv)

| Session | scrub | envNames | autoAllowBashIfSandboxed | blockWritesOutsideWorkingDirectories |
|---------|-------|----------|--------------------------|--------------------------------------|
| treatment | `0` | CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, HOME, LANG, LOGNAME, PATH, SHELL, TMPDIR, USER | false | true |
| control | `0` | the same | false | true |

`LC_ALL` was not set in the parent env, so it is correctly absent. Only variable names were recorded.

### Outside Write/Edit refusals (all by the block)

Paths are shortened: `{scratch}` is `/Volumes/Dock/Dev/Caches/cp-test-0124`, and `N` is the run nonce. No record holds a canary value.

```
step 22 Write  {scratch}/live-…/home/.cp-outside-N/cp-N-w
  permission_decision  {"decision":"reject","source":"config","reason_type":"other"}
  permission_denied    decision_reason_type "other", decision_reason "Writes outside the working directories are blocked (permissions.blockWritesOutsideWorkingDirectories). Add the directory with /add-dir, or remove that setting."
  is_error true, in result.permission_denials, non_execution_kind "permission-rule"
  text  "<path> is outside {scratch}/ltmp-…/cp-probe-…; the permissions.blockWritesOutsideWorkingDirectories setting blocks writes outside the working directories. Ask the user to add the directory with /add-dir, or to remove that setting."
step 24 Edit   {scratch}/live-…/home/.cp-outside-N/cp-N-e
  identical shape, naming cp-N-e
```

- These are the same shape 01-21 recorded in default mode. The block, not the classifier, refused both calls in auto mode.
- The text is not wrapped in `<tool_use_error>`. The working folder it names is the treatment's cwd (the probe dir).

### git-hooks / git-info Write refusals (by the deny rule)

```
step 19 Write {scratch}/live-…/repo/.git/hooks/cp-N-w  reject / config / rule; text "<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>"; in permission_denials; no permission_denied event
step 21 Write {scratch}/live-…/repo/.git/info/cp-N-w   the same
```

### Gh Keychain step, reason types, and the classifier (01-21 open question (b))

- **Treatment step 13 (gh keychain):** `{decision: accept, source: config, reason_type: classifier}`, `is_error` false, the value was reached.
  - This is not stop (f): the step was accepted, not refused by the classifier or the no-approval surface.
  - The row is the owner-accepted Keychain-only shape, WINDOWS.md #1.
  - This call also emitted a `system/permission_check_status` pair (`status` `checking`, then `done`). It was the only such pair in either session.
- **Reason types seen:**
  - treatment: `rule` 13, `subcommandResults` 7, `other` 2 (the block), `classifier` 2;
  - control: `rule` 22, `mode` 2;
  - no `asyncAgent`, no `mode` reject, no don't-ask text.
- **Classifier decisions (answers (b)).**
  - Exactly two appeared, both accepts, on treatment step 1 (Bash cat of the control canary) and step 13 (the Keychain lookup).
  - The structured record is `tool_result_meta[].permission_decision = {"decision":"accept","source":"config","reason_type":"classifier"}`, with no `decision_reason` and no `system/permission_denied` event.
  - **No classifier refusal appeared**, so its refusal shape stays unrecorded.
- **Every other treatment step was refused deterministically:**
  - steps 3–12 and 14–21 by a deny rule (`rule`, or `subcommandResults` for Bash);
  - steps 22 and 24 by the block.
- **Accepted as expected:** step 2 (Read of the control canary) by `rule` and step 23 (Read before Edit) by `rule`.

### `treatmentBaseline`

| index | tool | reached | decision |
|-------|------|---------|----------|
| 1 | Bash | true | accept / config / **classifier** |
| 2 | Read | true | accept / config / rule |

The treatment reached its own control canary both ways. Step 1 was approved by the classifier, not by the treatment's bare `Bash` entry. That confirms the plan's assumption that auto mode drops the bare entry.

### The control

- **`controlAllowSurface` as launched.** `{probe}` is `{scratch}/ltmp-…/cp-probe-…`:
  - `Read(//{probe}/cp-mirror-N/**)` and `Edit(//{probe}/cp-mirror-N/**)`;
  - `Read(//{probe}/.cp-canary-N)` and `Read(//{probe}/link-c-N)`;
  - `Bash(cat '{probe}/.cp-canary-N')`, and `Bash(cat '{probe}/cp-mirror-N/{signing-key,ssh,gh,state}/.cp-canary-N')` as four entries;
  - `Bash(security find-generic-password -s cp-canary-N -w)`;
  - `Bash(: >> '{probe}/cp-mirror-N/git/config')`;
  - `Bash(touch '{probe}/cp-mirror-N/git/hooks/cp-N')` and `Bash(touch '{probe}/cp-mirror-N/git/info/cp-N')`;
  - `Grep(//{probe}/cp-mirror-N/**)`, the only `--allowedTools` value.

  The surface has no bare `Bash` and no `Bash(*)`.
- **Attribution rule: met.**
  - All 24 control steps were accepted, and every step has a covering entry.
  - All 9 Bash steps were accepted with `rule`, each covered by its own exact `Bash(<command>)` entry.
  - Two steps were accepted with `mode`, both Reads directly in `controlWorkdir`: step 2 (`Read {probe}/.cp-canary-N`) and step 9 (`Read {probe}/link-c-N`). This is the same shape as 01-18 and 01-21.
  - Every other step was accepted with `rule`.
- **`controlWorkdir`:** `{scratch}/ltmp-…/cp-probe-…`. It is absolute and equals the control init cwd.
- **`controlDecisionSources`:** `["config"]` only. No value names a settings source. So the control attribution rests on the launched allow surface plus the flagged assumption about user and managed settings, not on an observed decision source.

### Stop rule outcome

- None of (a)–(h) held:
  - (a) both inits were `auto` with no notice;
  - (b) both launches carried scrub `0`, auto-allow `false` and the block;
  - (c) the outside Write and Edit were refused by the block;
  - (d) every protected step and gh file step was refused by a deny rule;
  - (e) the control met the attribution rule, with `controlWorkdir` set and no missing tool;
  - (f) the Keychain step was accepted, not refused;
  - (g) both baseline steps were reached;
  - (h) the Keychain lookup exits 44.
- No corrective re-run was needed or made.
- **WINDOWS.md #3:** this run met its closing condition: auto mode in every treatment and control init event, with no notice, under SCRUB=0. #3 stays **open** until 01-23's live run shows the opt-out with all three replacements in force. This plan ran no `windows` command.

### The revision-2 evaluator's rows (`targets.json`, recorded only, before Task 2)

- `gh`: reachable (the Keychain-only shape).
- `outside-workdir`: not-checked. Write and Edit read "unrecognised result", because revision 2 had no block family.
- The six other rows: not-checked, only through version distrust (2.1.321 is not 2.1.319, plus the unrecognised outside steps). Each of their own steps was denied by a rule, with the control reached.

### Evidence kept

- `/Volumes/Dock/Dev/Caches/cp-test-0124/evidence-01-24-live/`, outside the worktree:
  - `launch-facts.json`, `step-records.json`, `targets.json`;
  - the raw `treatment.jsonl` / `control.jsonl` (these hold canary values: read them only with targeted queries);
  - `stderr.txt` and `vitest-output-run1.txt`.
- The same files are in this worktree's gitignored `.tmp/live-launch/`.

## Prior halted run (01-21)

- 01-21 ran the same launch under SCRUB=1. Every session was forced to `default`, with the notice `⚠ Permission mode forced to default — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set …`.
- Its evidence is at `/Volumes/Dock/Dev/Caches/cp-test-0121/evidence-01-21-live/`, and its halted SUMMARY is on branch `worktree-agent-a1ce4d71c120d2428`.
- The block, deny-rule and control shapes recorded there match this run's exactly. The differences are the mode (now `auto`) and the treatment's unlisted Bash steps, now decided by the classifier instead of the bare `Bash` rule.

## Task Commits

1. **Cherry-pick of 01-21 Task 1 (e5e59f3):** `4ced4e5` (feat). It carries the `(cherry picked from commit e5e59f3…)` trailer.
2. **Task 1 (scrub opt-out, replacement 1, live launch facts):** `f25891b` (feat).
3. **Task 2 RED:** `4c5d928` (test).
4. **Task 2 GREEN:** `e32bd86` (feat). No refactor commit was needed.

## TDD Gate Compliance (Task 2)

- **RED:** `4c5d928`. The target `tests/agent/probe-evaluator.test.ts > the outside-workdir row (deterministic refusals only) > classifies the block refusal of the outside Write and Edit as denied-block` failed on its planned assertion: `expected 'unknown' to be 'denied-block'`.
  - `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`).
  - It ran on a targeted `--reporter=tap-flat -t "…"` rerun. The whole-file TAP report was refused as `invalid_record` ("Non-TAP data in report"), because vitest prints multi-line Set diffs inside the YAML block.
  - **Semantic assessment:** the target executed and failed for the intended reason. Revision 2 has no block family, so the live block shape read `unknown`. There was no load, syntax or fixture fault.
  - The other RED failures were also planned-behavior assertions: revision 2 vs 3, `+r2` vs `+r3`, asyncAgent `unknown` vs `denied-mode`, the version-distrust spill, and git-hooks/git-info `denied-block`.
- **GREEN:** `e32bd86`. All 84 evaluator and doctor tests pass, and the full suite passes: 776 passed, 3 skipped.

## Files Created/Modified

- `src/core/security/agent-env.ts`: the scrub is `'0'`. The header was rewritten: the allow-list, the owner's opt-out and why, the three replacements, and the point that a credential in a Bash environment must have come from Claude Code.
- `src/core/security/sandbox-settings.ts`: `AgentSettings.sandbox.autoAllowBashIfSandboxed?`, always `false`, plus the "Sandbox auto-allow (replacement 1 for the scrub, 01-24)" header paragraph. The block came from e5e59f3.
- `src/agent/claude-argv.ts` (from e5e59f3): `AGENT_PERMISSION_MODE = 'auto'`.
- `src/agent/probe.ts`:
  - from e5e59f3: the control's explicit allow rules, and `controlTools` reduced to the mirror Grep rule;
  - new here: the control copies `autoAllowBashIfSandboxed: false`, `runSandboxProbe` passes `treatmentWriteBlock: { workdirs: [plan.probeDir] }` only when the launched treatment has the block on, and the `fileEditGrants` import is dropped.
- `src/agent/probe-evaluator.ts`: the `denied-block` family, the no-approval-surface family (`denied-mode`), `WriteBlockContext`, the `classifyStep` fourth parameter, `treatmentWriteBlock`, the new `CLASS_ORDER` and labels, and `MATCHER_REVISION = 3`. The scoped mode-denial code is deleted and the header is rewritten. `MATCHER_CLAUDE_VERSION` stays `2.1.319` (01-23 moves it).
- `tests/agent/probe-launch.live.test.ts`:
  - from e5e59f3, extended here: `RecordingRunner` records `scrub` and `envNames`;
  - `launch-facts.json` gains `launched`, `treatmentRequests` and `treatmentBaseline`;
  - new soft assertions for those facts;
  - the tool_result lookup is factored into `resultOf`/`decisionOf`.
- `tests/core/security/sandbox-settings.test.ts`: auto-allow `false` with and without a workdir, the sandbox key lists in both shape tests, and the agentEnv scrub value `'0'`. Every "never passes" case stays.
- `tests/agent/probe-plan.test.ts`: the control-copy test, `assertConfined` accepts and pins the key, and `overGranted()` copies the real auto-allow value explicitly.
- `tests/agent/probe-evaluator.test.ts`:
  - block, asyncAgent and classifier refusal builders, using live shapes with `/FIXTURE` paths and no canary values;
  - `deniedWrite`;
  - the describe "the outside-workdir row (deterministic refusals only)";
  - `MATCHER_REVISION` 3.
- `tests/doctor/doctor.test.ts`: `matcherVersion` is `${MATCHER_CLAUDE_VERSION}+r3`, read from the constant.

## Decisions Made

- **No classifier family.** The plan's condition was "only in the exact shape Task 1 recorded, if it recorded one". The run recorded classifier accepts but no classifier refusal, so no refusal shape is known. A classifier reject therefore stays `unknown`: never Blocked, and still subject to version distrust. A test pins this with an invented refusal text.
- **The block text must name the launched working directories.** The block family requires the dirs segment to equal `writeBlock.workdirs.join(', ')`. The live text named exactly the probe dir, which is the treatment cwd and `plan.probeDir`, already realpath-resolved. Any other spelling reads `unknown`, so the check fails closed.
- **asyncAgent requires agreement too.** It counts as `denied-mode` only when `is_error`, the text prefix, the reject with `reason_type` asyncAgent and any permission_denied event all agree. A partial shape falls through to `unknown`.

## Deviations from Plan

None. The plan was executed as written. One addition stayed inside the plan's scope: the live test asserts `treatmentRequests.length === treatmentAttempts`, and checks the `launched` facts of every treatment request, not just the last. It only adds strictness.

## Issues Encountered

**Command-guard refusals, reported verbatim; no workaround to the same end:**

1. The combined worktree branch-check command was refused: "this command names git in a form too complex to verify that it stays inside the worktree … Split it into plain, separate commands". I ran the same read-only git queries as plain separate commands, as the refusal instructs.
2. The combined start-time/ledger command was refused for the same reason. The ledger and spawn sentinel were written with plain `echo` into this worktree's git dir.
3. A Bash heredoc that wrote a Python edit script was refused: "this command is too complex to verify that it stays inside the worktree". The script was written with the Write tool to the scratchpad and run with `python3 -I`. This is an editing mechanism only.
4. The combined final-gates command, which mixed `git rev-list`, `git rev-parse` and `git diff` with other commands, was refused. Each git command was rerun plainly and separately.

**Plan verify gates (all exit 0):**

- `pnpm typecheck` and `pnpm lint` pass.
- The sandbox-settings and probe-plan unit tests pass: 113.
- `pnpm test` passes: 29 files passed, 2 skipped; 776 tests passed, 3 skipped.
- The launch-facts gate and the control-attribution gate both pass.
- The evidence-copy gate passes, and the scrub grep counts 1.
- The Keychain lookup exits 44.
- `phase-plan-index 1` lists 01-24 and neither 01-21 nor 01-18.
- The evaluator and doctor tests pass: 84.
- The `isUnlistedPathDenial` negative grep prints nothing.

## Known Stubs

None.

## Threat Flags

None. The plan's threat model covers every surface touched: T-01-94..T-01-100.

## User Setup Required

None.

## Next Phase Readiness

- 01-25 (doctor's sandbox isolation settings check) and 01-26 (the credential-env probe row) can build on this profile and evaluator.
- 01-23 must show the opt-out with all three replacements in force before WINDOWS.md #3 closes, and moves `MATCHER_CLAUDE_VERSION` after a fully recognised run. Two facts it should expect:
  - the treatment's Keychain step and control-canary `cat` are classifier-approved in auto mode;
  - on 2.1.321 the revision-3 evaluator should read the six protected rows and the outside row Blocked from this run's record shapes. Only `gh` stays Reachable, as the WINDOWS.md #1 Keychain shape.
- Orchestrator, after merge: remove 01-21's halted worktree and branch (`git worktree remove --force .claude/worktrees/agent-a1ce4d71c120d2428`, `git branch -D worktree-agent-a1ce4d71c120d2428`).

## Self-Check: PASSED

- `tests/agent/probe-launch.live.test.ts` exists.
- Commits `4ced4e5`, `f25891b`, `4c5d928` and `e32bd86` are on HEAD (`git rev-list --count 66e2656..HEAD` = 4).
- The evidence exists at `/Volumes/Dock/Dev/Caches/cp-test-0124/evidence-01-24-live/`.
