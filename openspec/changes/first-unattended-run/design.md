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

It has since been fixed: the launch profile grants edits only inside the working folder, adds the outside-write block, and has its own probe row. It stays relevant here because the builder needs a wider grant than the probe. That grant covers the worktree, plus the git objects, its own branch ref and its own `worktrees/<name>` entry in the common dir. The grant must:
- keep the outside-folder block;
- keep the shared `config`, `hooks` and `info` denies;
- get its own doctor row before the first run.

### Build lane (to detail before implementation)

- **Unit of work.** One OpenSpec change = one feature = one branch, worktree and PR. Its tasks are internal steps. Worktrees are siblings outside the repository, locked while a run holds them.
- **Budget.** The orchestrator enforces the budget from per-message usage and the model's reported context window. A model-obeyed hook is not enough. The handoff is a file committed in the worktree.
- **Gates.** Process groups, `CI=1`, no TTY, exit code only. The test lock is a SQLite exclusive lock on a well-known file, shared with the owner's existing tooling.
- **Planning writes.** One queue in the daemon. Builds never write the host's planning files directly. Task ticks and archiving a merged change go through the queue (task ticks do not invalidate approvals; see `signed-approvals`).

### Built for Cena, kept open for self-hosting

The first target is Cena. Later, the owner will develop Counterpoint itself through Counterpoint, so this change must not close that door. Self-hosting is not built here (see `docs/backlog.md`). Three things in this change keep it possible:
- **The running code is never the code being built.** The daemon and every guard it enforces (sandbox profile, approval verification, doctor) run from an installed copy outside every host repository and worktree. Nothing in a run reads or executes code from a build worktree or the owner's checkout. A build changes Counterpoint only after the owner merges and reinstalls.
- **Protected paths are per host.** Besides tests, gate configs and baselines, the host config can list its own protected paths, read at the approved base. On Counterpoint these will be the trust code: `src/core/security`, `src/core/approvals`, `src/doctor`, `src/agent`.
- **Nothing Cena-specific in core.** Gate commands, escape hatches, preview commands and ports all come from the host config. Cena's needs (Supabase, Docker) are answered per gate, never as built-in behaviour.

## Risks / Trade-offs

- **Context window.** The denominator on 1M-window models is unverified. Spike it before the budget logic.
- **Usage limits.** The `rate_limit_event` shape and the unit of its reset time are unverified. Spike them before the limit handling.
- **Process groups.** Process-group kill on macOS needs a test that leaves no orphaned dev servers.
- **Gate escape hatches.** Gate commands that need Supabase or Docker may need sandbox escape hatches. Decide per gate, never globally.
- **Claude Code version.** The probe matcher is pinned to one Claude Code version (2.1.321; the owner's verifying run was on 2.1.322). An update that changes refusal texts turns rows Not checked, so doctor fails and every run is refused. Plan a quick refreeze path before unattended runs depend on a passing doctor.
- **Setting sources.** Confirm the host's `.claude` commands, agents and skills still load under user-only setting sources.
