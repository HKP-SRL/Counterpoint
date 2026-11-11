# Tasks

The first two groups come from the trusted-shell review and must be done before any unattended builder runs. Groups 5 to 12 build the lane designed in design.md from the spikes in group 3.

## 1. Trust fixes before any unattended run

- [x] 1.1 CR-01: judge user/managed `sandbox.filesystem.allowWrite` and `allowRead`, `permissions.additionalDirectories` and unix-socket allowances in the isolation check (launch source exempt only for the builder's own grant)
- [x] 1.2 CR-01: add a Bash outside-write step to the files-outside-the-working-folder probe row (treatment and control), with leftovers check and cleanup; refreeze fixtures
- [x] 1.3 WR-02: `trust-key` pins exactly the confirmed key bytes, opens without following symlinks, refuses on mismatch
- [x] 1.4 WR-04: one hardened git helper for the input reader and the verifier (no replace objects, no grafts)
- [x] 1.5 WR-05: add the missing execution-capable keys, snapshot every worktree config, digest include targets
- [x] 1.6 WR-06: the uncommitted-edits hint runs no repository filter (filter check first, or direct byte comparison)
- [x] 1.7 WR-01: verify live whether `autoAllowBashIfSandboxed: false` has any effect with bare `Bash` allow-listed; drop bare `Bash` or correct the record in code and `docs/decisions.md`
- [x] 1.8 Live doctor proof on the owner's machine after 1.1 to 1.7

## 2. Review backlog

- [x] 2.1 WR-03: confirm the OpenSpec adapter fails closed on ambiguous change names (active and archived, or two archive folders)
- [x] 2.2 WR-07: never cache runway or Needs You results that contain transient `error` verdicts
- [x] 2.3 WR-08: clear the run record at daemon start; confirm the process before any pid-based stop
- [x] 2.4 IN-01: remove-then-exclusive-create for every atomic writer
- [x] 2.5 IN-02: open the stored doctor report with `O_NONBLOCK`
- [x] 2.6 IN-03: decide on the sign-in code in the opener's argv; resolve `xdg-open` by absolute path
- [x] 2.7 IN-04: tighten or warn about an existing home that is not 0700
- [x] 2.8 IN-05: use the file-edit grant parser in doctor or move it to test helpers

## 3. Research spikes

- [x] 3.1 Context-window denominator on a 1M-window model, from live usage and the reported window
- [x] 3.2 `rate_limit_event` shape and reset-time unit; API retry and error result subtypes
- [x] 3.3 Process-group kill on macOS for gates that start dev servers
- [x] 3.4 Which Cena gate commands need sandbox escape hatches (Supabase, Docker) and how narrow they can be
- [x] 3.5 Host `.claude` commands, agents and skills under user-only setting sources
- [x] 3.6 Builder write grant into the common git dir (objects, own branch ref, own worktree entry) and its doctor row

## 4. Build lane

- [x] 4.1 Design the build lane in this file's design.md from the spike results
- [x] 4.2 Detail the build-lane tasks here (worktrees, sessions and handoff, governor, gates, PRs, planning-write queue, crash recovery, run report)
- [x] 4.3 Owner: approve a real Cena change for the first overnight run

## 5. Foundations

- [x] 5.1 Spike: streaming input on claude 2.1.322 (`--input-format stream-json`): send a user message mid-session and read usage live; record the result in design.md
- [x] 5.2 Store migration: `runs`, `run_changes`, `agent_sessions`, `gate_results`, `model_windows`, `governor`
- [x] 5.3 Host config schema: gates (command, timeout, test lock, ports, test-count pattern), services, attempts, preview command, protected paths; read at the approved base
- [x] 5.4 Streaming mode for the CLI runner: live events, live context fill (de-duplicated by message id), send-message, end-session, process tag
- [x] 5.5 Model windows: learn from every `result`, calibration session when unknown, budget shown as tokens

## 6. Governor

- [x] 6.1 One governor in front of every agent spawn (probe, calibration, builder), across hosts
- [x] 6.2 Pause on `rejected` or a usage-limit error until reset + 2 minutes, persisted across restarts; pace new sessions on `allowed_warning`
- [x] 6.3 Backoff for transient API errors; stop the run on authentication, credit and spend-limit errors, with a Needs You item
- [x] 6.4 Refuse every spawn while the last doctor verdict does not pass

## 7. Doctor rows for the build lane

- [x] 7.1 Builder profile: `--setting-sources user,project`; the host's committed `.claude/settings.json` joins the isolation check; its hooks join the integrity baseline
- [x] 7.2 Worktree git-access probe row (treatment in a temporary linked worktree of the host must not create a ref; control in a mirror worktree must)
- [x] 7.3 Gate-sandbox probe row (`srt` profile: protected read, outside write and console port refused; allowed port reached)
- [x] 7.4 Live doctor proof on the owner's machine with the three new rows
- [x] 7.5 Judge probe refusals by protocol fields and outcomes, never claude's wording; drop the version-distrust rule; live doctor proof again
- [x] 7.6 The integrity baseline pins the whole committed `.claude/` folder (skills, agents, commands, CLAUDE.md), at the base tip and again at each build's base commit

## 8. Worktrees and builder sessions

- [x] 8.1 Worktree manager: `cp/<change>` from the approved base commit, `<repo>-worktrees/<change>`, lock while held, hardened git only
- [x] 8.2 Builder prompt: change, apply workflow, previous handoff, failing gate output
- [x] 8.3 Orchestrator commit after each session: collect handoff and assumptions out of the worktree, restore planning files, record task ticks
- [x] 8.4 Budget handoff: wrap-up message at the budget, forced end at budget plus margin with a generated handoff
- [x] 8.5 Dependencies in new worktrees: the host config's `worktree.clone` folders (e.g. `node_modules`) are copied from the owner's checkout as copy-on-write clones; git-ignored only, no link may lead outside the clone
- [x] 8.6 A change is built only when its task list is done (seen live on Cena: a session stopped on purpose before a task group it could not do, and the change went through the gates and out as a ready-to-merge PR with 19 of its 32 build tasks open). The session commit reports the build tasks left open; a session that ends by itself with work left gets a fresh successor; the builder skips what its sandbox cannot do, names it in `.cp-blocked.md` and goes on; the change parks, with no gates and no PR, when only blocked work is left, when a session makes no progress, or when the attempt's sessions are used up. The prompt names the host's gates and the services they get, so a check those gates make (Cena's full suite against the local stack) never blocks a task

## 9. Gates

- [x] 9.1 Gate runner under `srt`: worktree and temp writes only, protected reads denied, listed ports only, `NODE_USE_ENV_PROXY=1`
- [x] 9.2 Process groups, `CP_GATE_RUN` tag sweep, timeouts, exit-code verdicts with distinct reasons, logs and tails
- [x] 9.3 Host services before gates (start, reset, env), outside the sandbox, from the approved config only
- [x] 9.4 Shared test lock (the owner's existing lock file), zero-test guard, bounded retries with feedback, parking
- [x] 9.5 Protected-path check on the branch diff (tests, gate config, baselines, planning files, host-listed paths)
- [x] 9.6 Machine problems never cost builder attempts: service programs checked runnable before a change builds (the run stops and says how to fix it), a service program that cannot start parks at once; the daemon inherits the whole agent environment allow-list (a daemon without USER left every session logged out)
- [x] 9.7 A gate reads back its own temp dir (it sits inside the read-denied Counterpoint home; Vitest's `forks` pool failed with EPERM) and still binds no port: local binding would let gate code connect to every loopback port, the console's included (checked live), so a Turbopack host builds its gate with `next build --webpack`

## 10. Runs

- [x] 10.1 Run endpoints in the daemon: start, stop, status; refuse without a passing doctor or a verifying approval
- [x] 10.2 Orchestrator loop: runway order, re-verify before each change, stop time, stop at a clean point
- [x] 10.3 Crash recovery at daemon start: kill recorded process groups and tagged processes, commit interrupted work, resume from the last handoff
- [x] 10.4 Needs You: parked changes with their last gate lines and attempts; run-stopping errors
- [x] 10.5 Console Run panel on the Mission page: pick changes, stop time, model, budget as tokens; Start and Stop (guarded POSTs); live progress over SSE
- [x] 10.6 CLI `counterpoint run`, `run stop`, `run status` over the control socket
- [x] 10.7 Console Run doctor on the Trust page: guarded POST, one probe at a time, progress over SSE, report replaced when done
- [x] 10.8 Console: withdraw an accepted risk on the Trust page (accepting stays terminal-only)
- [x] 10.9 Console: Stop Counterpoint (a run stops at its next clean point first)
- [x] 10.10 Console Settings page per project: model, effort, context budget, per-session limits; stored by the daemon; runs use them (CLI may override model, effort, budget)

## 11. Pull requests and report

- [x] 11.1 Push helper (owner credentials for that call only) and `gh pr create` with the generated body
- [x] 11.2 Preview link: host deploy from the PR checks, else a sandboxed loopback preview
- [x] 11.3 Planning-write queue (serialized) and the planning-file flag that keeps a PR from being offered for merge
- [x] 11.4 Run report at every run end: file, store, shown in the console, `counterpoint run report`
- [x] 11.5 Session commits authored with the owner's git identity and a `Counterpoint-Run: <run> session <n>` trailer: Vercel blocked every build PR's preview for commits by `Counterpoint <counterpoint@localhost>` (owner decision 2026-11-11: Counterpoint acts as the owner). Planning write-backs are authored as the owner too; sessions and gates get `COREPACK_HOME`, so `pnpm` finds the owner's package managers offline
- [x] 11.6 A change built again reuses its open PR and marks it ready when the change is delivered whole with nothing blocking the merge (a PR held as a draft while the change was unfinished, such as Cena's #14, comes back by itself); it still goes back to draft when the branch edits planning

## 12. First run on Cena

- [x] 12.1 Draft Cena's `.counterpoint/config.yaml` (gates, Supabase service, ports) on a branch
- [ ] 12.2 Owner: review and commit Cena's `.counterpoint/config.yaml`
- [ ] 12.3 Owner: start the first overnight run from the console and read its report there
