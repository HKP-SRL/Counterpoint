---
phase: 01-trusted-shell-signed-runway
plan: 25
subsystem: security
tags: [sandbox, claude-code, doctor, settings-sources, managed-settings, plutil, scrub-opt-out, gap-closure]

# Dependency graph
requires:
  - phase: 01-24
    provides: "the scrub opt-out (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0) and the launch profile's explicit autoAllowBashIfSandboxed: false (replacement 1)"
provides:
  - "Replacement 2 of 3: the Sandbox isolation settings check (doctor fails when any settings source an agent session loads turns sandbox isolation off)"
  - "src/core/security/sandbox-isolation.ts: ISOLATION_RULES (7 rules, each with a doc citation), SettingsSourceRead, judgeSandboxIsolation"
  - "src/doctor/settings-sources.ts: SettingsSourceLocations, defaultSettingsSourceLocations, readSettingsSources (launch, user, server-managed cache, managed file, drop-ins, managed preferences via /usr/bin/plutil)"
  - "DoctorReport.sandboxIsolation (additive, optional, schema stays counterpoint/doctor/v1); reportVerdict and the Trust API fail a report without it or with it not pass"
  - "Probe side: while the check does not pass, runDoctor stores every measured Blocked row as Not checked"
  - "Source scan 'tests never read the real settings sources' (rules A to C) in pnpm test"
affects: [01-26, 01-22, 01-19, 01-20, 01-23, 01-16, phase-02-builders]

# Actuals (#2632): chars/4 over the realized diff (94.4 KB, git diff fb7ef22..3e1abaf)
actuals:
  tokens: 23600
  tasks: 2
  commits: 3
plan_head_before: fb7ef22acacf82a976725e0790155753eb188d09
plan_head_after: 3e1abafd34a8f0bf2e06aa45a92a9d07f704619f

tech-stack:
  added: []
  patterns:
    - "Settings-source reader follows links on purpose (sees what Claude Code sees), then requires a regular JSON-object file of at most 1 MiB; only ENOENT reads absent"
    - "A post-probe rewrite turns measured Blocked rows into Not checked while a configuration check fails (same pattern as the no-trusted-key rewrite)"
    - "A textual source scan over tests/ and ui/tests/ with a self-tested call extractor keeps every doctor call on scratch settings locations"

key-files:
  created:
    - src/core/security/sandbox-isolation.ts
    - src/doctor/settings-sources.ts
    - tests/core/security/sandbox-isolation.test.ts
    - tests/doctor/settings-sources.test.ts
  modified:
    - src/core/security/doctor-report.ts
    - src/doctor/run.ts
    - src/cli/doctor.ts
    - tests/doctor/doctor.test.ts
    - tests/core/security/sandbox-settings.test.ts
    - tests/server/phases.test.ts
    - tests/e2e/phases.e2e.test.ts
    - tests/e2e/needs-you.e2e.test.ts

key-decisions:
  - "Rule list grew at the docs re-check: sandbox.allowAppleEvents (any source) fails, because the sandboxing docs say it lets sandboxed commands launch other applications unsandboxed with no prompt; no planned rule or source was dropped"
  - "The stored sources list shows paths with the home directory as ~ and control characters replaced; labels and paths are sanitised but not capped, shown settings values are capped at 40 characters"
  - "An unsupported platform is a locations flag (unsupportedPlatform) that makes the reader add one unreadable managed-file source; a user name outside ^[A-Za-z0-9._-]+$ (or . / ..) adds one unreadable managed-preferences source"
  - "A launch profile that cannot be built is recorded as an unreadable launch source, so the check fails closed instead of throwing"

requirements-completed: [FOUND-03, FOUND-04]  # copied from the plan; shared IDs, requirements.ready-ids reports both blocked, so REQUIREMENTS.md is not marked here

coverage:
  - id: D1
    description: "Pure judge over the 7-rule table with per-source-kind semantics (any vs managed; launch must pin the four managed Booleans), fail-closed on unreadable sources and unknown values, sanitised output"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/core/security/sandbox-isolation.test.ts (judgeSandboxIsolation, rule matrix, several sources at once, what the check may show)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Read-only, fail-closed reader for the launch, user, server-managed cache, managed file, drop-ins and managed preferences (real /usr/bin/plutil on macOS)"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/doctor/settings-sources.test.ts#readSettingsSources"
        status: pass
      - kind: unit
        ref: "vitest run --project unit tests/doctor/settings-sources.test.ts -t plist (4 passed on macOS)"
        status: pass
    human_judgment: false
  - id: D3
    description: "counterpoint doctor fails with the Sandbox isolation settings line and a Fix line, stores every measured Blocked row as Not checked while the check fails, keeps Reachable rows, and passes with no settings file"
    requirement: FOUND-04
    verification:
      - kind: integration
        ref: "tests/doctor/doctor.test.ts#the Sandbox isolation settings check (01-25)"
        status: pass
    human_judgment: false
  - id: D4
    description: "reportVerdict, the CLI verdict and the Trust API fail a report without sandboxIsolation or with it not pass; schema id unchanged"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/core/security/sandbox-settings.test.ts#DoctorReport"
        status: pass
      - kind: integration
        ref: "tests/server/phases.test.ts#fails a stored report that lacks the sandbox isolation check (01-25)"
        status: pass
      - kind: e2e
        ref: "pnpm test:e2e (5 files, 44 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Source scan 'tests never read the real settings sources' fails pnpm test when a doctor call lacks scratch settingsLocations"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/doctor/settings-sources.test.ts#tests never read the real settings sources (fail-first run recorded below)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The check against the owner's real settings sources"
    verification: []
    human_judgment: true
    rationale: "Executors never read the owner's real settings; the first real check is the owner-run counterpoint doctor in 01-16"

# Metrics
duration: 17min
completed: 2026-11-10
status: complete
---

# Phase 1 Plan 25: Sandbox isolation settings check (scrub replacement 2) Summary

**`counterpoint doctor` now reads every settings source a Claude Code agent session loads: the launch `--settings`, `~/.claude/settings.json`, the server-managed cache, the managed file and its drop-ins, and the `com.anthropic.claudecode` managed preferences (converted with `/usr/bin/plutil`). It fails, with the source, the key and a fix, when any of them turns sandbox isolation off. While that check fails, no probe row is stored as Blocked. A report without the check never reads pass in the CLI, the verdict or the Trust API.**

## Performance

- **Duration:** about 17 min
- **Started:** 2026-11-10T12:22:01Z
- **Completed:** 2026-11-10T12:39:23Z
- **Tasks:** 2 of 2
- **Files modified:** 12 (4 created, 8 modified)

## Accomplishments

- **Rules (src/core/security/sandbox-isolation.ts).** There are seven rules, each citing its doc. Three fail in any source: `sandbox.filesystem.disabled` (anything but false), `sandbox.excludedCommands` (non-empty) and `sandbox.allowAppleEvents` (anything but false). Four fail only in a managed source: `sandbox.enabled` and `sandbox.failIfUnavailable` (not true), and `sandbox.allowUnsandboxedCommands` and `sandbox.autoAllowBashIfSandboxed` (not false). The launch settings must set those four explicitly. Quoted Booleans count as Booleans. Any other value, and a `sandbox` or `sandbox.filesystem` that is not an object, fails closed.
- **Reader (src/doctor/settings-sources.ts).** It is read-only and follows links. A source must then be a regular file of at most 1 MiB holding a JSON object. Only ENOENT, a dangling link included, reads as absent. Drop-ins are the visible `.json` files, read in alphabetical order. A `managed-settings.d` that is not a directory, or cannot be listed, fails closed. A plist is converted with `/usr/bin/plutil` using an argument array, no shell, stdin ignored, `PATH=/usr/bin:/bin` only and a 10 s timeout; it must convert to a JSON object.
- **Report and verdict.** `DoctorReport.sandboxIsolation` is an optional, additive field. The schema id stays `counterpoint/doctor/v1`. `reportVerdict` fails when the field is missing or not pass, and the Trust API follows because it calls `reportVerdict`.
- **Probe side ("doctor/probe fail").** After the probe, and after the existing no-trusted-key rewrite, every measured Blocked row becomes `not-checked` while the check fails. Its evidence is `Not counted as Blocked while the Sandbox isolation settings check does not pass. Measured: {evidence}`. Reachable rows stay as measured. `runSandboxProbe` is unchanged.
- **CLI.** The `Sandbox probe` group starts with the `Sandbox isolation settings` line, which reads PASS, or FAIL followed by an indented `Fix:` line. A report from before this plan shows `NOT CHECKED  Sandbox isolation settings: not recorded in this report`. `doctorVerdict` counts a missing or failed check.
- **Test isolation.** Every doctor call under `tests/` passes scratch `settingsLocations`. The source scan enforces this.

## Docs re-check (Task 1 step 0), 2026-11-10

Sources: the `.md` versions of the four pages were fetched with curl, and `claude --help` was run on `2.1.321 (Claude Code)`.

| Item | Citation (page, quoted phrase) | Compared with planning-time reading |
|------|-------------------------------|-------------------------------------|
| Launch source | settings: `--settings` "applies above your user, project, and local files and below managed settings"; `claude --help`: `--setting-sources <sources>` "Comma-separated list of setting sources to load (user, project, local)" | Same |
| User source | settings: `~/.claude/settings.json` "your personal settings for every project"; `CLAUDE_CONFIG_DIR` moves the home-directory files (agentEnv does not pass it) | Same |
| Server-managed cache | server-managed-settings: "A startup that runs on the cache at `~/.claude/remote-settings.json`" | Same |
| Managed file and drop-ins | managed-settings "Where each mechanism stores the policy": "`managed-settings.json`, an optional `managed-settings.d/` directory ... `/Library/Application Support/ClaudeCode/` on macOS, `/etc/claude-code/` on Linux and WSL"; "every `*.json` file in the directory in alphabetical order"; "ignores hidden files and files that don't end in `.json`"; symlinks: "Claude Code reads the file the link leads to" | Same |
| Managed preferences | managed-settings: "the `com.anthropic.claudecode` managed preferences domain"; "macOS's `plutil` reports the plist malformed" | Same. The docs name the domain, not an on-disk path. The reader uses macOS's standard `/Library/Managed Preferences/` (device-wide) and `/Library/Managed Preferences/{user}/` (per user), as planned |
| Windows HKLM/HKCU registry | managed-settings | Not a macOS or Linux source. Windows is covered by the "platform not supported" fail-closed source |
| `filesystem.disabled` | sandboxing "Which settings can disable it": "User settings, managed settings, and the `--settings` CLI flag can set it"; "defaults to `false`"; the scrub "ignores `filesystem.disabled` from every source, including managed settings" | Same. New detail: "When managed settings configure `sandbox.filesystem` at all ... only managed settings can set the key". This only narrows what a user value can do, so the rule stays "any source" (stricter) |
| `excludedCommands` | sandboxing: "run matching commands outside the sandbox, which means no filesystem restrictions and no network proxy"; "When you define the same filesystem array in multiple settings scopes, Claude Code merges them" | Same |
| `enabled`, `failIfUnavailable` | sandboxing: "When managed settings set a Boolean key such as `enabled` or `failIfUnavailable`, Claude Code uses the managed value and ignores anything a developer sets locally" | Same |
| `allowUnsandboxedCommands` | sandboxing: "With the retry disabled, Claude Code ignores the `dangerouslyDisableSandbox` parameter" | Same |
| `autoAllowBashIfSandboxed` | sandboxing: "still defaults to `true` ... Set it to `false` to prompt for sandboxed commands" | Same |
| Quoted Booleans | managed-settings: "the string `"true"` or `"false"` reads as that Boolean" | Same. Also new: "A `null` removes the key". The judge still treats `null` as an unrecognised value and fails closed (stricter) |
| **`allowAppleEvents` (added)** | sandboxing "Security limitations": the setting "removes code-execution isolation: sandboxed commands can launch other applications unsandboxed with no user prompt"; "It is only honored from user, managed, or CLI settings" | **Difference: not in the planning-time reading.** It runs code outside the sandbox, so it was added as rule 7, failing in any source, safe when absent or false |
| Considered, not added | `enableWeakerNestedSandbox` ("considerably weakens security", Linux containers), `allowNestedUserNamespaces` (Linux) | They weaken the sandbox but do not turn filesystem isolation off or run commands outside it, so they are recorded here only |

No planned rule or source was dropped. No doc no longer names a planned effect.

## Source scan: fail-first and green runs

- **Fail-first (not committed).** The `settingsLocations` block was removed from the no-host case's `doctorCommand` call. Then `vitest run --project unit tests/doctor/settings-sources.test.ts -t "tests never read the real settings sources"` exited 1:
  ```
  - []
  + [
  +   "tests/doctor/doctor.test.ts:720: A (doctorCommand call does not name settingsLocations)",
  + ]
  Tests  1 failed | 1 passed | 24 skipped (26)
  ```
- **Restored.** The file was put back with `git checkout -- tests/doctor/doctor.test.ts`. The same command then reported `Tests  2 passed | 24 skipped (26)`. The scan finds 2 doctor calls, the `runDoctorCommand` helper's and the no-host case's, and no rule A, B or C offender.

## Task Commits

1. **Task 1 (tracer): reader → judge → report → verdict → CLI through the user source** - `3698df9` (feat). Tracer gate: interactive, `end-of-phase`, automated-only verify. The verify was re-run end to end after the commit (4 files, 191 tests; typecheck; lint; `pnpm test` 853 passed). It passed, so the plan moved on to Task 2.
2. **Task 2 RED: reader and scan tests** - `cd51e4f` (test)
3. **Task 2 GREEN: every managed source and the cache; e2e fixtures** - `3e1abaf` (feat)

## TDD Gate Compliance (Task 2)

- **RED.** `cd51e4f`. Target test: `readSettingsSources > reads the launch settings and records every empty location as absent`.
  - The first run used vitest's `tap-flat` reporter. The classifier returned `INVALID_RED` / `invalid_record` ("Non-TAP data in report", "Malformed TAP"), because vitest prints the assertion diff unindented inside the YAML block.
  - The report was not edited. The same target was rerun through the project's runner with `--reporter=junit --outputFile=.tmp/red-junit-01-25.xml`, and the record carries the report path, the run start and the modification time.
  - `gsd-tools check tdd-red-evidence` then returned `RED_EVIDENCE_OK` / `target_test_failed` (format `junit`).
  - Semantic assessment: the target ran and failed on its own `toEqual` over the source list (AssertionError at settings-sources.test.ts:78). The Task 1 reader returned only the launch and user sources. This is not a load, syntax or fixture fault: the planned behavior was missing.
  - 17 of 26 tests failed. The 9 that passed cover behavior Task 1 already shipped: the user-file read shapes, link following, and the scan itself, which Task 1's `settingsLocations` already satisfied.
- **GREEN.** `3e1abaf`. All 26 tests in the file pass, including the 4 plist cases with the real `/usr/bin/plutil`.
- **REFACTOR.** None.

## Verification (plan-level)

- `pnpm exec vitest run --project unit tests/doctor/settings-sources.test.ts tests/core/security/sandbox-isolation.test.ts`: 2 files, 101 passed.
- `... -t "plist"`: 4 passed, 22 skipped (macOS).
- `... -t "tests never read the real settings sources"`: 2 passed.
- `pnpm typecheck`, `pnpm lint` (`biome ci .`, 130 files) and `pnpm build:ui`: exit 0.
- `pnpm test`: 31 files passed, 2 skipped; 885 tests passed, 3 skipped.
- `pnpm test:e2e`: 5 files, 44 passed.

All commands ran with `CP_TEST_SCRATCH=/Volumes/Dock/Dev/Caches/cp-test-0125` and the Dock pnpm env. e2e also used `PLAYWRIGHT_BROWSERS_PATH=/Volumes/Dock/Dev/Caches/ms-playwright`. No live probe ran. No test or command read the owner's real `~/.claude/settings.json` or the real managed locations.

## Files Created/Modified

- `src/core/security/sandbox-isolation.ts`: the rule table with citations, `SettingsSourceRead`, and `judgeSandboxIsolation` (pure, core).
- `src/doctor/settings-sources.ts`: the locations, the default locations per platform, and the reader.
- `src/core/security/doctor-report.ts`: `SandboxIsolationSource`, `SandboxIsolationCheck`, `DoctorReport.sandboxIsolation`, and the verdict rule.
- `src/doctor/run.ts`: the check in `runDoctor`, the probe-side rewrite, the CLI line, and the count in `doctorVerdict`.
- `src/cli/doctor.ts`: `DoctorCommandOptions.settingsLocations`, forwarded to `runDoctor`.
- Tests: `sandbox-isolation.test.ts` and `settings-sources.test.ts` are new. `doctor.test.ts` has scratch `settingsLocations` on both doctor calls and four isolation cases. `sandbox-settings.test.ts` and `phases.test.ts` have the verdict and route cases. The two e2e fixtures now carry a passing `sandboxIsolation`.

## Decisions Made

See `key-decisions` in the frontmatter. In short: `allowAppleEvents` was added at the docs re-check; `null` and other unrecognised values fail closed; a launch profile that cannot be built counts as an unreadable source; an unsupported platform or an unexpected user name each add one unreadable source.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Added rule 7, `sandbox.allowAppleEvents`**
- **Found during:** Task 1 step 0 (docs re-check)
- **Issue:** The sandboxing docs name a further key that runs code outside the sandbox. The plan says to add any such key.
- **Fix:** Rule 7: fails in any source, safe when absent or false. It is covered by the rule matrix tests.
- **Files modified:** src/core/security/sandbox-isolation.ts, tests/core/security/sandbox-isolation.test.ts
- **Committed in:** 3698df9

**2. [Rule 1 - Bug] Updated a Task 1 doctor expectation to the full source list**
- **Found during:** Task 2, full `pnpm test`
- **Issue:** The Task 1 case `passes with no settings file` listed only `[launch, read], [user, absent]`. Task 2's reader also records `[server-managed-cache, absent]`, which is correct by the plan's source order. The test's `settingsLocations` uses null managed locations, so no managed source appears.
- **Fix:** Added the cache entry to the expected list. Nothing was loosened: the expectation is now stricter and exact.
- **Files modified:** tests/doctor/doctor.test.ts
- **Committed in:** 3e1abaf

**3. [Rule 3 - Blocking] Typing in the scan's directory walk**
- **Found during:** Task 2, `pnpm typecheck`
- **Issue:** `ReturnType<typeof readdirSync>` resolved to the Buffer overload.
- **Fix:** Typed the entries as `Dirent[]`.
- **Committed in:** 3e1abaf

**4. [Process] The acceptance literal in run.ts**
- **Issue:** The CLI line `Sandbox isolation settings: not recorded in this report` was first built through `line()`, so the literal the acceptance grep looks for was not in the file.
- **Fix:** It is now one constant string with identical output.
- **Committed in:** 3698df9

**Total deviations:** 3 auto-fixed (1 missing critical, 1 bug, 1 blocking) plus 1 process adjustment. **Impact:** the rule list grew in the stricter direction, as the plan allows. No check, evaluator, profile or expectation was loosened.

## Command-guard refusals (surfaced verbatim)

The worktree guard refused four compound or heredoc commands with: "This agent is isolated in the worktree /Volumes/Dock/Projects/HKP/Counterpoint/.claude/worktrees/agent-a6bcce10a7a05540f, but this command is too complex (or: names git in a form too complex) to verify that it stays inside the worktree. Refusing to run it ... Split it into plain, separate commands and run them from /Volumes/Dock/Projects/HKP/Counterpoint/.claude/worktrees/agent-a6bcce10a7a05540f." Each time I did exactly what the guard asked. I split the work into plain separate commands: an edit script written to the session scratchpad and then run, the Edit tool, and the formatter and tests run separately. Nothing else was routed around.

## Issues Encountered

- Vitest's TAP reporter output is not valid TAP when an assertion diff spans several lines, so the RED classifier rejects it. JUnit XML from the same runner is accepted. Future TDD plans in this repo should record RED evidence with `--reporter=junit --outputFile=...`.

## Known Stubs

None.

## Threat Flags

None. The new surface (reading settings files, and the `/usr/bin/plutil` subprocess) is T-01-101 to T-01-104 in the plan's threat model, and each is mitigated as planned.

## User Setup Required

None.

## Next Phase Readiness

- 01-22 renders `sandboxIsolation` on the Trust page: the stored check has `id`, `label`, `result`, `detail`, `fix` and `sources`.
- 01-26, 01-22, 01-19 and 01-20 doctor calls must pass scratch `settingsLocations`. The source scan fails `pnpm test` otherwise.
- 01-16 (owner-run `counterpoint doctor cena`) is the first check against the real sources. At planning time, `~/.claude/settings.json` had no `sandbox` key and no managed source existed on the owner's machine.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-10*

## Self-Check: PASSED

- Files: the 4 created source and test files and this SUMMARY exist.
- Commits on this branch: 3698df9, cd51e4f, 3e1abaf (code) and 5955cf4 (this SUMMARY).
- The working tree was clean after the SUMMARY commit. STATE.md, ROADMAP.md and REQUIREMENTS.md were not touched: worktree mode, and FOUND-03 and FOUND-04 are still blocked in `requirements.ready-ids`.
