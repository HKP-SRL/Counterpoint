# First Unattended Run

## Why

This is where Counterpoint proves its core value: the owner starts a run on an approved Cena change and walks away, and comes back to either a green PR with a preview link or a parked item with the reason. Everything after this depends on one real overnight run succeeding. Before any unattended builder runs, the trust gaps the trusted-shell code review left open must be closed, so they are this change's first work.

## What Changes

- **First, trust fixes from the trusted-shell review** (see design.md): doctor judges every settings widening of where agents may write and probes a Bash write outside the working folder (CR-01); `trust-key` pins exactly the key the owner confirmed (WR-02); approval recomputation ignores git replace refs (WR-04); the integrity baseline covers every execution-capable git key, per-worktree config and include targets (WR-05); the uncommitted-edits hint runs no repository filter (WR-06); verify whether sandbox auto-allow is inert while bare `Bash` is allow-listed and fix or correct the record (WR-01). Also: transient verification errors no longer pin the runway (WR-07) and `stop` never signals an unrelated process (WR-08).
- The owner starts a run from the console (the CLI can too), choosing approved changes, stop time, model and context budget (shown as a token figure, e.g. "40% of 1M = 400k tokens"), follows its progress there, and can stop it. Richer mission-control views come in `morning-review-signed-merge`.
- Each change builds in its own git worktree and branch, never the owner's checkout, in fresh `claude -p` sessions that hand off at the context budget (finish the task, write a handoff, stop); Counterpoint commits each session's work, since builders write no git state.
- Usage limits pause every agent lane until reset + 2 minutes, then resume; transient API errors back off; auth, credit and spend-limit errors stop the run and land in Needs You. One governor sits in front of every agent spawn.
- Crash or reboot recovery: the run resumes from its last handoff with no orphaned processes.
- Gates are commands from the host's Counterpoint config read at the approved base, judged only by exit code; failures feed back for bounded retries; after N failed attempts the change parks in Needs You. Protected-path and zero-test guards.
- One PR per change, body generated from the change's artifacts listing assumed decisions, with a preview link (the host's preview deploy, else a local preview).
- All planning writes go through one serialized path; build worktrees never write the host's planning files directly.
- A run report at the end of every run.

## Capabilities

### New Capabilities
- `build-runs`: starting, stopping and running builds in worktrees with context-budget handoffs, limit handling and crash recovery.
- `gates`: Counterpoint-defined gate commands, exit-code judgement, retries, parking and gate-integrity guards.
- `pull-requests`: one PR per change with a generated body and a preview link.
- `run-report`: the end-of-run summary.
- `planning-writes`: the single serialized path for every write to the host's planning files.

### Modified Capabilities
- `doctor`: judges settings that widen agent write access; Bash outside-write probe step.
- `key-trust`: wider integrity surface; trust-key pins the confirmed key.
- `signed-approvals`: recomputation ignores replace refs and grafts.
- `runway`: transient errors do not pin; the uncommitted-edits hint runs no repository program.
- `daemon-lifecycle`: `stop` never signals an unrelated process.
- `needs-you`: parked changes and run-stopping errors appear in the inbox.

## Impact

- New: worktree manager, build orchestrator behind the AgentRunner port, gate runner (process groups, shared test lock), quota governor, PR creation through `gh`, run report.
- Host side: branches and worktrees per change; PRs on the host's GitHub; the host's Counterpoint config gains a gates section (its digest is already in every approval).
- Research spikes first: the context-window denominator on a 1M-window model, the `rate_limit_event` shape and reset unit, process-group kill on macOS, sandbox escape hatches for gate commands that need Supabase or Docker.
