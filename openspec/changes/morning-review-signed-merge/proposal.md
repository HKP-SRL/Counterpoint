# Morning Review & Signed Merge

## Why

After the first unattended run works from the CLI, the owner needs to come back in the morning, follow several changes building in parallel from the console, and merge each finished one — but only with their own signature, and safely even when the base branch moved underneath. This is the first change that can merge anything, so it leans entirely on the trust layer.

## What Changes

- Console mission control: each change shows its build status and gate row, which lights up as gates pass; the failing gate's last lines are one click away; the owner can open a running session's live log and stop that session.
- Daytime mode: runs also happen with the owner at the desk. PRs appear for review as each one lands, not in a morning debrief, and revision rounds in flight show beside builds.
- Parallel builds without collisions: one shared test lock, and each worktree gets its own ports and database.
- When the base branch moves and conflicts with a build, the builder rebases, resolves, re-runs every gate, and parks the change if it can't; the owner's pushed work is never dropped.
- Merge approval: the owner sees a summary of every assumption the builder proceeded on and every revision round (`pr-revisions`), then signs a `--no-ff` merge commit of the exact PR head at a terminal. Counterpoint pushes it, the PR shows as merged, and the change's worktree and branch are cleaned up. Nothing merges without a verified owner-signed merge commit, recomputed from git every time.
- A few honest counters beside the runway, each paired with a counter-metric. One measures whether the builder built the right thing: changes merged with no revision round, paired with rework filed after merge.

## Capabilities

### New Capabilities
- `merge-approval`: signed merge commits of the exact PR head, verification, push and cleanup.
- `mission-control`: per-change statuses, gate rows, live session logs, daytime mode and honest counters in the console.
- `parallel-builds`: collision-free parallel builds and rebase on conflict.

### Modified Capabilities
- `needs-you`: PRs awaiting the owner's signed merge appear in the inbox.

## Impact

- Uses the approval signing path from `signed-approvals` for a second statement kind (merge).
- Per-worktree port and database allocation; host preview and test setup must accept them.
- Check Cena's branch-protection settings on `master` before planning: the signed merge commit must be pushable while agents still cannot push to the base branch.
