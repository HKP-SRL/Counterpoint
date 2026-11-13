# Tasks

Decisions D-1 to D-6 are in design.md. Tests go only where a mistake would stop a run or lose the owner's work.

## 1. Resolve and fetch the remote base

- [ ] 1.1 Add the base-ref resolver (D-1, D-5): the remote the base branch tracks, else `origin`; its remote-tracking ref, else the local base branch marked local only. Verify: fixture tests for a clone with a remote and a repository with none.
- [ ] 1.2 Add the narrow fetch with the push's credentials and a 30-second limit (D-2). Verify: a fixture test with a bare remote ahead of a clone that has uncommitted edits and an unpushed commit on its base branch. After the fetch the remote-tracking ref has moved, and the local base branch, `HEAD`, index, working files and `FETCH_HEAD` are unchanged.
- [ ] 1.3 Add the per-host fetcher (D-3, D-4, D-6): one fetch at a time, the last success time and error, the count of local commits not on the remote, a 60-second loop in the daemon, the owner's login environment outside runs, and a log line only when the state changes. Verify: with the daemon on a fixture host, a push to its bare remote shows in the host API within a minute.

## 2. Every read uses the remote base

- [ ] 2.1 Route the host runtime, the tip watcher, approvals and the runway, framework detection and the approval carry-over through the resolver. Verify: `pnpm test` passes, and a search for base reads of `refs/heads/` finds only the resolver and planning writes.
- [ ] 2.2 In the orchestrator, fetch at run start (build order, config check) and at each build start, but not when a resumed change has a recorded base. On failure, retry once after 5 seconds, then use the last fetched tip. Record the fetch time and error on the change's run row (store migration, one nullable column). Verify with two orchestrator tests: a local base branch behind the remote builds from the remote tip with the config read there; a failing fetch builds from the last fetched tip, the run goes on, and the row carries the error.

## 3. Console and run report

- [ ] 3.1 Add the base ref, fetch time, last error, local-only flag and local-ahead count to the host API. Show them on the Changes page as one line, plus a second line only when something is off (D-6). Verify in the running console on a fixture host: a remote pointing at a missing path shows the failed-fetch line, and an unpushed commit shows the count.
- [ ] 3.2 Make the run report name each change built from a base that could not be fetched. Verify: the report produced by 2.2's failing-fetch test names the change and the fetch time.

## 4. Prove it on Cena

- [ ] 4.1 With no run active, reinstall and restart Counterpoint while Cena's local `master` is behind `origin/master`. Verify all of: the Changes page reads `origin/master`; a change whose PR has merged shows Built with no pull; one change builds from `origin/master`; `git -C <cena> rev-parse master` is unchanged afterwards.

## Workflow follow-up

- Remove "Build from the remote base" from `docs/backlog.md` when this change is archived.
- Settle how planning writes reach the remote in `owner-inbox` (design.md, Open Questions).
