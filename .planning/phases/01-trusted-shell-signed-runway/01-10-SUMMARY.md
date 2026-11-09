---
phase: 01-trusted-shell-signed-runway
plan: 10
subsystem: security
tags: [doctor, ssh-keygen, ssh-agent, keychain, sandbox-probe, integrity, commander, tdd]

# Dependency graph
requires:
  - phase: 01-03
    provides: "CLI lifecycle (CliExit, homeOrExit), controlRequest/isDaemonRunning, POST /control/notify, 'doctor' event family"
  - phase: 01-04
    provides: "buildAgentSandboxSettings(ProtectedPaths), runSandboxProbe, ClaudeCliRunner, DoctorReport schema, reportVerdict, probeTargetLabel"
  - phase: 01-05
    provides: "evaluateProbe verdicts inside runSandboxProbe, MATCHER_CLAUDE_VERSION, staleLeftovers"
  - phase: 01-08
    provides: "readTrust/writeTrust, fingerprintOf, SSH_KEYGEN/sshKeygenEnv, snapshotIntegrity/compareIntegrity/readBaseline/writeBaseline/checkIntegrity, INTEGRITY_REFUSAL"
provides:
  - "src/doctor/tools.ts: CommandRunner/runCommand, checkTools, parseGitVersion, parseOpenSshVersion, versionAtLeast, MIN_GIT_VERSION, MIN_OPENSSH_VERSION"
  - "src/doctor/signing-key.ts: readOpenSshKeyHeader, keyLoadableViaSshConfig, checkSigningKey, NO_TRUSTED_KEY_FIX"
  - "src/doctor/run.ts: runDoctor, liveSandboxProbe, formatDoctorReport, doctorVerdict, writeDoctorReport, ghConfigDir"
  - "src/cli/trust.ts: initKeyCommand, trustKeyCommand, trustHostCommand, lookupHost, printable, formatIntegritySnapshot"
  - "src/cli/doctor.ts: doctorCommand, resolveHostForCommand, notifyDaemon"
  - "CLI: counterpoint doctor [host], init-key, trust-key <pub>, trust <host>"
  - "Home files: hosts/{id}/doctor.json (0600), logs/doctor/{timestamp}/ raw probe streams"
affects: [01-11, 01-12, 01-13, 01-16, phase-02-runner]

actuals:
  tokens: 25650   # chars/4 over the 9 new files (100,269 chars) plus the added main.ts lines (2,316 chars)
  tasks: 3
  commits: 5      # MEASURED: git rev-list --count 2d217cf..HEAD before the SUMMARY commit
plan_head_before: 2d217cfd6328e9084a7d06102fab5fe489528230
plan_head_after: 133265d354930e6fb804c5aab868c76b32b925e6

tech-stack:
  added: []
  patterns:
    - "Doctor runs every external program through one injectable CommandRunner (argument array, stdin ignored, 10 s timeout, no reject), so tests answer ssh-add/security/launchctl/ssh with fakes"
    - "Owner-only actions (pin a key, accept a baseline) need a TTY on both stdin and stdout plus an explicit y; anything else writes nothing"
    - "Untrusted text shown for owner review (repo config values, hook names, paths) goes through printable(), which escapes control characters"
    - "Commands return exit codes; main.ts turns non-zero codes into CliExit"

key-files:
  created:
    - src/doctor/tools.ts
    - src/doctor/signing-key.ts
    - src/doctor/run.ts
    - src/cli/trust.ts
    - src/cli/doctor.ts
    - tests/doctor/tools.test.ts
    - tests/doctor/signing-key.test.ts
    - tests/doctor/doctor.test.ts
    - tests/cli/trust.test.ts
  modified:
    - src/cli/main.ts

key-decisions:
  - "keyLoadableViaSshConfig ignores Host/Match scoping: an IdentityFile for the approval key anywhere plus AddKeysToAgent (not no) or UseKeychain yes anywhere counts as loadable. This fails closed; the dedicated approval key should never appear in ssh config at all"
  - "Without a trusted key, the passphrase, agent, Keychain and trusted-key rows fail with the init-key fix, but the OpenSSH row is still checked truthfully (a version failure must not be hidden behind a setup hint)"
  - "When ssh-add or security answers with an unexpected exit code, the row is Not checked (never Pass), so doctor fails closed"
  - "Without a trusted key, the probe gets a non-existent signing-key folder under the home's trust dir, so that target is skipped and reads Not checked; the other six targets are still probed"
  - "The integrity row is stored in report.integrity (the 01-04 schema field) and printed as the last row of the Signing key group"
  - "Verdict wording follows the UI-SPEC zero-one-many rule: '1 target was reachable' / '{n} targets were reachable', '1 check did not pass' / '{n} checks did not pass'"
  - "trust-key and trust return exit 1 when the owner declines (Nothing saved.), 2 for an unknown or malformed host id"
  - "FOUND-03/FOUND-04/APPR-04 are not marked complete: requirements.ready-ids blocks FOUND-03 and APPR-04 on sibling plans, and FOUND-04's guarantee is unmet on this machine (WINDOWS.md #1 and #2)"

patterns-established:
  - "A doctor check row never reads Pass on an error path: unknown tool output, failed lookups and unparseable versions are Fail or Not checked"

requirements-completed: []  # FOUND-03, FOUND-04, APPR-04 declared; none marked (see key-decisions)

coverage:
  - id: D1
    description: "Tool checks: claude, git (>= 2.34) and gh with version strings; missing, failing and too-old tools fail with install/update fixes"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/doctor/tools.test.ts (14 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Signing-key checks on throwaway keys: header parse (O_NOFOLLOW, size cap, magic, only cipher/kdf/rounds), passphrase cross-check with ssh-keygen -y -P '', ssh-add fingerprints over shell and launchd sockets, ssh config Include-aware loadability, Keychain existence lookup without the password flag (A4 noted), OpenSSH >= 8.1, trusted key, no-trust fix; no key material in any output"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/doctor/signing-key.test.ts (31 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "init-key prints the dedicated-key command; trust-key pins only a single protected ed25519 key after y at a TTY; trust {host} shows changes and the full grouped surface and saves the baseline only after y at a TTY; control characters escaped; bad ids refused before any path use"
    requirement: APPR-04
    verification:
      - kind: unit
        ref: "tests/cli/trust.test.ts (14 tests)"
        status: pass
      - kind: other
        ref: "node src/cli/main.ts init-key; node src/cli/main.ts trust-key <throwaway.pub> without a TTY -> exit 1, nothing written"
        status: pass
    human_judgment: false
  - id: D4
    description: "counterpoint doctor: grouped output and row words, Fix lines, verdict wording, exit 0 only for all-pass, schema-valid 0600 doctor.json, protected paths passed to the probe, unrunnable probe and untrusted key read Not checked, stale leftovers named, notify carries family doctor, host resolution"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/doctor/doctor.test.ts (25 tests, injected probe)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live doctor on the owner's machine with the owner's real dedicated key, real ~/.ssh, gh config and Cena, showing every row and the probe verdict"
    requirement: FOUND-04
    verification: []
    human_judgment: true
    rationale: "Needs the owner's real key and a live probe against real protected directories (01-16 owner demo). On this machine the probe is expected to report gh credentials Reachable (WINDOWS.md #1), so doctor will exit non-zero until the owner picks a remediation; the A4 Keychain item shape also needs confirming by the owner."

duration: 16min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 10: counterpoint doctor and owner key/baseline setup Summary

**`counterpoint doctor [host]` now checks tools, the approval key's hygiene (passphrase, ssh-agent, Keychain, OpenSSH version), the host's integrity baseline and the live sandbox probe. It prints the UI-SPEC grouped report, writes `hosts/{id}/doctor.json`, nudges the console, and exits 0 only when everything passes. `init-key`, `trust-key` and `trust {host}` let the owner set up the dedicated approval key and the integrity baseline, and they only write after a `y` typed at a terminal.**

## Performance

- **Duration:** about 16 min
- **Started:** 2026-11-09T17:12:00Z
- **Completed:** 2026-11-09T17:28:00Z
- **Tasks:** 3 (Tasks 1 and 2 TDD)
- **Files:** 9 created, 1 modified

## Accomplishments

- **Tool checks.** `checkTools` runs `claude`, `git` and `gh` with `--version` through one injectable runner. git must be 2.34 or newer (A8). Each failure carries the plan's fix text.
- **Signing-key checks (RESEARCH Item 3).**
  - `readOpenSshKeyHeader` opens the key with `O_NOFOLLOW`, requires a regular file under 16 KiB, checks the `openssh-key-v1` magic, and returns only `{ cipher, kdf, rounds }`. The decoded buffer is zeroed afterwards, and errors never quote content.
  - The passphrase row requires the header and `/usr/bin/ssh-keygen -y -P '' -f key` to agree. If they disagree, the row fails. Fewer than 16 rounds is noted in the detail.
  - The agent row asks `ssh-add -E sha256 -l` on the shell's `SSH_AUTH_SOCK` and on launchd's socket (`launchctl getenv SSH_AUTH_SOCK`). It compares fingerprints only.
  - The Keychain row parses `~/.ssh/config` and its `Include`s, then runs `security find-generic-password -s OpenSSH -a {key}` without the password flag. The detail states the A4 assumption.
  - With no trusted key, each key row fails with `Run "counterpoint init-key", then "counterpoint trust-key ~/.ssh/counterpoint_approval.pub".`
- **Owner setup commands.**
  - `init-key` prints the exact `ssh-keygen -t ed25519 -a 100 …` command and runs nothing.
  - `trust-key` refuses unless the file holds exactly one ssh-ed25519 key and the private key next to it has a passphrase. It needs a terminal, prints the path and fingerprint, and calls `writeTrust` only on `y`.
  - `trust {host}` validates the id before any path use and looks the host up read-only. It prints the changes since the old baseline first, then the full grouped list (`config`, `hooks`, `info`, `config.worktree`, with 12-hex hashes). It saves the baseline only on `y` at a terminal.
- **Doctor.**
  - `runDoctor` builds the probe's `ProtectedPaths` from the real user home, the trusted key's folder, gh's config dir (honouring `GH_CONFIG_DIR` and `XDG_CONFIG_HOME`), the Counterpoint home and the host's git common dir. Raw streams go to `logs/doctor/{timestamp}/`.
  - A probe that cannot run, for example because `claude` is missing, makes all seven rows read `Not checked` with the reason. Leftovers swept from a killed earlier probe are named in their row.
  - The report is validated against `counterpoint/doctor/v1` and written 0600 by atomic rename.
  - `formatDoctorReport` prints `Tools`, `Signing key` and `Sandbox probe`. Check rows read `PASS`/`FAIL`/`NOT CHECKED`, probe rows read `BLOCKED`/`REACHABLE`/`NOT CHECKED`, and each failure gets an indented `Fix:` line. The verdict uses the UI-SPEC words.
  - `doctorCommand` resolves the host in this order: the explicit id, then the host whose root contains the cwd, then the only registered host. It POSTs `/control/notify { hostId, family: 'doctor' }` when the daemon is running.

## Task Commits

1. **Task 1: Tool and signing-key checks (TDD)**
   - `5f24ee5` test(01-10): add failing tests for doctor tool and signing-key checks (RED)
   - `0fe885c` feat(01-10): doctor tool and signing-key checks (GREEN)
2. **Task 2: Owner setup commands (TDD)**
   - `4945830` test(01-10): add failing tests for init-key, trust-key and trust {host} (RED)
   - `c5a5ec3` feat(01-10): owner setup commands init-key, trust-key and trust {host} (GREEN)
3. **Task 3: counterpoint doctor**
   - `133265d` feat(01-10): counterpoint doctor with grouped report, doctor.json and daemon nudge

**Plan metadata:** the docs commit that adds this SUMMARY.

## TDD Gate Compliance

- **Task 1 RED** (`5f24ee5`): 38 of 45 tests failed against API stubs, all on assertions. The classifier returned **RED_EVIDENCE_OK** (`target_test_failed`) for the target `tests/doctor/tools.test.ts > versionAtLeast > rejects git 2.33 against the 2.34 minimum`, run alone with `-t` and the `tap-flat` reporter. A full-file TAP run would include multi-line array diffs, the same problem 01-04 and 01-08 hit. Semantic check: the target ran and failed on its planned assertion (`expected true to be false`) because the stub always returned true. There was no load or fixture fault. Record: `.tmp/red/0110-t1.json`.
- **Task 2 RED** (`4945830`): all 14 tests failed on assertions against stubs. Target: `tests/cli/trust.test.ts > trustKeyCommand > refuses without a terminal and writes nothing`. Result: **RED_EVIDENCE_OK**. Semantic check: the target failed on `expected 0 to be 1` because the stub returned exit 0 without refusing. Record: `.tmp/red/0110-t2.json`.
- **GREEN:** 45/45 (Task 1) and 14/14 (Task 2) pass. The full suite has 588 passed and 1 skipped (the gated live probe).
- **REFACTOR:** none.

## Files Created/Modified

- `src/doctor/tools.ts`: command runner, version parsers, tool checks.
- `src/doctor/signing-key.ts`: key header parser, ssh config loadability, signing-key rows.
- `src/doctor/run.ts`: doctor orchestration, live probe adapter, report writer, formatter and verdict.
- `src/cli/trust.ts`: `init-key`, `trust-key`, `trust {host}`, host lookup, safe printing.
- `src/cli/doctor.ts`: `doctor [host]`, host resolution, daemon nudge.
- `src/cli/main.ts`: registers `doctor [host]`, `init-key`, `trust-key <pub>` and `trust <host>`, with a readline prompt that needs a TTY.
- `tests/doctor/tools.test.ts`, `tests/doctor/signing-key.test.ts`, `tests/doctor/doctor.test.ts`, `tests/cli/trust.test.ts`: 84 tests. They use throwaway keys, scratch homes, repos and ssh configs, and fake ssh-add, security, launchctl and ssh.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Control characters escaped in everything the owner reviews**
- **Found during:** Task 2.
- **Issue:** `trust {host}` prints repository config values and hook names, and an agent can write those. A value carrying terminal escape sequences, such as `core.pager = less\e[2K…`, could erase or rewrite lines of the list the owner is asked to accept. That defeats T-01-36.
- **Fix:** `printable()` escapes C0 and C1 controls, DEL, U+2028 and U+2029 in every untrusted string `trust` and `trust-key` print.
- **Files modified:** src/cli/trust.ts, tests/cli/trust.test.ts.
- **Verification:** the test `never prints terminal control characters from repository config` passes.
- **Committed in:** c5a5ec3

**2. [Rule 2 - Missing critical] Fail-closed rows for unexpected lookup results**
- **Found during:** Task 1.
- **Issue:** The plan defines Pass and Fail for `ssh-add` (exit 0, 1 or 2) and `security` (found or not). Any other exit code, such as a locked Keychain or a crashed agent, would otherwise have fallen through to Pass.
- **Fix:** Those cases now read `Not checked` with a fix. `reportVerdict` treats `Not checked` as a fail.
- **Committed in:** 0fe885c

**3. [Interpretation] The OpenSSH row is still checked without a trusted key**
- The plan says that "with no trusted key every row is Fail" with the init-key fix. The four key-dependent rows do that. The OpenSSH version row does not depend on the key, so it reports the real version. This way an old OpenSSH is not hidden behind a setup hint. The plan's test only asserts the key rows.

**4. [Interpretation] Verdict pluralisation**
- The plan's literal wording is `{n} target(s) were reachable.` / `{n} check(s) did not pass.`. The UI-SPEC zero-one-many row requires `1 target was reachable` / `{n} targets were reachable`. The UI-SPEC wording is used, with the same rule for checks.

---

**Total deviations:** 2 auto-fixed (both missing-critical, security) and 2 interpretations.
**Impact on plan:** all four make doctor and trust stricter or more truthful. None weakens a check or adds an exception.

## Issues Encountered

- **The live doctor will fail on this machine, by design.** No live doctor run was made here. The plan does not require one: its tests use an injected probe, and the live path was proven in 01-04/01-05. A live run would also plant canaries in the owner's real `~/.ssh` and gh config. When the owner runs it (01-16), the probe is expected to report `gh credentials: REACHABLE` (WINDOWS.md #1, sandboxed Bash can read the login Keychain). Doctor then prints `Agent sandbox is not confining sessions: 1 target was reachable.` and exits 1. This is the intended fail-closed behaviour. No check was weakened. WINDOWS.md #2 (Write/Edit outside the sandbox write scope) is not covered by the probe's seven targets. It stays an open owner decision.
- **Edit tool and U+2028.** The first `printable()` regex was written with `U+2028`/`U+2029` escapes, and the file write turned them into literal line separators, which broke parsing. The function now checks code points numerically, and the file has no literal separator characters.
- **Vitest 5 `-t` filter.** Vitest 5 matches `-t` against the full name joined with ` > ` (for example `trustKeyCommand > refuses without a terminal`), not with spaces. This matters when isolating a RED target.

## Known Stubs

None. The RED stubs were replaced in the GREEN commits.

## Threat Flags

None beyond the plan's threat model. The new CLI commands read only owner-supplied paths, the host's git dir and `~/.ssh/config`. The only new writes are `trust/*`, `hosts/{id}/integrity.json`, `hosts/{id}/doctor.json` and `logs/doctor/`, all inside the 0700 home.

## User Setup Required

These are manual owner steps for 01-16. They were not run here, because they need the owner's real key and machine:
1. `counterpoint init-key`, then run the printed `ssh-keygen` command and type a passphrase.
2. `counterpoint trust-key ~/.ssh/counterpoint_approval.pub` at a terminal, and answer `y`.
3. `counterpoint trust cena` at a terminal: review the list, then answer `y`.
4. `counterpoint doctor cena`. Expect `REACHABLE` on gh credentials until WINDOWS.md #1 is resolved. Also confirm the A4 Keychain item shape.

## Next Phase Readiness

- 01-12 (approvals) can use `readTrust` plus the baseline written by `trust {host}`, and can reuse `lookupHost`/`resolveHostForCommand` for host selection.
- 01-11/01-13 (console Trust page) can read `hosts/{id}/doctor.json` and refresh on the `doctor` SSE family.
- **Blocker for the phase goal (unchanged):** WINDOWS.md #1 and #2 need owner decisions. Until then, doctor truthfully fails on this machine.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

## Self-Check: PASSED

- All 9 created files and `src/cli/main.ts` exist on disk.
- Commits 5f24ee5, 0fe885c, 4945830, c5a5ec3 and 133265d are on this branch (`git log 2d217cf..HEAD`).
- Acceptance criteria re-run: every grep passes for Tasks 1–3, and the `find-generic-password` line has no ` -w`.
- Plan verification: `pnpm test` exits 0 (588 passed, 1 skipped); `pnpm typecheck` and `pnpm lint` exit 0; `node src/cli/main.ts init-key` prints the command and creates nothing.
