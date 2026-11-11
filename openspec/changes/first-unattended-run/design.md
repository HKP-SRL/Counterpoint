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

### Research spike results (2026-11-11, claude 2.1.322, macOS)

**3.1 Context window.** The reported window is in the final `result` event only: `modelUsage[model].contextWindow` (1,000,000 for `claude-haiku-5-5`). The `system/init` event names the model but no window. Context fill per request is the latest assistant message's `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; one message id repeats across its content blocks, so de-duplicate by id. Consequence: the first session of a model cannot know its denominator in advance. The orchestrator learns the window per (model, claude version) from any finished session's `result` and stores it; before one is known, a short calibration session (one turn, no tools) provides it. No window size is ever hard-coded.

**3.2 Usage limits.** Every session emits one `rate_limit_event` right after its first API call: `rate_limit_info` with `status` (`allowed`, `allowed_warning`; `rejected` is documented, not yet seen), `rateLimitType` (`five_hour`, `seven_day`), `utilization` (0 to 1), `resetsAt` in **Unix seconds**, and `unifiedWindows` with both windows' utilization, reset and status. So the governor can pace before a hard stop, not only react to one. `system/api_retry` (attempt, delay, error status) and the error result subtypes are documented but were not observed; they get fixtures from the docs and a live check when one occurs.

**3.3 Process-group kill.** Spawning a gate `detached` (own process group) and killing the group (`SIGTERM`, then `SIGKILL`) removed a backgrounded dev server and the test runner with no orphans. A child that starts its own process group (a detached spawn, as some dev tools do) survives and is reparented to launchd. Backstop: every gate run gets a random `CP_GATE_RUN=<id>` environment variable, inherited by descendants, and after the group kill the runner sweeps the owner's processes with `ps -Eww` for that exact tag. A process that scrubs its own environment can still escape; the runner records survivors in the gate result.

**3.4 Cena gates.** Cena's `master` has no `.counterpoint/config.yaml` yet and no `test` script. Its suite (Vitest) needs the local Supabase stack (Docker; API 54321, DB 54322), `.env.local` written by `supabase start` (gitignored, so absent in a worktree), and serial runs against one shared database. Sandboxed agent shells cannot connect to localhost at all (the console at 127.0.0.1:4170 refused too), so the builder cannot run these tests itself; they run only as gates, and the builder gets their output. Gate commands execute builder-written code, so they must not run with the owner's full rights. The narrowest split: the gate runner starts and resets the Supabase stack itself (fixed commands from the approved config; Docker access stays outside any agent-written code), then runs the test command in a sandbox that may reach only the configured localhost ports, writes only the worktree and a temp dir, and reads nothing protected. `.env.local` is generated per worktree from `supabase status`. The shared test lock serializes these gates machine-wide.

**3.5 Host `.claude` content.** With `--setting-sources user`, the host's project skills, commands, agents and `CLAUDE.md` are **not** loaded (checked from the init event and the reply). With `user,project` they all load, together with the repo's `.claude/settings.json` (permissions and hooks). Cena's builder needs its `CLAUDE.md`/`AGENTS.md` and its OpenSpec skills. Decision needed, see "Open decisions".

**3.6 Builder git access.** When a session's working folder is a linked worktree, Claude Code's sandbox lets it write the main repository's whole shared `.git`, except `hooks/` and `config` (docs, "Filesystem isolation"; confirmed live: from a worktree, a sandboxed shell moved `main` and wrote a `refs/replace/` ref). A `denyWrite` beats a narrower `allowWrite` (denying `refs` while allowing the builder's own branch folder refused the builder's own commit too), so a narrow grant cannot be expressed. The current profile's `Edit` deny on the whole git dir becomes an OS write-deny, so today a builder in a worktree can write no git state at all (`index.lock` refused). Decision: **builders never write git state.** The orchestrator, outside the sandbox, commits each session's work with its hardened git runner (and pushes). The doctor probe gains a row run from a linked worktree, proving a sandboxed shell there cannot move a ref.

### Owner decisions on the spikes (2026-11-11)

- **Builder sessions load the host's project setting source** (`--setting-sources user,project`), so the host's `CLAUDE.md`/`AGENTS.md`, skills, commands and agents load exactly as when the owner works there. Doctor judges the host's committed `.claude/settings.json` like the user file (no isolation widening), and its `hooks` are part of the host's integrity baseline, shown by `counterpoint trust`. The builder cannot change `.claude/` in its worktree (deny rule, also an OS write-deny).
- **Gates run under Claude Code's sandbox runtime** (`@anthropic-ai/sandbox-runtime`, `srt`, Apache-2.0, exact-pinned). Its `network.allowedDomains` accepts an IP literal with a port (`127.0.0.1:54321`), routed through its proxy, which is exactly what Cena's HTTP-only test traffic needs. Node clients use the proxy with `NODE_USE_ENV_PROXY=1`.

### Build lane

**Shape.** One run at a time per machine, one change at a time within it (parallel builds are a later change). A run is a queue of runway changes in runway order (dependencies first). The orchestrator lives in the daemon; the CLI only asks it to start, stop and report, over the control socket, whose token agents cannot read.

**State.** New SQLite tables (one migration): `runs` (host, settings, state, stop time, started/ended, end reason), `run_changes` (run, change, order, state `queued | building | green | parked | skipped | stopped`, approval commit, base commit, branch, worktree, attempts, PR URL, preview URL, flags), `agent_sessions` (run change, number, kind `builder | calibration`, model, started/ended, end reason, peak context tokens, usage), `gate_results` (run change, attempt, gate, verdict, reason, exit code, duration, log path, tail), `model_windows` (model, claude version, window, learned at) and `governor` (paused until, reason, last utilization per window). Logs, raw streams, handoffs and reports are files under `hosts/<id>/runs/<run>/`. Events go to the existing `events` outbox, so the console can follow a run later.

**Starting a run.** From the console (the owner's main surface): a Run panel on the host's Mission page picks runway changes (all by default), the stop time, the model and the budget, shows the budget as tokens from the learned window ("40% of 1M = 400k tokens") and has Start; while a run is going it shows each change's state, the current session and the run's end reason, and has Stop. Both are guarded `POST`s (session cookie plus Origin check), the same credential as everything else in the console; sandboxed agents cannot reach the console at all (spike 3.4). The CLI offers the same through the control socket: `counterpoint run <host> [--changes a,b] --until HH:MM --model <m> --budget <percent>`, `run stop`, `run status`. Either way the daemon refuses unless the last doctor verdict passes (accepted risks only) and every chosen change verifies at that moment; when the model's window is not known yet, a calibration session (one turn, no tools) learns it first. Stop ends the run at the next clean point.

**Console-first owner actions.** The owner works from the console. Besides the Run panel, this change adds Run doctor (Trust page: guarded POST, progress over SSE, the stored report replaced when done, at most one probe at a time), withdraw an accepted risk (Trust page) and Stop Counterpoint (stops a run at its next clean point first). Terminal-only by design: starting the daemon and the sign-in link (the console is served by the daemon), signing approvals (passphrase never cached), pinning the approval key, accepting an integrity baseline, and accepting a risk; a stolen console session must never be able to do these.

**Per change.**
1. Verify the approval again (only runway changes build). Note its signed base commit.
2. Create the worktree: branch `cp/<change>` from that commit, at `<repo>-worktrees/<change>` (outside the repository), `git worktree lock` while the run holds it. All git calls use the hardened runner.
3. Run builder sessions until the change is done (see below), then the gates. A failing gate's last lines go into the next session's prompt; after N failed attempts (host config, default 3) the change parks in Needs You and the run moves on.
4. When every gate passes: run the protected-path check, push the branch, open the PR, attach the preview link, mark the change green.

**Builder sessions.** Launched with the one agent profile (`buildAgentSandboxSettings`, workdir = the worktree, git dir = the host's common dir, so the whole git dir stays write-denied), auto mode, `--setting-sources user,project`, through the governor. The prompt names the change, tells the builder to work through `tasks.md` with the host's own apply workflow, and passes the previous handoff and any failing gate output. Builders write no git state; after every session the orchestrator commits the worktree's changes as one commit (`cp: <change> session <n>`), after:
- moving the builder's `.cp-handoff.md` and `.cp-assumptions.md` out of the worktree into the run folder (never committed);
- restoring the change's `tasks.md` and any other planning file the session touched, recording task ticks in SQLite instead (builds never write planning files; ticks reach the host later through the planning-write path).

**Context budget.** The CLI runner gains a streaming mode (`--input-format stream-json`): the orchestrator reads per-message usage as it arrives and computes fill against the learned window. At the budget it sends one user message ("finish the current task, write `.cp-handoff.md`, stop"); at the budget plus a margin (default 15 points of the window) it ends the session itself and writes a minimal handoff from the diff and the task list. A first implementation task proves the streaming input on claude 2.1.322 before the rest builds on it.

**Governor.** One in-daemon gate in front of every agent spawn, across hosts. It reads every session's `rate_limit_event` and error results:
- `rejected`, or a usage-limit error: pause all lanes until `resetsAt` + 2 minutes (persisted, so a restart keeps the pause).
- `allowed_warning` with high utilization: let running sessions finish; start new ones only while utilization stays under a configured ceiling.
- transient API errors: exponential backoff, then retry the session.
- authentication, credit or spend-limit errors: stop the run, put the error in Needs You.

**Gates.** Defined in the host's `.counterpoint/config.yaml` at the approved base: each gate has a name, a command, a timeout, whether it needs the shared test lock, the localhost ports it may reach, and optionally a test-count pattern for the zero-test guard. Host services (Cena: `supabase start`, `supabase db reset`, the env from `supabase status -o env`) are fixed commands the gate runner runs itself, outside any sandbox, before a gate that needs them; they come from the approved config, never from the worktree. Each gate command runs:
- under `srt`: writes only the worktree and a temp dir, reads nothing protected (the agent profile's read denies), network only to its listed ports;
- detached in its own process group with `CI=1`, no TTY and `CP_GATE_RUN=<id>`; on timeout or stop the group is killed and the owner's processes are swept for that tag;
- with output streamed to `gates/<attempt>/<gate>.log` and the last lines stored with the result. Exit code 0 is the only pass.

**Protected paths.** Diff of the branch against its base: edits to existing test files, the gate config, visual baselines, planning files and the host-listed protected paths are flagged on the change, in the PR body and in the run report. Planning-file edits also keep the PR from being offered for merge.

**Pull requests.** The branch is pushed by a push helper that, for that one call, lets git use the owner's own credentials (`gh` as credential helper, or the SSH agent for SSH remotes); every other git call keeps the clean environment. `gh pr create` opens the PR with a body generated from the change (title, why, task list with ticks), the assumed decisions, the protected-path flags and a gate summary. Preview: the host's own deploy when its PR gets one (read with `gh pr view --json statusCheckRollup`); otherwise the host config's preview command, run under `srt` from the worktree on a free loopback port (from 4174 up).

**Planning writes.** One serialized queue in the daemon that commits one planning write at a time to the host (never into the owner's checkout). This change needs it only for its own bookkeeping path and the PR flag; task ticks and archiving use it from `morning-review-signed-merge`.

**Crash recovery.** At daemon start, any run left `running` is reconciled: process groups and tagged processes from its gates and sessions are killed (pids and tags are stored), a session cut off mid-way gets its worktree changes committed as `cp: <change> session <n> (interrupted)`, and the run resumes from the last handoff unless its stop time has passed.

**Run report.** When a run ends for any reason, a report goes to `runs/<run>/report.md` and the store: merge-ready PRs with preview links, parked changes with their last failing gate, items waiting on the owner, assumed decisions, flags, and why the run ended. `counterpoint run report` prints the latest one.

**Doctor additions.** Three new rows before the first run:
- **Worktree git access:** the treatment session runs in a temporary linked worktree of the host (removed afterwards) and tries to create a probe ref; it must be refused, and the control (a mirror repo with its own worktree) must succeed.
- **Project settings:** the host's committed `.claude/settings.json` joins the isolation check as a source.
- **Gate sandbox:** a probe command under the gate profile must fail to read a protected canary, write outside its folder or reach the console port, and must reach a probe listener on an allowed port.

### Owner steps for the first run

- Review and commit Cena's `.counterpoint/config.yaml` (Counterpoint drafts it: the gates, the Supabase service and the ports).
- Approve one real Cena change for the first overnight run (task 4.3).

### Built for Cena, kept open for self-hosting

The first target is Cena. Later, the owner will develop Counterpoint itself through Counterpoint, so this change must not close that door. Self-hosting is not built here (see `docs/backlog.md`). Three things in this change keep it possible:
- **The running code is never the code being built.** The daemon and every guard it enforces (sandbox profile, approval verification, doctor) run from an installed copy outside every host repository and worktree. Nothing in a run reads or executes code from a build worktree or the owner's checkout. A build changes Counterpoint only after the owner merges and reinstalls.
- **Protected paths are per host.** Besides tests, gate configs and baselines, the host config can list its own protected paths, read at the approved base. On Counterpoint these will be the trust code: `src/core/security`, `src/core/approvals`, `src/doctor`, `src/agent`.
- **Nothing Cena-specific in core.** Gate commands, escape hatches, preview commands and ports all come from the host config. Cena's needs (Supabase, Docker) are answered per gate, never as built-in behaviour.

## Risks / Trade-offs

- **Usage-limit rejection unseen.** The `rejected` status, `api_retry` and the error subtypes are documented but not yet observed live; handle them from the docs and add a fixture when one occurs.
- **Escaping gate children.** A gate child that starts its own process group and scrubs its environment survives the gate kill; it is recorded, not prevented.
- **Claude Code version.** The probe matcher is pinned to one Claude Code version (2.1.322 since the CR-01 refreeze). An update that changes refusal texts turns rows Not checked, so doctor fails and every run is refused. Plan a quick refreeze path before unattended runs depend on a passing doctor.
