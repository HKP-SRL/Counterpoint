# Build from the Remote Base

## Why

Counterpoint reads the base branch from the owner's local checkout. On 2026-11-13, while proving `run-as-owner` on Cena, a PR merged on GitHub left the local `master` 2 commits behind. A run would have built from the old base with the old host config, and a session had to fast-forward `master` by hand. That is a terminal step the product should do itself.

## What Changes

- **The base branch is read from the remote.** Counterpoint fetches the base branch and reads it as it is on the remote. The change list, statuses, approvals, the runway, builds and the host config all use that one base.
- **Fetching never touches the owner's checkout.** No local branch, working file, index or `HEAD` changes. Only the remote-tracking branch moves, as with a plain `git fetch`.
- **When it fetches:** at each run start, at each change's build start, and about once a minute while Counterpoint runs. A PR merged on GitHub shows within about a minute, with no pull.
- **A failed fetch never stops work.** Counterpoint uses the base as last fetched and says so: one line in the console, and a note in the run report on each change built that way.
- **Hosts with no remote** keep reading their local base branch, and the console says "local only".
- **Behavior change:** a commit on the local base branch that is not on the remote no longer shows or builds. The console notes how many such commits there are.

Out of scope (separate backlog items): the button for an out-of-date `cp/` branch, and the guard against rebuilding over an open green PR. One part falls out on its own: after a change's PR merges, it leaves the runway without the owner pulling.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `host-planning`: the base branch is read from the remote; when it is fetched; what a failed fetch does; hosts with no remote; live refresh follows the remote.
- `runway`: the runway follows the remote base branch.
- `build-runs`: a change's worktree starts from the base as fetched when its build starts.

## Impact

- **Code:** one base-ref resolver and a per-host fetcher in `src/core/git`; every read of `refs/heads/<base>` goes through the resolver (`src/server/hosts.ts`, `src/server/watcher.ts`, `src/server/approval-views.ts`, `src/build/orchestrator.ts`, `src/compose.ts`, `src/core/runway/carry-over.ts`); a fetch loop in the daemon; the fetch state on the host API; one line on the Changes page and the run report.
- **Credentials:** the fetch uses the same remote and the owner's credentials as the PR push already does. No new token.
- **Not changed:** approvals already record the base commit and keep doing so; worktrees, gates and delivery already work from a recorded commit.
- **Other changes:** planning writes (used by `owner-inbox`'s Done and Land it) commit to the local base branch and push nothing. After this change such a write would not show until it reaches the remote. See design.md, Open Questions.
