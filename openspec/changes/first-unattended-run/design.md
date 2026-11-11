# Design: First Unattended Run

## Context

See proposal.md for the motivation. The trust layer from `trusted-shell-signed-runway` is in place, but it shipped with its code review open. The owner decided that the trust fixes come before any unattended builder runs, because a builder is the first agent with a write grant into the host's git directory. Owner settings were checked read-only on 2026-11-10: `~/.claude/settings.json` sets none of the CR-01 keys, and there is no managed settings file. So the gap is real but not exploited on this machine today.

This document covers that first work in detail. The build-lane design is still to be written before implementation, after the research spikes listed at the end.

## Goals / Non-Goals

**Goals:**
- Close CR-01, WR-02, WR-04, WR-05 and WR-06, and verify WR-01, before the first unattended run.
- Prove one real overnight run on a Cena change, from the CLI, ending in a green PR with a preview link or a parked change with its reason.

**Non-Goals:**
- Console run controls, parallel builds, rebase on conflict, merge approval (`morning-review-signed-merge`).
- The council's share of the quota governor (`council-cards-decisions`). Here the governor only pauses every lane on a usage limit.

## Decisions

### Review findings carried from the trusted-shell review

**Must close before any unattended run:**

- **CR-01 (critical): doctor can pass while sandboxed Bash writes outside the working folder.**
  - Agent sessions load user settings, and Claude Code merges filesystem arrays across scopes. A user or managed `sandbox.filesystem.allowWrite` therefore widens where every agent Bash command may write.
  - The same applies to `allowRead`, `permissions.additionalDirectories` (which the outside-write block then honours for Write and Edit), and `sandbox.network.allowUnixSockets` / `allowAllUnixSockets`.
  - The isolation check judges none of these. The outside-folder probe row only uses the Write and Edit tools.
  - Fix:
    - Add these keys to the isolation rules, failing in any non-launch source.
    - Exempt the launch source only where it equals the builder's own grant.
    - Add a Bash `touch` of a nonce file outside the working folder to the outside row, in both treatment and control.
    - Extend the leftovers check and cleanup to that file.
- **WR-02: `trust-key` trusts whatever key file is there at write time.**
  - The command reads the public key without following symlinks and prints its fingerprint. After the owner confirms, it re-reads the path, following symlinks, and pins whatever key it finds.
  - Fix:
    - Pass the confirmed fingerprint, or the exact bytes, into the write step.
    - Refuse on a mismatch.
    - Open the file without following symlinks there too.
- **WR-04: the input reader follows replace refs, while the verifier refuses them.**
  - Signature verification passes `--no-replace-objects`, `GIT_NO_REPLACE_OBJECTS=1` and `GIT_GRAFT_FILE=/dev/null`. The reader behind every input digest does not.
  - Once the builder's grant reaches the common git dir, an agent could map an edited blob back to the signed one. The approval would still match, while the pushed branch carries unsigned content.
  - Fix: put both on one hardened git helper.
- **WR-05: gaps in the integrity baseline.**
  - Missing keys:
    - `diff.external`
    - `pager.*`
    - `sequence.editor`
    - `submodule.*.update`
    - `difftool.*.cmd` and `mergetool.*.cmd`
    - `core.alternateRefsCommand`
    - `http.proxy`, `http.*.proxy` and `remote.*.proxy`
  - Only the common-dir `config.worktree` is snapshotted. Each `worktrees/<id>/config.worktree` is not.
  - `include.path` and `includeIf.*.path` record the key but not the target file's content.
  - Fix:
    - Add the missing keys.
    - Snapshot every worktree config.
    - Record a digest of each include target, resolving relative paths as git does.
- **WR-06: the uncommitted-edits hint runs `git status` in the owner's checkout without the filter guard.**
  - `git status` re-hashes stat-dirty entries through any configured `clean` filter. That runs a program from `.git/config` automatically, in the daemon, with no integrity check first.
  - The commit path already refuses filtered paths.
  - Fix: either check the filter attribute for each covered path first and report those paths as not checkable, or compare working-tree bytes directly without `git status`.
- **WR-01 (verify, don't assume): replacement 1 for the scrub may be inert.**
  - The profile allow-lists a bare `Bash`. Every Bash command is then accepted by rule, so `autoAllowBashIfSandboxed: false` changes nothing and the classifier never sees a Bash command.
  - Run one live check in auto mode. Then either drop bare `Bash` from the allowed tools, so unlisted commands go to the classifier as the owner decided, or correct the code comments and `docs/decisions.md` to say replacement 1 has no effect while `Bash` is allow-listed.

**Backlog (fix during this change if cheap, otherwise keep in `docs/backlog.md`):**

- **WR-03: the old adapter resolved ambiguous work-unit folders and roadmap sections by first match.**
  - The OpenSpec adapter makes this moot: one change is one uniquely named folder, and the approval covers every file in it.
  - Confirm the new adapter has no equivalent ambiguity, for example the same name both active and archived, or two archive folders for one name. Ambiguity must fail closed (the change shows as unreadable).
- **WR-07: the runway cache keeps transient verification errors.**
  - A transient failure (a timeout, mapped to invalid with reason `error`) stays cached until the base tip moves.
  - Fix: do not keep results that contain `error` reasons, in both the runway and the Needs You caches.
- **WR-08: `stop` can signal an unrelated process from a stale `daemon.json`.**
  - Fix: remove the run record right after taking the lock at boot.
  - In the pid fallback, check the process command line (or an instance nonce) before signalling.
- **IN-01:** atomic writers use flag `w` on a predictable temp name. Use the remove-then-`wx` pattern, as the accepted-risks store already does.
- **IN-02:** the doctor-report reader opens the file without `O_NONBLOCK`, so a planted FIFO could hang the daemon.
- **IN-03:** the one-time sign-in code briefly appears in the argv of `open` / `xdg-open`.
  - Either accept the risk with a comment, or open a non-secret URL that exchanges the code over the control socket.
  - Resolve `xdg-open` by absolute path.
- **IN-04:** `init` does not tighten an existing home to 0700. Either tighten it or warn.
- **IN-05:** the file-edit grant parser is test-only code in a production module. Either use it in doctor to fail grants outside the working folder, or move it to the test helpers.

### Deferred item from the trusted-shell build: agent file tools writing outside the session folder

This was found while building the probe evaluator. `allowWrite: []` confines only Bash, so the Write and Edit tools could change any user-writable file. That included `~/.claude/settings.json`, which every later session loads.

It has since been fixed: the launch profile grants edits only inside the working folder, adds the outside-write block, and has its own probe row. The plan was to give the builder a narrow extra grant into the git common dir (objects, its own branch ref, its own worktree entry). Spike 3.6 showed that grant cannot be expressed; see "Research spike results" below.

### Build lane (to detail before implementation)

- **Unit of work.** One OpenSpec change = one feature = one branch, worktree and PR. Its tasks are internal steps. Worktrees are siblings outside the repository, locked while a run holds them.
- **Budget.** The orchestrator enforces the budget from per-message usage and the model's reported context window. A model-obeyed hook is not enough. The handoff is a file committed in the worktree.
- **Gates.** Process groups, `CI=1`, no TTY, exit code only. The test lock is a SQLite exclusive lock on a well-known file, shared with the owner's existing tooling.
- **Planning writes.** One queue in the daemon. Builds never write the host's planning files directly. Task ticks and archiving a merged change go through the queue (task ticks do not invalidate approvals; see `signed-approvals`).

### Research spike results (2026-11-11, claude 2.1.322, macOS)

**3.1 Context window.** The reported window is in the final `result` event only: `modelUsage[model].contextWindow` (1,000,000 for `claude-haiku-5-5`). The `system/init` event names the model but no window. Context fill per request is the latest assistant message's `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; one message id repeats across its content blocks, so de-duplicate by id. Consequence: the first session of a model cannot know its denominator in advance. The orchestrator learns the window per (model, claude version) from any finished session's `result` and stores it; before one is known, a short calibration session (one turn, no tools) provides it. No window size is ever hard-coded.

**3.2 Usage limits.** Every session emits one `rate_limit_event` right after its first API call: `rate_limit_info` with `status` (`allowed`, `allowed_warning`; `rejected` is documented, not yet seen), `rateLimitType` (`five_hour`, `seven_day`), `utilization` (0 to 1), `resetsAt` in **Unix seconds**, and `unifiedWindows` with both windows' utilization, reset and status. So the governor can pace before a hard stop, not only react to one. `system/api_retry` (attempt, delay, error status) and the error result subtypes are documented but were not observed; they get fixtures from the docs and a live check when one occurs.

**3.3 Process-group kill.** Spawning a gate `detached` (own process group) and killing the group (`SIGTERM`, then `SIGKILL`) removed a backgrounded dev server and the test runner with no orphans. A child that starts its own process group (a detached spawn, as some dev tools do) survives and is reparented to launchd. Backstop: every gate run gets a random `CP_GATE_RUN=<id>` environment variable, inherited by descendants, and after the group kill the runner sweeps the owner's processes with `ps -Eww` for that exact tag. A process that scrubs its own environment can still escape; the runner records survivors in the gate result.

**3.4 Cena gates.** Cena's `master` has no `.counterpoint/config.yaml` yet and no `test` script. Its suite (Vitest) needs the local Supabase stack (Docker; API 54321, DB 54322), `.env.local` written by `supabase start` (gitignored, so absent in a worktree), and serial runs against one shared database. Sandboxed agent shells cannot connect to localhost at all (the console at 127.0.0.1:4170 refused too), so the builder cannot run these tests itself; they run only as gates, and the builder gets their output. Gate commands execute builder-written code, so they must not run with the owner's full rights. The narrowest split: the gate runner starts and resets the Supabase stack itself (fixed commands from the approved config; Docker access stays outside any agent-written code), then runs the test command in a sandbox that may reach only the configured localhost ports, writes only the worktree and a temp dir, and reads nothing protected. `.env.local` is generated per worktree from `supabase status`. The shared test lock serializes these gates machine-wide.

**3.5 Host `.claude` content.** With `--setting-sources user`, the host's project skills, commands, agents and `CLAUDE.md` are **not** loaded (checked from the init event and the reply). With `user,project` they all load, together with the repo's `.claude/settings.json` (permissions and hooks). Cena's builder needs its `CLAUDE.md`/`AGENTS.md` and its OpenSpec skills. Decision needed, see "Open decisions".

**3.6 Builder git access.** When a session's working folder is a linked worktree, Claude Code's sandbox lets it write the main repository's whole shared `.git`, except `hooks/` and `config` (docs, "Filesystem isolation"; confirmed live: from a worktree, a sandboxed shell moved `main` and wrote a `refs/replace/` ref). A `denyWrite` beats a narrower `allowWrite` (denying `refs` while allowing the builder's own branch folder refused the builder's own commit too), so a narrow grant cannot be expressed. The current profile's `Edit` deny on the whole git dir becomes an OS write-deny, so today a builder in a worktree can write no git state at all (`index.lock` refused). Decision: **builders never write git state.** The orchestrator, outside the sandbox, commits each session's work with its hardened git runner (and pushes). The doctor probe gains a row run from a linked worktree, proving a sandboxed shell there cannot move a ref.

### Open decisions (before detailing the build lane)

- **Host instructions and skills (3.5).** Either load the `project` setting source (doctor then also judges the host's committed `.claude/settings.json` at the approved base, with no hooks allowed), or keep `user` only and have Counterpoint pass the host's `CLAUDE.md`/`AGENTS.md` and skills to the session itself.
- **Gate sandbox mechanism (3.4).** Which tool confines gate commands (for example the sandbox runtime Claude Code itself uses, or a Counterpoint-written Seatbelt profile), and how a gate names the localhost ports it may reach.

### Built for Cena, kept open for self-hosting

The first target is Cena. Later, the owner will develop Counterpoint itself through Counterpoint, so this change must not close that door. Self-hosting is not built here (see `docs/backlog.md`). Three things in this change keep it possible:
- **The running code is never the code being built.** The daemon and every guard it enforces (sandbox profile, approval verification, doctor) run from an installed copy outside every host repository and worktree. Nothing in a run reads or executes code from a build worktree or the owner's checkout. A build changes Counterpoint only after the owner merges and reinstalls.
- **Protected paths are per host.** Besides tests, gate configs and baselines, the host config can list its own protected paths, read at the approved base. On Counterpoint these will be the trust code: `src/core/security`, `src/core/approvals`, `src/doctor`, `src/agent`.
- **Nothing Cena-specific in core.** Gate commands, escape hatches, preview commands and ports all come from the host config. Cena's needs (Supabase, Docker) are answered per gate, never as built-in behaviour.

## Risks / Trade-offs

- **Usage-limit rejection unseen.** The `rejected` status, `api_retry` and the error subtypes are documented but not yet observed live; handle them from the docs and add a fixture when one occurs.
- **Escaping gate children.** A gate child that starts its own process group and scrubs its environment survives the gate kill; it is recorded, not prevented.
- **Claude Code version.** The probe matcher is pinned to one Claude Code version (2.1.322 since the CR-01 refreeze). An update that changes refusal texts turns rows Not checked, so doctor fails and every run is refused. Plan a quick refreeze path before unattended runs depend on a passing doctor.
