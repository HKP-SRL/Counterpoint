---
phase: 01-trusted-shell-signed-runway
reviewed: 2026-11-10T20:32:25Z
depth: standard
files_reviewed: 81
files_reviewed_list:
  - src/core/security/agent-env.ts
  - src/core/security/sandbox-settings.ts
  - src/core/security/sandbox-isolation.ts
  - src/core/security/doctor-report.ts
  - src/core/security/accepted-risks.ts
  - src/core/security/guard.ts
  - src/core/security/login.ts
  - src/agent/runner.ts
  - src/agent/claude-argv.ts
  - src/agent/probe.ts
  - src/agent/probe-evaluator.ts
  - src/agent/env-listing.ts
  - src/doctor/run.ts
  - src/doctor/settings-sources.ts
  - src/doctor/signing-key.ts
  - src/doctor/tools.ts
  - src/core/approvals/canonical.ts
  - src/core/approvals/commit.ts
  - src/core/approvals/digest.ts
  - src/core/approvals/gates.ts
  - src/core/approvals/integrity.ts
  - src/core/approvals/prepare.ts
  - src/core/approvals/ssh.ts
  - src/core/approvals/statement.ts
  - src/core/approvals/trust-store.ts
  - src/core/approvals/verify.ts
  - src/core/git/diff.ts
  - src/core/git/plumbing.ts
  - src/core/git/reader.ts
  - src/core/git/run.ts
  - src/core/host/home.ts
  - src/core/host/registry.ts
  - src/core/ids.ts
  - src/core/framework/port.ts
  - src/core/runway/needs-you.ts
  - src/core/runway/runway.ts
  - src/core/runway/status.ts
  - src/core/store/db.ts
  - src/core/store/events.ts
  - src/compose.ts
  - src/adapters/gsd/index.ts
  - src/adapters/gsd/inputs.ts
  - src/adapters/gsd/layout.ts
  - src/adapters/gsd/normalize.ts
  - src/adapters/gsd/plans.ts
  - src/adapters/gsd/roadmap.ts
  - src/server/app.ts
  - src/server/approval-views.ts
  - src/server/control.ts
  - src/server/daemon.ts
  - src/server/hosts.ts
  - src/server/sse.ts
  - src/server/watcher.ts
  - src/server/routes/approvals.ts
  - src/server/routes/needs-you.ts
  - src/server/routes/phases.ts
  - src/server/routes/trust.ts
  - src/cli/main.ts
  - src/cli/approve.ts
  - src/cli/control-client.ts
  - src/cli/doctor.ts
  - src/cli/risk.ts
  - src/cli/trust.ts
  - ui/src/api.ts
  - ui/src/live.ts
  - ui/src/main.tsx
  - ui/src/router.tsx
  - ui/src/runway.ts
  - ui/src/theme.ts
  - ui/src/components/ApprovalDialog.tsx
  - ui/src/pages/ChangeViewPage.tsx
  - ui/src/pages/MissionPage.tsx
  - ui/src/pages/NeedsYouPage.tsx
  - ui/src/pages/PhaseDetailPage.tsx
  - ui/src/pages/TrustPage.tsx
  - ui/src/shell/AppFrame.tsx
  - scripts/backstop.ts
  - scripts/host-phases.ts
  - package.json
  - tsdown.config.ts
  - ui/vite.config.ts
findings:
  critical: 1
  warning: 8
  info: 5
  total: 14
  necessity: 0
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-11-10T20:32:25Z
**Depth:** standard
**Files Reviewed:** 81
**Status:** issues_found

## Summary

Scope: all tracked source from Phase 01 under `src/`, `ui/src/`, `scripts/` and the build config. Tests, fixtures, `.planning/`, `dist/`, `.tmp/` and `node_modules` were excluded. The security-critical paths were read line by line: agent env and sandbox profile, the probe and its evaluator, doctor, approvals signing and verification, git plumbing, the server guard chain, login, the control socket, and the CLI. The UI pages, the GSD adapter parsers and `scripts/` were checked for injection sinks, shell-string spawning and unsafe rendering by pattern scan only. No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `shell: true` was found.

Overall the code is careful. Every spawn uses an argument array. git runs through a hardened runner. The approval verifier fails closed and does not trust git's own signature checks. Signing happens only at the terminal, with no agent socket or askpass. The console binds 127.0.0.1 and checks Host, Origin and session. The owner's recorded exceptions are implemented no more broadly than the decisions in STATE.md:
- auto permission mode
- the scrub opt-out with its three replacements
- `gh-keychain`
- `sandbox-proxy-login`

The main concern is that the doctor can report "boxed in" while sandboxed Bash can still write outside the working folder. The settings judge ignores the filesystem and directory widenings that Claude Code merges in from user and managed settings, and the probe never tests a Bash write outside the git dir. Replacement 1 for the scrub (`autoAllowBashIfSandboxed: false`) has no effect, because the launch profile allows every Bash command (bare `Bash`). Most of the other findings are fail-open gaps in defence-in-depth:
- the reader follows replace refs
- the integrity key list has gaps
- duplicate phase folders and roadmap headings are not covered by the signature
- `git status` in the owner's checkout can run repo-config clean filters

The necessity rubric (`.claude/gsd-core/references/necessity-review.md`) was read. No finding met its evidence rule.

## Critical Issues

### CR-01: Doctor can pass while sandboxed Bash writes outside the working folder (user/managed `allowWrite`, `additionalDirectories` not judged; no Bash outside-write probe step)

**File:** `src/core/security/sandbox-isolation.ts:90-141` (ISOLATION_RULES), `src/agent/probe.ts:495-541` (outside-workdir steps), `src/core/security/sandbox-settings.ts:16-28`
**Issue:** The launch profile's stated Bash confinement is `sandbox.filesystem.allowWrite: []`, and the comment says "The block does not limit shell commands: `sandbox.filesystem.allowWrite: []` (Seatbelt) still confines Bash". But agent sessions load `--setting-sources user`. The module's own cited doc for `excludedCommands` says: "When you define the same filesystem array in multiple settings scopes, Claude Code merges them". So a `sandbox.filesystem.allowWrite` entry in `~/.claude/settings.json`, or in any managed source, widens where every agent Bash command may write. Two other widenings are not judged either:
- A user `permissions.additionalDirectories` adds working folders, and `blockWritesOutsideWorkingDirectories` then allows Write and Edit there.
- `sandbox.network.allowUnixSockets` / `allowAllUnixSockets` are not checked.

`ISOLATION_RULES` checks only these keys:
- `filesystem.disabled`
- `excludedCommands`
- `allowAppleEvents`
- the four managed-only Booleans

None of the widenings above is checked. The probe cannot catch them empirically either. The outside-workdir row uses only the Write and Edit tools, against `~/.cp-outside-{nonce}`. The only Bash writes are `: >> config` and `touch` inside the git dir. So a user `allowWrite: ["~"]`, which is a plausible entry for cache directories, lets an agent run `echo ... >> ~/.zshrc`. That is code execution as the owner, outside the sandbox. Meanwhile `counterpoint doctor` prints a pass. Under the owner's stop rule, an outside-workdir write that is accepted is a protected-target failure.
**Fix:** Judge the merged widenings in every non-launch source, and add a Bash write step to the outside row.

Judge the widenings in `ISOLATION_RULES`:
```ts
{ key: 'sandbox.filesystem.allowWrite', failsIn: 'any', safe: 'empty-list',
  effect: 'lets sandboxed commands write outside the working folder', doc: `${SANDBOXING} ... merges them` },
{ key: 'sandbox.filesystem.allowRead', failsIn: 'any', safe: 'empty-list', effect: '...', doc: '...' },
// and a permissions-level rule (needs a non-sandbox key path in findingsOf):
{ key: 'permissions.additionalDirectories', failsIn: 'any', safe: 'empty-list', effect: 'adds folders file tools may write', doc: '...' },
```
Exempt the `launch` source from the `allowWrite` rule only when it equals the builder's own grant.

Add a Bash outside-write step to the outside-workdir row in `planProbe`. The control session runs it against its mirror:
```ts
steps.push(bashStep('outside-workdir', 'touch', join(files.dir, `cp-${nonce}-b`), `touch '${join(files.dir, `cp-${nonce}-b`)}'`));
```
Then add `cp-{nonce}-b` to `PROBE_OUTSIDE_ARTIFACT_RE`, to the leftovers check and to the cleanup.

## Warnings

### WR-01: Replacement 1 for the scrub is inert: the bare `Bash` in `--allowedTools` rule-accepts every command

**File:** `src/core/security/sandbox-settings.ts:139` (`AGENT_TOOLS = ['Bash', 'Read', 'Grep', 'Glob']`), `src/core/security/sandbox-settings.ts:30-37`, `src/core/security/agent-env.ts:11-12`
**Issue:** The owner's opt-out decision replaced the scrub's sandbox auto-allow behaviour with `autoAllowBashIfSandboxed: false`. The comment says: "With it off, an unlisted sandboxed command goes through the permission rules and, in auto mode, the classifier". But the treatment and builder profile passes a bare `Bash` as an allow rule, so no Bash command is ever "unlisted". Each one is accepted by rule, and the classifier never sees it. The probe's own comment confirms this (`src/agent/probe.ts:71-76`): "with a bare `Bash` present a `rule` accept of a control Bash step could not be told apart". The setting is emitted and checked by doctor, but it changes nothing. The "three replacements" record therefore overstates what agent sessions get.
**Fix:** Pick one of two:
- Drop bare `Bash` from `AGENT_TOOLS`, so unlisted commands go to the auto-mode classifier as the decision intended. Bash stays available without being named, as the probe already relies on for the control session.
- Or correct the comments, WINDOWS.md and the STATE.md decision record to say that replacement 1 has no effect while `Bash` is allow-listed.

### WR-02: `trust-key` confirms one fingerprint but then trusts whatever key file is there

**File:** `src/cli/trust.ts:156-164`, `src/core/approvals/trust-store.ts:179-218`
**Issue:** `trustKeyCommand` reads the `.pub` with O_NOFOLLOW, prints `fingerprintOf(publicKeyPath)` and waits for the owner's `y`. Then `writeTrust` re-reads the same path with `readFileSync`, which follows symlinks, and computes a fresh fingerprint. It never compares that fingerprint with the one the owner confirmed. A process that can replace the `.pub` while the prompt is open gets its own key pinned as the approval key. The approval key lives wherever the owner chooses, and is not necessarily in the denied `~/.ssh`.
**Fix:** Pass the confirmed fingerprint, or the exact bytes already read, into `writeTrust`, and refuse on mismatch:
```ts
const trust = await writeTrust(home, { publicKeyPath, expectedFingerprint: fingerprint });
// in writeTrust: if (fingerprint !== options.expectedFingerprint) throw new Error('The key changed since you confirmed it.');
```
Also open with O_NOFOLLOW inside `writeTrust`.

### WR-03: Duplicate phase directories and repeated roadmap headings sit outside the signature (first match wins silently)

**File:** `src/adapters/gsd/inputs.ts:73-75`, `src/adapters/gsd/index.ts:52-59`, `src/adapters/gsd/layout.ts:15-21`
**Issue:** `approvalInputs` uses the first phase directory whose number matches. `parsePhaseNumber` normalises numbers, so `02-x` and `2-y` match the same phase. It also uses the first `## Phase NN` roadmap section. The snapshot does the same and skips repeated headings. A second directory such as `.planning/phases/2-extra/02-01-PLAN.md`, or a second "Phase 02" section appended to ROADMAP.md, changes nothing in the recomputed digests. The approval stays on the runway, yet the planning truth now holds plans and instructions the owner never signed. This contradicts the approve prompt's promise: "You sign the exact plans the builder will run". It is invisible until Phase 2's builder, which uses GSD's own resolution, picks something up.
**Fix:** Fail closed on ambiguity. In `listPhaseDirs` and in `parseRoadmap` callers, report a phase as `unreadable` ("two folders/sections for phase 02") when more than one directory or section maps to the same phase number. Make `approvalInputs` throw a refusal in that case, so the phase drops off the runway and Needs You shows the reason.

### WR-04: The input reader follows replace refs while the verifier refuses them

**File:** `src/core/git/reader.ts:79-134`, `src/core/runway/runway.ts:293-296`, `src/core/runway/needs-you.ts:425`
**Issue:** `plumbing.ts` deliberately passes `--no-replace-objects`, `GIT_NO_REPLACE_OBJECTS=1` and `GIT_GRAFT_FILE=/dev/null`, "so a ref under refs/replace/ cannot substitute a commit the verifier looks at". But `createGitFileReader` calls `runGit` directly without them, and every input digest (`approvalInputs`), the gates digest and the runway's approval-file listing are read through it. Once anything can write `refs/replace/<blob>` (Phase 2's builder grant into the common dir), the steps are:
1. Replace the edited plan's blob with the signed one.
2. The recomputed digest then matches the signature, and the item stays on the runway.
3. The pushed branch carries the real, unsigned content, because replace refs are not pushed by default.

**Fix:** Give the reader the same hardening as plumbing:
```ts
const HARDEN = ['-c', 'core.commitGraph=false', '--no-replace-objects'] as const;
const ENV = { GIT_LITERAL_PATHSPECS: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null' };
runGit(repoRoot, [...HARDEN, 'ls-tree', ...], { env: ENV });
```
The cleaner fix is to move both onto one shared `git()` helper.

### WR-05: The integrity baseline misses execution-capable keys and per-worktree config

**File:** `src/core/approvals/integrity.ts:40-70`, `src/core/approvals/integrity.ts:155-175`
**Issue:** `RISKY_CONFIG_KEYS` is documented as "what can make git run a program or change where it talks to". It omits several such keys:
- `diff.external` runs on every `git diff`. Only `diff.*.command` is matched, and `diff.external` has no subsection.
- `pager.*`
- `sequence.editor`
- `submodule.*.update`, which can be `!cmd`
- `difftool.*.cmd` and `mergetool.*.cmd`
- `core.alternateRefsCommand`
- `http.proxy`, `http.*.proxy` and `remote.*.proxy`

Two more gaps:
- Only the common-dir `config.worktree` is snapshotted. `worktrees/<id>/config.worktree` (with `extensions.worktreeConfig`) is not.
- `--no-includes` records the `include.path` key but never the content of the file it points to. An include target inside the working tree can change without the snapshot changing.

**Fix:**
- Add the missing patterns, including `diff.external`, `pager.*`, `sequence.editor`, `submodule.*.update`, `difftool.*.cmd`, `mergetool.*.cmd`, `core.alternaterefscommand`, `http.proxy`, `http.*.proxy` and `remote.*.proxy`.
- Snapshot `worktrees/*/config.worktree`.
- For each `include.path` / `includeIf.*.path` value, record `describeEntry(resolved target)`. Resolve relative paths against the git dir, as git does.

### WR-06: Needs You runs `git status` in the owner's checkout without the filter guard that commit.ts applies

**File:** `src/core/runway/needs-you.ts:429-433`
**Issue:** `git status` refreshes stat-dirty index entries by re-hashing them through the configured `clean` filter. That means it runs `filter.<driver>.clean` from `.git/config` for any input whose attributes name a filter. `run.ts` treats repository config as untrusted and turns off hooks, fsmonitor and the pager, but not filters. `commit.ts:checkCheckouts` explicitly refuses a path with a `filter` attribute before it calls `status` ("no content filter (which could run a program) may apply to it"). The Needs You poll does neither: it runs automatically in the daemon, on the owner's checkout, with no integrity check first.
**Fix:** Before `status`, run `filterAttribute(root, path)` for each source and treat any filtered input as "edited, cannot check". Alternatively, compare working-tree bytes directly with `readWorkingFile` plus a digest, without `git status`.

### WR-07: The runway cache pins a transient verification error until the base tip moves

**File:** `src/server/approval-views.ts:170`, `src/server/approval-views.ts:178-179`, `src/core/runway/runway.ts:242-245`
**Issue:** `stateAt` drops cache entries whose state is `invalid`/`error`. `runway()` and `needsYou()`, however, cache `computeRunway` with the default `keep = () => true`. `computeRunway` never throws for one bad approval: `approvalState` turns any exception into `{state:'invalid', reason:'error'}`, for example a 15 s ssh-keygen or git timeout under load. So one transient failure keeps that phase off the runway in the console, in `/control/status` and in Needs You for as long as the tip stays the same. The per-phase view meanwhile recovers. The headline runway count is then wrong in a direction that blocks work.
**Fix:**
```ts
return cached(cacheKey, runtime, tip, () => computeRunway(opts),
  (runway) => !runway.invalid.some((i) => i.reason === 'error'));
```
Apply the same `keep` to `needsYou`.

### WR-08: `stop` can signal an unrelated process from a stale `daemon.json`

**File:** `src/cli/main.ts:371-397`, `src/server/daemon.ts:156`, `src/server/daemon.ts:277`
**Issue:** `stopByPid` runs when the socket does not answer but the lock is held. It SIGTERMs, then SIGKILLs, the pid read from `daemon.json`, without checking that the pid is a Counterpoint daemon. `runDaemon` removes `start-result.json` at boot but not a `daemon.json` left by a crashed daemon. It only overwrites that file after the socket is up. Here is the failing sequence:
1. A daemon crashes, and its `daemon.json` with pid P remains.
2. The next daemon acquires the lock and is still starting.
3. During that window, `counterpoint stop` sees "lock held, socket dead" and kills P.
4. P may by now belong to any owner process.

**Fix:**
- In `runDaemon`, `rmSync(paths.daemonJson, { force: true })` right after `acquireLock`.
- In `stopByPid`, check the pid's command line first: `ps -o command= -p <pid>` through execa with argv, and require `__daemon`. Alternatively, have the daemon record a random instance nonce in `daemon.json` and check it.

## Info

### IN-01: Atomic writers use flag `w` on a predictable temp name

**File:** `src/core/approvals/trust-store.ts:168-173`, `src/core/approvals/integrity.ts:266-278`, `src/doctor/run.ts:249-258`
**Issue:** `${file}.${pid}.tmp` is opened with `w`, which follows a symlink planted at that name. `accepted-risks.ts:139-143` already uses `rmSync` + `wx`. The trust and hosts dirs are 0700 and denied to agents, so this is hardening only.
**Fix:** Use the accepted-risks pattern, `rmSync(tmp, {force:true}); writeFileSync(tmp, ..., {flag: 'wx', mode: 0o600})`, in all three writers.

### IN-02: `readDoctorReport` opens without O_NONBLOCK

**File:** `src/server/routes/trust.ts:51`
**Issue:** Every other safe reader passes `O_NONBLOCK` so that a FIFO planted at the path cannot hang the process. This one runs in the daemon's request path.
**Fix:** `openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)`.

### IN-03: The one-time sign-in code briefly appears in a process argv

**File:** `src/cli/main.ts:255-266`
**Issue:** `open <url>` and `xdg-open <url>` put the code in argv, where `ps` shows it to any process of the same user while the opener runs. The code is single-use and the browser normally redeems it first. A polling local process could still race it for a console session.
**Fix:** Accept the risk with a comment, or open a non-secret URL that triggers a code exchange over the control socket. Also resolve `xdg-open` by absolute path, as `/usr/bin/open` already is.

### IN-04: `init` does not tighten an existing home to 0700

**File:** `src/cli/main.ts:319-345`
**Issue:** When the home already exists (for example created by hand at 0755), `init` reports it ready without the `chmodSync(home, 0o700)` the create path applies. Files are still created 0600 under the daemon's umask, but directory listings stay readable to other users.
**Fix:** Call `chmodSync(home, 0o700)` in the existing-directory branch too, or warn when `mode & 0o077`.

### IN-05: `fileEditGrants` is test-only code in a production module

**File:** `src/core/security/sandbox-settings.ts:271-305`
**Issue:** `fileEditGrants`, `FILE_EDIT_TOOLS` and `isPlainRoot` are referenced only by `tests/core/security/sandbox-settings.test.ts`. No doctor or probe path evaluates grants with them, so its fail-closed parsing protects nothing at runtime.
**Fix:** Either use it in the probe or doctor, to fail when the launch profile grants edits outside the workdir, or move it into the test helpers.

---

_Reviewed: 2026-11-10T20:32:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
