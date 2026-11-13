# Design

## Context

See proposal.md for the why. What the code does today:

- Every read of the base resolves `refs/heads/<base>` in the owner's repository: the host runtime and its cache per tip (`src/server/hosts.ts`), the 2-second tip watcher (`src/server/watcher.ts`), approvals and the runway (`src/server/approval-views.ts`), the run's build order, config check and each build's base commit (`src/build/orchestrator.ts`), framework detection (`src/compose.ts`) and the approval carry-over (`src/core/runway/carry-over.ts`).
- Since `run-as-owner` D-4 and D-5, an approval records the base commit, and a build records its base commit and reads the host config there. Worktrees, gates (`{changed}`), crash recovery and the PR body all work from that recorded commit, so they need no change.
- Nothing fetches. The PR push is the only network git call: it goes to the remote the base branch tracks, else `origin`, with the owner's credentials for that one call (`gh auth git-credential` for https, the SSH agent for ssh).

## Goals / Non-Goals

**Goals:**
- One base for everything, as it is on the remote, with no terminal step.
- A fetch problem never ends a run or asks the owner for anything.

**Non-Goals:**
- Pulling or fast-forwarding the owner's local base branch.
- A "Fetch now" button, or a setting for the interval.
- The out-of-date `cp/` branch button and the open-green-PR rebuild guard (backlog).
- How planning writes reach the remote (see Open Questions).

## Decisions

**D-1. The base is the remote-tracking branch, through one resolver.**
The base ref is `refs/remotes/<remote>/<base>`, where `<remote>` is the remote the base branch tracks, else `origin`: the same rule as the push, so a build starts from the branch its PR targets. Every read listed in Context goes through one resolver. Approvals and the runway use it too, so the runway always matches what a build would use.
*Alternatives:* fast-forward the owner's local branch (writes to the owner's branches, and fails when the branch is checked out with edits); read whichever of local and remote is newer (builds unpushed commits into PRs, and keeps two sources of truth); remote for builds only (the runway and the builds disagree).

**D-2. One narrow fetch.**
`git fetch --no-tags --no-write-fetch-head --no-recurse-submodules <remote> +refs/heads/<base>:refs/remotes/<remote>/<base>`, with `gc.auto=0` and `maintenance.auto=false`, through the clean git runner, 30-second limit. It gets the push's credentials; any other URL (a local path in tests) is fetched with none. The `+` follows a rewritten remote branch. It writes objects and that one ref, nothing else.
*Alternatives:* `git fetch origin` (every branch and tag, writes `FETCH_HEAD`); reading the tip SHA through `gh api` (a build still needs the objects).

**D-3. When it fetches.**
At run start (the build order and config check use it), at each change's build start (not when a crash resume already has a recorded base), and every 60 seconds per host from the daemon. One fetch per host at a time; a caller joins one in flight. Approve and Withdraw never wait on the network. The watcher keeps polling the resolved ref every 2 seconds, so a fetch shows in the console within seconds. In a run the fetch uses the run's environment; outside one, the owner's login environment, read on first need and refreshed at each run start.
*Alternatives:* also fetch when a console page opens (saves under a minute after a merge; add later if the minute feels slow); only at run start (the console stays stale between runs, the same bug elsewhere).

**D-4. A failed fetch falls back to the last fetched tip.**
At a run or build start, one retry after 5 seconds, then the build uses the remote-tracking ref as it is. Per host, Counterpoint keeps the last success time and the last error. The change's run row records when its base was fetched and the error, if any; the run report names those changes. The console shows one line while the latest fetch has failed. No Needs You item and no notification: the next fetch usually fixes it, and expired credentials already park the change at push with the reason.
*Alternatives:* end the run (an overnight run lost to a network blip); a Needs You card (an interruption for something that fixes itself).

**D-5. Hosts with no remote read the local branch.**
If the base branch has no remote, or the remote-tracking ref does not exist yet, the resolver uses `refs/heads/<base>` as today, and the console says "local only". Fixtures and local experiments keep working. Delivery is unchanged and still needs a GitHub remote.

**D-6. The console says which base it reads, and speaks up only when something is off.**
The Changes page line becomes "Read from origin/master at abc1234". One extra line appears only for: a failed fetch ("Last fetch failed 12 min ago: <reason>. Showing origin/master as fetched at 09:14."), a local-only host, or local commits not on the remote ("master has 2 commits not on origin; they are not built."). That count is `rev-list --count <remote-ref>..refs/heads/<base>`, taken after each fetch.

## Risks / Trade-offs

- [The base moves more often, so an existing `cp/` branch falls behind more often and parks with "merge the base in or delete it"] → That is the out-of-date-branch backlog item; this change makes it more pressing.
- [Unpushed planning commits on the local base branch vanish from the console] → The console line names the count. Planning reaches the base through PRs today.
- [`node_modules` cloned from the owner's checkout can be older than the remote base] → Builders already install what a task needs, and the gates catch a mismatch.
- [A fetch races the owner's own `git pull` for the same ref lock] → The loser fails once; Counterpoint tries again next minute. A fetch of one branch takes about a second.
- [Offline for hours means a failed fetch every minute] → Log only when the state changes, not every failure.

## Migration Plan

1. Build in the order of tasks.md. One nullable column on run changes for the fetch note; no data moves.
2. Reinstall and restart (no run active). On Cena, leave local `master` behind and check that the console and the next build use `origin/master`.
3. Rollback: git revert and reinstall. The extra column is ignored by the old version.

## Open Questions

- **Planning writes.** They commit to the local base branch and push nothing. Nothing calls them yet, but `owner-inbox` will (Done on an owner step, Land it). After this change such a write would not show until it reaches the remote. Settle in `owner-inbox`. Recommendation: land it as a small PR that the same click merges, so the base still changes only through a PR the owner merges and branch protection keeps working.
