---
phase: 01-trusted-shell-signed-runway
plan: 26
subsystem: security
tags: [sandbox, claude-code, probe, live-probe, env-listing, credentials, scrub-opt-out, gap-closure, sandbox-credentials, doctor]

# Dependency graph
requires:
  - phase: 01-24
    provides: "the scrub opt-out (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0), auto mode in every probe session, MATCHER_REVISION 3"
  - phase: 01-25
    provides: "the Sandbox isolation settings check and the source scan for scratch settingsLocations"
provides:
  - "The ninth probe row credential-env (Credentials in the shell environment, read): Reachable on any credential-shaped variable outside the owner's exception in either session's sandboxed Bash environment, Blocked only on two recognised listings from an intact script, Not checked otherwise"
  - "ENV_SHAPE_AWK: names, lengths, shape words and host classes only (url-userinfo URLs and the bare CLOUDSDK_PROXY_ADDRESS), one print statement, never a value"
  - "CREDENTIAL_ENV_DENY = [CLAUDE_CODE_MESSAGING_TOKEN] in the one launch profile (sandbox.credentials.envVars, mode deny), copied fresh into the probe's control"
  - "SANDBOX_PROXY_EXCEPTION (sandbox-proxy-login): the twelve proxy URL names as url-userinfo loopback, and CLOUDSDK_PROXY_PASSWORD only beside a loopback CLOUDSDK_PROXY_ADDRESS; named in the row evidence and the stored row's exceptions field"
  - "MATCHER_REVISION 4 ({MATCHER_CLAUDE_VERSION}+r4); ProbeException and the optional ProbeTarget.exceptions in counterpoint/doctor/v1"
  - "Rerun 2 on claude 2.1.321 passed its stop rule (evidence /Volumes/Dock/Dev/Caches/cp-test-0126/evidence-01-26-rerun2/)"
  - "WINDOWS.md entry 4 (the sandbox proxy login) appended and waived through gsd-tools; entry 3 still open for 01-23"
affects: [01-22, 01-23, 01-19, 01-20, 01-16, phase-02-builders]

# Actuals (#2632): chars/4 over the realized diff (132,179 chars, git diff b9d86ee..06e0077; the
# two cherry-picked commits are part of it)
actuals:
  tokens: 33045
  tasks: 2
  commits: 7
plan_head_before: b9d86ee49cac48eb490547ce369cec1a54cb1455
plan_head_after: 06e0077a414794e624e6a2071f0af87d9a82313e

tech-stack:
  added: []
  patterns:
    - "A listing script classifies a host into a class word without ever printing the host (fail closed: every unrecognised form reads other)"
    - "An owner exception is a named, dated constant applied by the row's own rule and carried in the stored row, never a widened pattern"
    - "A conditional exception: an entry is excepted only when another entry in the same listing carries the required class"

key-files:
  created:
    - src/agent/env-listing.ts
    - tests/agent/probe-env.live.test.ts
  modified:
    - src/agent/probe.ts
    - src/agent/probe-evaluator.ts
    - src/core/security/doctor-report.ts
    - src/core/security/sandbox-settings.ts
    - tests/agent/probe-plan.test.ts
    - tests/agent/probe-evaluator.test.ts
    - tests/doctor/doctor.test.ts
    - tests/core/security/sandbox-settings.test.ts
    - tests/server/phases.test.ts
    - tests/e2e/phases.e2e.test.ts
    - tests/e2e/needs-you.e2e.test.ts
    - .planning/WINDOWS.md

key-decisions:
  - "Owner decision applied (STATE.md [Owner] 2026-11-10, CLOUDSDK_PROXY_PASSWORD joins the sandbox-proxy-login exception): CREDENTIAL_ENV_DENY keeps only CLAUDE_CODE_MESSAGING_TOKEN; CLOUDSDK_PROXY_PASSWORD is excepted only when CLOUDSDK_PROXY_ADDRESS in the same listing has host class loopback"
  - "CLOUDSDK_PROXY_ADDRESS always carries a bare-host class (loopback iff the whole value, lower-cased, is localhost, ::1, [::1] or a dotted 127.0.0.0/8 address); a host class other is a finding whatever the shape, so a non-loopback address fails the row even without the password"
  - "The exception's reason stays \"the sandbox's own proxy login, local only\"; its decision text cites both STATE.md [Owner] entries and names the CLOUDSDK_PROXY_* gcloud proxy config"
  - "Reachable evidence tags each finding with its session ((treatment), (control) or (both)); Blocked evidence names the denied name as absent and, when the exception was needed, the sorted union of excepted names"
  - "Task 2's RED attempt was INVALID_RED unexpected_green: Task 1 step 3 had already built the full decision order, as the plan required. Two temporary mutations were each caught, so the matrix discriminates; no GREEN code change was needed"

patterns-established:
  - "Env listing judged by one leaf module (env-listing.ts) shared by the live test and the evaluator"
  - "Doctor CLI cases for a row the fake claude cannot fully exercise: take that row from the real probe pipeline and the others from fakeProbe"

requirements-completed: [FOUND-04, FOUND-03]

coverage:
  - id: D1
    description: "The launch profile denies CLAUDE_CODE_MESSAGING_TOKEN through sandbox.credentials.envVars (mode deny), with and without a workdir; the control copies the entry fresh"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/core/security/sandbox-settings.test.ts#denies the credential env vars, with and without a workdir (scrub replacement 3, 01-26)"
        status: pass
      - kind: unit
        ref: "tests/agent/probe-plan.test.ts#copies the treatment's credential env deny entries into the control as fresh entries"
        status: pass
    human_judgment: false
  - id: D2
    description: "ENV_SHAPE_AWK prints names, lengths, shapes and host classes only (URL host and bare CLOUDSDK_PROXY_ADDRESS), never a value or a 6-character piece of one"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/agent/probe-plan.test.ts#ENV_SHAPE_AWK on /usr/bin/awk (01-26)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The sandbox-proxy-login exception: the twelve URL names as url-userinfo loopback, CLOUDSDK_PROXY_PASSWORD only beside a loopback CLOUDSDK_PROXY_ADDRESS; every near miss stays a finding"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/agent/probe-plan.test.ts#the sandbox proxy exception (01-26)"
        status: pass
      - kind: unit
        ref: "tests/agent/probe-evaluator.test.ts#the credential-env row > excepts CLOUDSDK_PROXY_PASSWORD only beside a loopback CLOUDSDK_PROXY_ADDRESS"
        status: pass
    human_judgment: false
  - id: D4
    description: "Rerun 2 on the owner's claude 2.1.321: auto mode, the exact step only, unrefused, recognised listing, the deny entry launched, the denied name absent, all URLs and the address loopback, nothing unexcepted, before any evaluator edit"
    requirement: FOUND-04
    verification:
      - kind: other
        ref: "COUNTERPOINT_LIVE_PROBE=1 vitest run --project unit tests/agent/probe-env.live.test.ts (1 passed); rerun stop-rule gate exit 0; evaluator-record gate exit 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "The credential-env row in the evaluator: env-shape reach rule, Reachable/Not checked/Blocked matrix, exceptions field, MATCHER_REVISION 4"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "tests/agent/probe-evaluator.test.ts#the credential-env row"
        status: pass
      - kind: unit
        ref: "tests/agent/probe-evaluator.test.ts#the env-shape reach rule"
        status: pass
      - kind: unit
        ref: "tests/agent/probe-evaluator.test.ts#isCredentialName"
        status: pass
    human_judgment: false
  - id: D6
    description: "counterpoint doctor prints the ninth row, names the owner exception, stores exceptions, and exits 1 with the row REACHABLE on the denied token or a non-loopback proxy"
    requirement: FOUND-04
    verification:
      - kind: integration
        ref: "tests/doctor/doctor.test.ts#the credential-env row through the real probe pipeline (01-26, fake claude)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The doctor report carries nine rows; a report without credential-env parses and reads fail; ProbeException is strict; the route and e2e all-pass fixtures carry the ninth row"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/core/security/sandbox-settings.test.ts#DoctorReport"
        status: pass
      - kind: e2e
        ref: "pnpm test:e2e (5 files, 44 passed)"
        status: pass
    human_judgment: false
  - id: D8
    description: "WINDOWS.md entry 4 appended and waived through gsd-tools, citing both STATE.md [Owner] decisions; entry 3 still open"
    verification:
      - kind: other
        ref: "Task 2 ledger gate (same predicate, run from a script file): excepted=13 waivedMatches=1 entry3=open, exit 0"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-11-10
status: complete
---

# Phase 1 Plan 26: Credential-env row (scrub replacement 3) Summary

**`counterpoint doctor` now has a ninth row, `Credentials in the shell environment`. It lists a sandboxed Bash command's environment by name, length, shape and host class, never a value. It reads Reachable if either session's shell holds a credential-shaped variable outside the owner's `sandbox-proxy-login` exception. The launch profile denies `CLAUDE_CODE_MESSAGING_TOKEN`. The twelve loopback proxy URLs, and `CLOUDSDK_PROXY_PASSWORD` beside a loopback `CLOUDSDK_PROXY_ADDRESS`, are the owner's named exception, shown in the row evidence and the stored report. Rerun 2 on claude 2.1.321 passed its stop rule before any evaluator work. `MATCHER_REVISION` is 4, and the unit (974) and e2e (44) suites are green.**

## Performance

- **Duration:** about 25 min. The live session took 18.2 s.
- **Started:** 2026-11-10T14:03:39Z
- **Completed:** 2026-11-10T14:28:30Z
- **Tasks:** 2 of 2.
- **Files modified:** 14.

## Prior runs and owner decisions

This SUMMARY replaces both halted SUMMARYs: the first run's, on the unmerged branch `worktree-agent-aaa9c94172f5cec6c`, and the rerun's, commit `d422916` on `worktree-agent-a99955ff5fe9c04dc`. That one was not cherry-picked. The earlier evidence folders are untouched.

1. **First listing (halted run, 1fc2492; evidence `/Volumes/Dock/Dev/Caches/cp-test-0126/evidence-01-26-live/`).**
   - **Run:** claude `2.1.321`, `permissionMode` `auto`, no notices. One `Bash` call with the exact step, decision `{accept, config, classifier}`.
   - **Listing:** 54 entries, 0 malformed, 14 findings:
     - by name, both `opaque` with 32 characters: `CLAUDE_CODE_MESSAGING_TOKEN` and `CLOUDSDK_PROXY_PASSWORD`;
     - by value: 12 proxy URLs shaped `url-userinfo`.
   - **Outcome:** stop rule (e).
   - **Owner decision 1** (STATE.md `[Owner]` 2026-11-10, "Credential-env row scoped to the real requirement"):
     - deny both named variables;
     - record each proxy URL's host class;
     - loopback proxy logins become the named exception `sandbox-proxy-login`.
   - The stop rules were narrowed in the same session.
2. **Rerun (halted, commits be3a018/d422916; evidence `/Volumes/Dock/Dev/Caches/cp-test-0126/evidence-01-26-rerun/`).**
   - **Run:** the same mode, call and decision. Both deny entries were launched.
   - **Listing:** 53 entries, 0 malformed.
     - `CLAUDE_CODE_MESSAGING_TOKEN` was gone, and all 12 proxy URLs read `loopback`.
     - `CLOUDSDK_PROXY_PASSWORD` was still present despite its deny entry.
   - **Outcome:** stop facts (c) and (e).
   - **Owner decision 2** (STATE.md `[Owner]` 2026-11-10, "CLOUDSDK_PROXY_PASSWORD joins the sandbox-proxy-login exception"):
     - drop the password from the deny list;
     - except it only when `CLOUDSDK_PROXY_ADDRESS` has host class `loopback`;
     - the messaging token stays denied.
3. **Rerun 2 (this run, below): passed.**

## What was built

**Step 0 (cherry-picks, clean):** `git cherry-pick -x b496e59` then `git cherry-pick -x be3a018`. In this worktree they are `e937115` and `64b3c62`. The first carries both trailers: `(cherry picked from commit 1fc24929…)` and `(cherry picked from commit b496e598…)`.

**Owner decision 2 (`17d3183`):**
- **src/core/security/sandbox-settings.ts:**
  - `CREDENTIAL_ENV_DENY = ['CLAUDE_CODE_MESSAGING_TOKEN']`.
  - The header now says why `CLOUDSDK_PROXY_PASSWORD` left the list: the rerun showed the deny entry does not reach it, because Claude Code sets the `CLOUDSDK_PROXY_*` config after deny entries apply. It cites the STATE entry.
- **src/agent/probe.ts `ENV_SHAPE_AWK`:**
  - A shared `loopback_host(v)` check. `host_class(v)` (the URL rule) is unchanged in behaviour.
  - A new `address_class(v)` for the bare host. `loopback` holds iff the whole value, lower-cased, is `localhost`, `::1`, `[::1]` or a dotted 127.0.0.0/8 address. Anything else is `other`: a port, a scheme, whitespace, an empty value.
  - The BEGIN block gives `CLOUDSDK_PROXY_ADDRESS` its class first, and every other `url-userinfo` line its URL class. It still has one print statement.
- **src/agent/env-listing.ts:**
  - `PROXY_ADDRESS_NAME`.
  - One line regex, with a class due exactly for `url-userinfo` lines or the address line. The address line without a class is malformed, and so is a class on any other line.
  - A host class `other` is a finding whatever the shape, for example `CLOUDSDK_PROXY_ADDRESS (value: plain, 15 chars, host other)`.
  - `SANDBOX_PROXY_EXCEPTION` now holds `proxyUrlNames` (the twelve) and `gcloudPassword: { name: CLOUDSDK_PROXY_PASSWORD, requires: CLOUDSDK_PROXY_ADDRESS }`. Its `decision` cites both STATE entries and names the gcloud proxy config. `SANDBOX_PROXY_EXCEPTION_NAMES` lists all 13 names.
  - `exceptedEntries` takes the password only when the same listing has the address with class `loopback`.
- **Tests:**
  - The `/usr/bin/awk` case plants `CLOUDSDK_PROXY_ADDRESS=127.0.0.1`.
  - A new case runs the script once per planted address: 6 loopback forms and 11 `other` forms. Each output line must be exactly `CLOUDSDK_PROXY_ADDRESS {length} plain {class}`.
  - The exception describe gains the address line forms and the conditional password cases.
  - Step-1 gate: 131 passed.
- **Live test:** writes `evidence-01-26-rerun2` and records `proxyAddress`, the address's host class only.

**Step 3 (`d9646a5`), after rerun 2 passed:**
- **src/core/security/doctor-report.ts:**
  - The ninth id `credential-env` (`Credentials in the shell environment`, mode `read`).
  - The strict `ProbeException`: id literal `sandbox-proxy-login`, a `YYYY-MM-DD` date and a non-empty `names` list.
  - The optional `ProbeTarget.exceptions`, and a header note.
- **src/agent/probe-evaluator.ts:**
  - Imports the parser, the exception and the finding functions from `./env-listing.ts`, and `CREDENTIAL_ENV_DENY`. It defines no second parser.
  - `OPERATION_LABEL['env-shape'] = 'environment listing'`.
  - **The env-shape reach rule** sits after the refusal families. A step is `reached` only when all of these hold; anything else is `unknown`:
    - `is_error` is false;
    - there is no reject decision and no `permission_denials` entry;
    - the listing is recognised.
  - `EvaluateProbeOptions.envScriptIntact`.
  - `credentialEnvRow` decides the row in this order:
    1. the plans match step for step;
    2. unexcepted findings in either session read Reachable, each tagged by session;
    3. a changed script reads Not checked;
    4. a step that was not `reached`, or an unrecognised listing, reads Not checked;
    5. the baseline and version-distrust rules apply as for every row;
    6. otherwise Blocked, with `exceptions` when the exception was needed.
  - `MATCHER_REVISION = 4`.
- **Tests:**
  - The frozen pairs read `credential-env` `not-checked`.
  - Blocked cases: clean listings, the twelve URLs, and the rerun's own shape (twelve URLs plus the gcloud config).
  - The env-shape reach rule (6 cases).
  - Doctor through the real probe pipeline (below).
  - DoctorReport: nine ids; a pre-01-26 report fails; the exception round-trips; four malformed exceptions are rejected.
  - The route fixture gains the ninth row.

**Task 2 (`0234cd2`, `131e35f`, `06e0077`):**
- The full matrix `describe('the credential-env row')` (23 cases) and an `isCredentialName` table (13 flagged, 22 not flagged).
- The e2e `PROBE` lists gain the ninth row.
- Ledger entry 4.

## Rerun 2 (exactly once)

- **Pre-run checks:** `git diff --quiet HEAD -- src/agent/probe-evaluator.ts` exited 0. `-t "denies the credential env vars"` gave 1 passed. `claude --version` gave `2.1.321 (Claude Code)`.
- **Command:** `COUNTERPOINT_LIVE_PROBE=1 pnpm exec vitest run --project unit tests/agent/probe-env.live.test.ts`, with `CP_TEST_SCRATCH=/Volumes/Dock/Dev/Caches/cp-test-0126` and the Dock pnpm env.
- **Vitest summary:** `Test Files  1 passed (1)` / `Tests  1 passed (1)`, 18.20 s.
- **Session:**
  - model `claude-haiku-5-5`, one init event;
  - `permissionMode` `auto`;
  - stderr empty, so no notices;
  - exit 0, not timed out, result subtype `success`.
- **Tool uses:** exactly one: `Bash` with the exact step command, `awk -f '{scratch}/lprb-…/cp-env-{nonce}.awk'`.
- **Decision record:** `{decision: accept, source: config, reason_type: classifier}`. No `permission_denied` event, no `permission_denials` entry, `is_error` false.
- **`launchedCredentials`:** `[{name: CLAUDE_CODE_MESSAGING_TOKEN, mode: deny}]`.
- **`evaluator` record:**
  - `head` `17d31832061e214983f17bc35698b150c2881826`;
  - `headBlob` and `blob` both `369311df9c97a734431e6f46e86d272124f32563`;
  - `uncommittedEdit` false.
  - `git log -E --grep='^[a-z]+\(01-26\)' 17d3183 -- src/agent/probe-evaluator.ts` printed nothing, so the ordering held.
- **Value check:** a count-only search for a `scheme://user:password@` form found 0 matches in the kept stream, `session.json` and `env-listing.json`. A search for `127.0.0.` found 0 matches in the two JSON files.

### Every listed name (53 entries, 0 malformed, PATH and HOME present)

- **`url-userinfo`, host class `loopback` (12):**
  - 100 characters: `HTTP_PROXY`, `http_proxy`, `HTTPS_PROXY`, `https_proxy`, `ALL_PROXY`, `all_proxy`, `GRPC_PROXY`, `grpc_proxy`, `DOCKER_HTTP_PROXY`, `DOCKER_HTTPS_PROXY`;
  - 103 characters: `FTP_PROXY`, `ftp_proxy`.
- **`opaque` (1):** `CLOUDSDK_PROXY_PASSWORD`, 32 characters.
- **`plain` with host class `loopback` (1):** `CLOUDSDK_PROXY_ADDRESS` (`proxyAddress` = `loopback`).
- **`plain` (39):**
  - shell and agentEnv: `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `SHELL`, `TMPDIR`, `PWD`, `OLDPWD`, `SHLVL`, `_`, `TMPPREFIX`;
  - Claude Code: `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_TMPDIR`, `CLAUDE_TMPDIR`, `CLAUDE_EFFORT`, `CLAUDE_PID`, `AI_AGENT`;
  - git: `GIT_EDITOR`, `GIT_SSH_COMMAND`, `GIT_CONFIG_PARAMETERS`;
  - sandbox runtime and proxy: `SANDBOX_RUNTIME`, `SRT_SSH_PROXY_COMMAND`, `RSYNC_PROXY`, `NO_PROXY`, `no_proxy`, `CLOUDSDK_PROXY_TYPE`, `CLOUDSDK_PROXY_PORT`, `CLOUDSDK_PROXY_USERNAME`, `JAVA_TOOL_OPTIONS`;
  - others: `COREPACK_ENABLE_AUTO_PIN`, `NoDefaultCurrentDirectoryInExePath`.

### The judged lists (env-listing.json)

- **`findings`** (13): the twelve URLs as `NAME (value: url-userinfo, {100|103} chars, host loopback)`, and `CLOUDSDK_PROXY_PASSWORD (name)`.
- **`excepted`** (13): the twelve URL names and `CLOUDSDK_PROXY_PASSWORD`.
- **`unexcepted`:** `[]`.
- **`deniedPresent`:** `[]`.
- **`proxyAddress`:** `loopback`.

### Against the first listing's 14 findings

- **Gone:** `CLAUDE_CODE_MESSAGING_TOKEN`, as in the rerun. Its socket variable `CLAUDE_CODE_MESSAGING_SOCKET` is still listed, which suggests the deny entry removes it. That is an inference: the run cannot tell a removed variable from one that was never exported.
- **Present, now excepted:** all 12 proxy URLs, at the same lengths and `loopback`, and `CLOUDSDK_PROXY_PASSWORD`, now beside a loopback address.
- **Names:** the same 53 names as the rerun. No new name appeared.

### Stop rule outcome (narrowed; STATE.md [Owner] 2026-11-10, with owner decision 2)

| Fact | Held? | Evidence |
|------|-------|----------|
| (a) step refused or did not run | no | one Bash call with the exact command, classifier accept, no denial record, `is_error` false |
| (b) listing unrecognised | no | 0 malformed, PATH and HOME present |
| (c) a still-denied name present | no | `deniedPresent` = [] (`CLAUDE_CODE_MESSAGING_TOKEN` absent) |
| (d) a proxy URL or `CLOUDSDK_PROXY_ADDRESS` with host class `other` | no | all 12 URLs and the address `loopback` |
| (e) any other unexcepted credential-shaped variable | no | `unexcepted` = [] |

## Findings (recorded, not stop facts)

- The mode was `auto`, with no notice and one tool call. The approval `reason_type` was `classifier`, the same in all three runs.
- `CLOUDSDK_PROXY_PASSWORD` survives a `sandbox.credentials.envVars` deny entry on claude 2.1.321, and `CLAUDE_CODE_MESSAGING_TOKEN` does not. This is a sandbox behaviour. It is recorded in WINDOWS.md entry 4's description, which the owner's exception waives. No separate entry was added.

## Plan verify gates

**Task 1**
- Five-file unit gate (`probe-plan`, `probe-evaluator`, `doctor`, `sandbox-settings`, `phases`): 5 files, 250 passed.
- `-t "env-shape reach rule"`: 6 passed.
- `-t "denies the credential env vars"`: 1 passed.
- `-t "sandbox proxy exception"`: 6 passed.
- `pnpm typecheck && pnpm lint && pnpm test`: all exit 0. `pnpm test` reported 917 passed, 4 skipped at that point.
- **Rerun stop-rule gate:** exit 0. Adapted to owner decision 2, it requires the one deny entry `CLAUDE_CODE_MESSAGING_TOKEN` and also requires every `CLOUDSDK_PROXY_ADDRESS` entry to be `loopback`. Every other term is as the plan wrote it.
- **Evidence gate:** exit 0. It checks `test -s` on the `rerun2`, `rerun` and `live` files.
- **Evaluator-record gate:** both halves exit 0 (blob equals headBlob, and the grep found no commit).

**Tracer feedback gate:** this was an interactive run in `end-of-phase` mode, and the tracer's verify is automated only. I re-ran it green, so the plan expanded to Task 2.

**Task 2**
- `-t "credential-env"`: 27 passed.
- `pnpm typecheck && pnpm lint && pnpm build:ui`: exit 0.
- `pnpm test`: 31 files, 974 passed, 4 skipped.
- `pnpm test:e2e`: 5 files, 44 passed.
- **Ledger gate:** exit 0, with `excepted=13 waivedMatches=1 entry3=open`. It ran as plain separate commands (see the refusals below).

## Ledger (WINDOWS.md, through gsd-tools only)

- `windows append` created **entry 4**: kind `unmet-truth`, phase 01, file `src/agent/env-listing.ts`. It names the 12 loopback proxy URLs and `CLOUDSDK_PROXY_PASSWORD` beside a loopback `CLOUDSDK_PROXY_ADDRESS` (names and shapes only).
- `windows waive 4` recorded the owner's reason. It cites both STATE.md `[Owner]` decisions of 2026-11-10 and `sandbox-proxy-login`.
- The frontmatter, set by the tool, reads `open_count: 3`, `waived_count: 1`, `total_count: 4`.
- Entry 3 is still `open`; 01-23 closes it.

## TDD Gate Compliance (Task 2, tdd="true")

- **RED attempt:**
  - **Command:** `vitest run --project unit tests/agent/probe-evaluator.test.ts -t "the credential-env row|isCredentialName" --reporter=junit --outputFile=.tmp/tdd-01-26-red.xml`.
  - **Result:** exit 0. The JUnit report shows 62 run and 0 failures.
  - **Classifier:** `gsd-tools check tdd-red-evidence` returned `INVALID_RED`, reason `unexpected_green`.
- **Investigation (fail-fast rule 1):**
  - **Why it was green:** the feature exists because Task 1 step 3 implemented the credential-env row's whole decision order, as the plan required. Task 2 asks only to "fix whatever the evaluator gets wrong".
  - **Mutation 1:** making `exceptedEntries` ignore the URL host class. The case "reads Reachable on a proxy URL with host class other" failed, as it should.
  - **Mutation 2:** dropping the `envScriptIntact` check. The case "reads Not checked when the listing script changed or its state is unknown" failed, as it should.
  - Both mutations were reverted with file-specific `git checkout --`.
- **Conclusion:** the tests are not wrong and the behaviour already exists. There was no GREEN change, so there is no `feat` commit for Task 2. The `test(01-26)` commit is `0234cd2`.
- **An earlier filter mistake:** a first run with `-t "the credential-env row$|…"` matched only the `isCredentialName` cases, because the `$` anchor does not match vitest's full test names. I found this while running the mutations and re-ran with the correct filter. The numbers above are from the corrected run.

## Command-guard refusals (verbatim; nothing was worked around)

1. **The combined worktree branch-check block.**
   - Refusal: "This agent is isolated in the worktree /Volumes/Dock/Projects/HKP/Counterpoint/.claude/worktrees/agent-a6a030b48a1398fa8, but this command is too complex to verify that it stays inside the worktree. Refusing to run it — a worktree-isolated agent's git operations must target its own worktree. Split it into plain, separate commands and run them from /Volumes/Dock/Projects/HKP/Counterpoint/.claude/worktrees/agent-a6a030b48a1398fa8."
   - What I did: ran `git symbolic-ref --quiet HEAD` and `git rev-parse HEAD` as plain separate commands, as the refusal says. Both assertions held.
2. **A python heredoc editing src/agent/env-listing.ts.**
   - Refusal: the same "too complex … Split it into plain, separate commands" text.
   - What I did: made the same edits with the Edit tool.
3. **A python heredoc editing tests/core/security/sandbox-settings.test.ts.**
   - Refusal: "This agent is isolated in the worktree …, but this command feeds python text naming git in a plain command, which cannot be shown to stay inside the worktree. Refusing to run it — a worktree-isolated agent's git operations must target its own worktree. Run the plain command from …".
   - What I did: made the same edit with the Edit tool.
4. **A shell heredoc appending the Task 2 matrix, followed by a Biome format.**
   - Refusal: the same "too complex" text.
   - What I did: appended the same text with the Edit tool.
5. **A `sed -E` rename of the matrix's helpers `T`/`C`** (Biome's `noComponentHookFactories`).
   - Refusal: "This agent is isolated in the worktree …, but this command runs sed with the program 1170,$ s/[[:<:]]T\(/tStream(/g; 1170,$… in a plain command, so what it runs cannot be shown not to be git (the check cannot tell where every sed ends a pattern or address here: …). Refusing to run it — …".
   - What I did: checked that every use sits in the new describe, then made the same rename with the Edit tool's replace-all.
6. **The plan's ledger-gate one-liner.**
   - First refusal, while chained with `head` and `git status`: "… names git in a form too complex to verify …".
   - Second refusal, alone: "… this command runs node with a program that can start another program (require(r) next to an operand, env value or input that is computed at runtime or not plain text inside a construct too complex to verify, so what it runs cannot be shown not to be git. Refusing to run it — … Split it into plain, separate commands …".
   - What I did, as the refusal asks:
     1. `gsd-tools windows status` into a scratchpad file;
     2. the identical predicate from a scratchpad script with both file paths as plain arguments.
7. **A loop of acceptance greps chained with `cat` of the ledger base file.**
   - Refusal: "… names git in a form too complex …".
   - What I did: ran the greps as separate plain commands.

## Deviations from Plan

1. **[Owner decision 2] Scope changes since the plan text (4682176):**
   - `CREDENTIAL_ENV_DENY` holds only `CLAUDE_CODE_MESSAGING_TOKEN`.
   - The Blocked evidence reads `denied and absent: CLAUDE_CODE_MESSAGING_TOKEN`.
   - The exception covers 13 names, the password conditionally.
   - The rerun gate checks the one deny entry and the address class.
   - The live test writes `evidence-01-26-rerun2`.
   - Commits `17d3183` and `d9646a5`.
2. **[Owner decision 2, design] The exception constant's shape changed.**
   - `names` became `proxyUrlNames` (the twelve) plus `gcloudPassword`, with an exported `SANDBOX_PROXY_EXCEPTION_NAMES`.
   - `reason` is unchanged, so the evidence string the plan pins still holds.
   - Commit `17d3183`.
3. **[Rule 2, stricter, per the owner's "a non-loopback address fails the row"]** Any entry with host class `other` is a finding whatever its shape. Before this, only `url-userinfo` entries carried a class. Commit `17d3183`.
4. **[Test design] The doctor CLI cases.**
   - The plan wanted the fake-claude pipeline to print every row BLOCKED. A fake claude cannot produce the deterministic denials the other eight rows need.
   - So the four new doctor cases run the real `runSandboxProbe`. The fake claude answers only the env step and the unprotected control canary (a plain file in the probe folder, never a symlink), so the baseline holds.
   - The cases take the real `credential-env` row and fakeProbe's Blocked rows for the other eight. Exit codes and summaries then follow the real row.
   - The existing OutsideWriter pipeline case is unchanged.
   - Commit `d9646a5`.
5. **[Rule 1, fixtures] Tests that assumed eight rows were updated to nine:**
   - doctor counts (`10 checks did not pass`, 8 Not checked);
   - the evaluator's all-Blocked fixtures now also carry clean env listings and `envScriptIntact`;
   - probe-plan's launch test expects `credential-env` `not-checked`;
   - the pre-01-17 "seven rows" test also drops `credential-env`.
   - Commit `d9646a5`.
6. **[Addition] Extra cases:**
   - a tracer case on rerun 2's own shape (twelve URLs plus the gcloud config, 13 excepted names);
   - a reach-rule case: a clean listing with a reject decision, or a `permission_denials` entry, is `unknown`;
   - a split-session case: a loopback address in the control does not except the treatment's password.
7. **[Rule 3, TS] erasableSyntaxOnly.** A constructor parameter property in the doctor test's fake runner became an explicit field.

**Total deviations:** 7, of which 2 come from the owner's decision and 5 are test or fixture adjustments. **Impact:** nothing was loosened beyond owner decision 2. The name rule and the shapes are unchanged. The exception covers exactly the twelve URL names and the conditional password, and the address rule is fail-closed.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model.
- **T-01-105** holds: only names, lengths, shapes and host classes were written. The count-only value checks found 0 matches.
- **T-01-108** now also covers the conditional password. The mitigation is exact: the name must match exactly and the same listing must hold a loopback address, and the near misses are unit-tested.
- **T-01-109** is mitigated for `CLAUDE_CODE_MESSAGING_TOKEN`. For `CLOUDSDK_PROXY_PASSWORD` it is replaced by the owner's accepted exception (STATE.md `[Owner]` 2026-11-10).

## User Setup Required

None.

## Next Phase Readiness

- 01-22 can render the ninth row and its `exceptions` field on the Trust page.
- 01-23's full nine-row live probe can close WINDOWS.md entry 3.
- Evidence:
  - `/Volumes/Dock/Dev/Caches/cp-test-0126/evidence-01-26-rerun2/` (`session.json`, `env-listing.json`, `stream.jsonl`, `stderr.txt`);
  - the same files in this worktree's gitignored `.tmp/live-env/`;
  - the earlier `evidence-01-26-live/` and `evidence-01-26-rerun/` are untouched.
- After merge, the orchestrator removes the halted worktrees `agent-aaa9c94172f5cec6c` and `agent-a99955ff5fe9c04dc`, and their branches.

## Self-Check: PASSED

- Files exist: src/agent/env-listing.ts, tests/agent/probe-env.live.test.ts, the rerun2 evidence files, and this SUMMARY.
- All 7 commits are on HEAD: `e937115`, `64b3c62`, `17d3183`, `d9646a5`, `0234cd2`, `131e35f`, `06e0077`. `git rev-list --count b9d86ee..HEAD` = 7 before this SUMMARY commit.
- STATE.md, ROADMAP.md and REQUIREMENTS.md were not touched; the orchestrator owns them.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-10*
