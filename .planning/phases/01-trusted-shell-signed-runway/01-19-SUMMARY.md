---
phase: 01-trusted-shell-signed-runway
plan: 19
subsystem: security
tags: [doctor, sandbox, probe, accepted-risk, keychain, gh, trust-api, cli, gap-closure, windows-ledger]

# Dependency graph
requires:
  - phase: 01-23
    provides: "the refrozen nine-row live pair (gh Keychain-only), livePlan() and legacyPlan()"
  - phase: 01-24
    provides: "the deterministic-only evaluator and the denied-block class"
  - phase: 01-25
    provides: "the Sandbox isolation settings check that reportVerdict requires"
  - phase: 01-26
    provides: "the credential-env row and its unexceptedFindings"
  - phase: 01-22
    provides: "the Agent permission mode check that reportVerdict requires"
  - phase: 01-10
    provides: "TrustCommandOptions, printable, terminalPrompt, exitWith, runDoctor/formatDoctorReport/doctorCommand"
  - phase: 01-11
    provides: "GET /api/hosts/:hostId/doctor"
provides:
  - "src/core/security/accepted-risks.ts: the per-machine record {home}/trust/accepted-risks.json (schema, O_NOFOLLOW read, 0600/0700 atomic write, revoke)"
  - "counterpoint accept-risk gh-keychain (terminal, typed reason, y) and counterpoint revoke-risk gh-keychain"
  - "Structured evidence on every probe row: steps, leaks, trusted"
  - "reachedOnlyByKeychain(row), appliedAcceptedRisks(report, recorded) and the three-way reportVerdict (pass / accepted-risk / fail)"
  - "Doctor output, the stored report (acceptedRisks) and the Trust API (verdict accepted-risk, acceptedRisks) show the applied risk"
affects: [01-20, 01-16, phase-02-builders]

# Actuals (#2632): chars/4 over the realized diff (93,773 chars, git diff 80d3f4d..9a3e90f)
actuals:
  tokens: 23443
  tasks: 2
  commits: 2
plan_head_before: 80d3f4dc66e6ffb72f8fdc4ce3db9b39bc0b2e2e
plan_head_after: 9a3e90f318834f3ad900b7e0d65717b8af0c14a5

tech-stack:
  added: []
  patterns:
    - "Exception eligibility is decided from structured evidence fields only, never from evidence prose; missing evidence never qualifies"
    - "An accepted risk applies only when the report recorded it at check time AND the same id and recordedAt exist now, so a revoke applies at once and a later record never turns an older check green"
    - "A source-scan test confines a sensitive writer to one module and keeps a module out of another's import specifiers"
    - "A compile-time `satisfies` map ties the evaluator's internal enums to the report schema's enums"

key-files:
  created:
    - src/core/security/accepted-risks.ts
    - src/cli/risk.ts
    - tests/cli/risk.test.ts
    - tests/core/security/accepted-risks.test.ts
  modified:
    - src/core/security/doctor-report.ts
    - src/agent/probe-evaluator.ts
    - src/doctor/run.ts
    - src/cli/doctor.ts
    - src/cli/main.ts
    - src/server/routes/trust.ts
    - tests/doctor/doctor.test.ts
    - tests/agent/probe-evaluator.test.ts
    - tests/server/phases.test.ts

key-decisions:
  - "The gh-keychain accepted risk lives per machine in {home}/trust/accepted-risks.json, written only by the terminal command accept-risk after a TTY check, a typed one-line reason and y"
  - "The accepted risk applies at the verdict layer only (appliedAcceptedRisks), and only to a gh row that reachedOnlyByKeychain reads from its structured evidence; the evaluator only reports evidence and the gh row stays REACHABLE"
  - "revoke-risk refuses (exit 1, nothing changed) when the record cannot be read, instead of deleting an unreadable file blindly"

requirements-completed: [FOUND-03, FOUND-04]  # copied from the plan; requirements.ready-ids reports both blocked by sibling plans (01-16, 01-20), so REQUIREMENTS.md is not marked here

coverage:
  - id: D1
    description: "counterpoint accept-risk gh-keychain records the risk only at a terminal with a reason and y (0600 file, 0700 dir); every refusal path writes nothing; revoke-risk withdraws it"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/cli/risk.test.ts#acceptRiskCommand / revokeRiskCommand"
        status: pass
    human_judgment: false
  - id: D2
    description: "Only src/cli/risk.ts names the writer and revoker; only the record module names the file; the probe evaluator imports nothing from the accepted-risk module"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/cli/risk.test.ts#the accepted-risk record source scan"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every probe row carries steps, leaks and trusted; on the refrozen 01-23 pair the gh row is Keychain-only (reachedOnlyByKeychain true), outside-workdir Write/Edit are denied-block, credential-env has one env-shape record; the legacy pair's gh row is Keychain-only; leak.jsonl's ssh row leaks file-canary"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/agent/probe-evaluator.test.ts#structured evidence on the real streams (01-19)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The verdict matrix: accepted-risk only with the record in the report and still present, Keychain-only gh evidence and every other check and row passing; each failure path fails, including the older report without steps and a fresh home"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/core/security/accepted-risks.test.ts#reportVerdict and appliedAcceptedRisks (01-19)"
        status: pass
    human_judgment: false
  - id: D5
    description: "counterpoint doctor prints the accepted-risk line under gh, the accepted-risk verdict and the withdraw line, exits 0, and stores acceptedRisks; fails without a record, with a file-canary leak, or a corrupt record (printing why); passes with gh Blocked saying the risk was not needed"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/doctor/doctor.test.ts#the accepted risk gh-keychain (01-19)"
        status: pass
    human_judgment: false
  - id: D6
    description: "GET /api/hosts/:id/doctor returns accepted-risk with the applied record, then fail with acceptedRisks [] after a revoke, for the same stored report; a POST is not served and writes no record"
    requirement: FOUND-03
    verification:
      - kind: integration
        ref: "tests/server/phases.test.ts#the accepted risk gh-keychain (01-19)"
        status: pass
      - kind: e2e
        ref: "pnpm build:ui && pnpm test:e2e (5 files, 51 tests)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The console shows the accepted risk and the UI contract for it"
    verification: []
    human_judgment: true
    rationale: "Slice 2 (01-20) owns the console, the UI contract and the live proof; until then the console reads any non-pass verdict as failing"

# Metrics
duration: 16min
completed: 2026-11-10
status: complete
---

# Phase 1 Plan 19: The owner-recorded gh-keychain accepted risk (terminal and API side) Summary

**The owner can now record one accepted risk at a terminal: `counterpoint accept-risk gh-keychain`, with a reason. Doctor applies it only when the gh row's structured probe evidence shows that the Keychain lookup was the only step that reached, with every gh file step refused by a deny rule or the OS sandbox. In that case `counterpoint doctor` exits 0 and names the risk. The gh row still reads `REACHABLE`, and revoking the record makes doctor and the Trust API fail again at once, without a rerun.**

This is slice 1 of 2 for WINDOWS.md #1. Slice 2 (01-20) does the console, the UI contract, the live proof and the window waiver. WINDOWS.md #1 stays `open`: this plan does not waive it.

## Performance

- **Duration:** about 16 min.
- **Started:** 2026-11-10T15:12:06Z
- **Completed:** 2026-11-10T15:27:41Z
- **Tasks:** 2 of 2.
- **Files:** 13 (4 created, 9 modified).

## Accomplishments

- **The record** (`src/core/security/accepted-risks.ts`). Schema `counterpoint/accepted-risks/v1`, with one acceptable id, `gh-keychain` (target `gh`, sub-step `keychain`).
  - The reason is 1-300 characters after trimming, with no control characters.
  - Reads use O_NOFOLLOW and accept only a regular file, at most 16 KiB, not writable by group or others, in a trust folder that is also not writable by group or others. The JSON must pass a strict zod schema with at most one entry.
  - Writes go to a 0600 temporary file (created `wx`) that is renamed into place, in a 0700 folder.
  - A missing file means no risk. Any other problem is `ok: false` with a one-line reason, and callers then treat the home as having no risk.
- **The terminal commands** (`src/cli/risk.ts`, registered in `src/cli/main.ts`):
  - `accept-risk` prints what is being accepted and asks for a reason, then for `y`, using the plan's exact wording.
  - Any other id exits 2. No terminal, a bad reason or no `y` exits 1. None of these writes anything.
  - `revoke-risk` is idempotent and needs no terminal.
- **Structured evidence.** Every probe row now carries:
  - `steps`: index, tool, operation, and the treatment and control class, exactly as classified;
  - `leaks`: `file-canary`, `keychain-canary`, `leftover` or `credential-variable`;
  - `trusted`: the plans matched, the baseline held and no version distrust applied.

  The evaluator only reports these fields; its verdict code is unchanged. Compile-time `satisfies` maps tie its operation, class and tool values to the report's enums.
- **The verdict** (`doctor-report.ts`):
  - `reachedOnlyByKeychain(row)` decides from the structured fields alone.
  - `appliedAcceptedRisks(report, recorded)` applies the risk only when the report recorded the entry, the same id and `recordedAt` still exist now, and the one gh row qualifies.
  - `reportVerdict(report, recorded = [])` returns `pass`, `accepted-risk` or `fail`. A failing Sandbox isolation settings or Agent permission mode check still fails, and so does any other row that is not Blocked.
- **Doctor** reads the record once, stores it in `report.acceptedRisks`, and prints:
  - `Accepted risk gh-keychain, recorded {date}: {reason}` under the gh row;
  - the verdict `Agents are boxed in, with one accepted risk: gh credentials in your Keychain are reachable.`;
  - `Withdraw it with: counterpoint revoke-risk gh-keychain`.

  When a record is in force but does not apply, doctor prints the `covers only the Keychain lookup` or the `was not needed` line. It prints the problem line for a corrupt record. The `Approvals still work` line now appears only on a `fail` verdict.
- **Trust API.** The route reads the record on every request. It returns `verdict` (`accepted-risk`, `pass` or `fail`) and the applied `acceptedRisks` as `{ id, target, subStep, reason, recordedAt }`. It still serves GET only, and the test shows a POST is not served and writes no record.

## Task Commits

1. **Task 1 (tracer: record, terminal commands, evidence, verdict, doctor):** `72347bf` (feat).
2. **Task 2 (matrix, live-pair evidence, Trust API):** `9a3e90f` (feat).

**The tracer gate.** The run was interactive (`auto_advance` false) with `human_verify_mode` set to `end-of-phase`, and the tracer's `<verify>` holds only automated commands. So the gate re-ran all three commands: `pnpm typecheck && pnpm lint`, the two Task 1 test files (76 passed) and `pnpm test` (1031 passed, 4 skipped). All were green, so Task 2 went ahead.

## Verification

| Command | Result |
|---------|--------|
| `pnpm typecheck && pnpm lint` | exit 0 (biome: 136 files, no fixes) |
| `vitest run --project unit tests/cli/risk.test.ts tests/doctor/doctor.test.ts` | 2 files, 76 tests passed |
| `vitest run --project unit tests/core/security/accepted-risks.test.ts tests/agent/probe-evaluator.test.ts tests/server/phases.test.ts` | 3 files, 213 tests passed |
| `pnpm test` | 33 files passed, 3 skipped (the live tests); 1093 passed, 4 skipped |
| `pnpm build:ui && pnpm test:e2e` | built; 5 files, 51 tests passed |

Every test command ran with `CP_TEST_SCRATCH=/Volumes/Dock/Dev/Caches/cp-test-0119` and the Dock pnpm environment. The e2e run also had `PLAYWRIGHT_BROWSERS_PATH=/Volumes/Dock/Dev/Caches/ms-playwright`. No live probe ran. `accept-risk` was never run against the owner's real home: every record in the tests was written to a scratch home.

## Files Created/Modified

- `src/core/security/accepted-risks.ts` (new): the record's schema, safe read, atomic write and revoke.
- `src/cli/risk.ts` (new): `acceptRiskCommand` and `revokeRiskCommand`.
- `src/core/security/doctor-report.ts`:
  - the step tool, operation, class and leak enums, `ProbeStepRecord`, and `ProbeTarget.steps`, `leaks` and `trusted`;
  - `reachedOnlyByKeychain`, `DoctorReport.acceptedRisks`, `Verdict`, `appliedAcceptedRisks` and `reportVerdict(report, recorded?)`.
- `src/agent/probe-evaluator.ts`: fills the evidence on every row. The credential-env listings are computed once and shared by the leak check and the row. The verdict logic is unchanged.
- `src/doctor/run.ts`: reads the record, adds `acceptedRisks` to the report, and adds `DoctorRun.recordedRisks` and `acceptedRisksProblem`. Synthesized rows carry empty evidence. `formatDoctorReport` and `doctorVerdict` gain the `recorded` parameter.
- `src/cli/doctor.ts`: prints the problem line, passes the record to the formatter, and exits 0 unless the verdict is `fail`.
- `src/cli/main.ts`: the `accept-risk <risk>` and `revoke-risk <risk>` commands, and the header comment.
- `src/server/routes/trust.ts`: the three-way verdict and `acceptedRisks`, with the record read on every request.
- Tests:
  - `tests/cli/risk.test.ts` (new): the commands and the source scan;
  - `tests/core/security/accepted-risks.test.ts` (new): the record and the verdict matrix;
  - `tests/doctor/doctor.test.ts`: `fakeProbe` gh evidence and the doctor cases;
  - `tests/agent/probe-evaluator.test.ts`: the evidence on the real streams;
  - `tests/server/phases.test.ts`: the route cases.

## Decisions Made

- **Where the "not applied" lines print.** They follow the verdict line. They appear only when the record was in force for the report (same id and `recordedAt` in both). So a stored report formatted after a later recording never claims that the Keychain-only scope was the reason. Under `counterpoint doctor` the two are always the same, because doctor reads the record once.
- **`appliedAcceptedRisks` returns the report's entry** (what doctor saw at check time). The Trust API and the doctor line print that entry.
- **`fakeProbe` evidence.** It gives gh Keychain-only evidence when gh is reachable. When gh is Blocked, it gives no leak and a rule-refused lookup. The other rows get empty steps with `trusted: true`. Existing doctor tests that make gh reachable have no record in their home, so they still fail exactly as before.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] `revoke-risk` refuses on an unreadable record instead of reporting "none recorded"**
- **Found during:** Task 1.
- **Issue:** The plan does not say what revoke does when the record exists but cannot be read (a symlink, a bad mode or a bad schema). Deleting it blindly could remove a planted symlink's name without the owner seeing why. Reporting "No accepted risk gh-keychain is recorded." would hide a file that is still there.
- **Fix:** `revokeAcceptedRisk` throws the read problem. `revokeRiskCommand` prints `Couldn't read your accepted-risk record ({problem}). Nothing changed.` and exits 1. The verdict is unaffected, because an unreadable record already counts as no risk.
- **Files:** `src/core/security/accepted-risks.ts`, `src/cli/risk.ts`. The symlink case is covered in `tests/core/security/accepted-risks.test.ts`.
- **Committed in:** `72347bf` (code), `9a3e90f` (test).

**2. [Rule 2 - Missing critical] The record read also checks the trust folder**
- **Found during:** Task 1.
- **Issue:** The plan lists file checks only. A trust folder writable by group or others lets another user swap the file, as `readTrust` already guards against.
- **Fix:** `readAcceptedRisks` refuses a trust folder that is not a directory or is writable by group or others, with a one-line problem. A missing folder still means no risk.
- **Files:** `src/core/security/accepted-risks.ts`. Covered in `tests/core/security/accepted-risks.test.ts`.
- **Committed in:** `72347bf`, `9a3e90f`.

---

**Total deviations:** 2 auto-fixed (both Rule 2). Both make the record stricter. Neither loosens the evaluator, doctor, the launch profile or any test expectation.

## Issues Encountered

- **Two command-guard refusals, both handled by splitting into plain steps (no workaround to a different end):**
  - A Python heredoc that would have applied the `doctor-report.ts` edits, and a `cat >>` heredoc that would have appended the evidence tests, were refused as too complex to verify. I made the same edits with the Edit tool.
  - A compound command that would have written the plan-commit ledger and the cwd sentinel into the worktree's git dir was refused. I did not retry it. The plan base was already verified at spawn (`80d3f4d`), so I recorded it in the session scratchpad. `commits: 2` is measured with `git rev-list --count 80d3f4d..HEAD`.
- **A conditional comparison that never ran here.** The existing `evaluates to exactly the matrix the live run printed` test compares the evaluator's rows field by field with `.tmp/live-probe/targets.json`, but only when that file exists. It does not exist in this worktree, so the comparison was skipped. A checkout that still holds 01-23's own output would now differ, because the new `steps`, `leaks` and `trusted` fields are additive. This is a recorded fact; the test was not changed.

## Findings for the owner

- **The real stream evidence matches the scope.** The refrozen 01-23 pair evaluates gh to `leaks: ['keychain-canary']`, `trusted: true`, with cat, read and grep `denied-rule` (control reached) and the Keychain lookup reached in both sessions, so `reachedOnlyByKeychain` is true. The 01-04 legacy pair gives the same. So on the owner's machine, once the record exists, doctor can read `accepted-risk` without changing what the probe measured.
- **No default ships.** A fresh home reads `ok: []`, and a Keychain-only gh reach then fails, in the CLI, in the matrix and in the API.
- **The console** still maps any non-`pass` verdict to failing (`ui/src/pages/TrustPage.tsx`: `raw.verdict === 'pass' ? 'pass' : 'fail'`). So until 01-20 it shows an `accepted-risk` report as failing, never better than its data.

## User Setup Required

None in this plan. Recording the risk on the owner's machine (`counterpoint accept-risk gh-keychain` against the real home) is the owner's 01-16 step.

## Next Phase Readiness

- 01-20 can build the console view and the UI contract on `verdict: 'accepted-risk'` and `acceptedRisks` from the Trust API, then prove the risk live and waive WINDOWS.md #1.
- FOUND-03 and FOUND-04 stay unmarked: `requirements.ready-ids` reports both blocked by sibling plans (01-16, 01-20).

## Self-Check: PASSED

- All four created files exist: `src/core/security/accepted-risks.ts`, `src/cli/risk.ts`, `tests/cli/risk.test.ts` and `tests/core/security/accepted-risks.test.ts`.
- Both commits `72347bf` and `9a3e90f` are ancestors of HEAD.
- Neither commit deletes a file.
- Every acceptance criterion of both tasks was re-checked by grep and passed, and all the automated commands exited 0.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-10*
