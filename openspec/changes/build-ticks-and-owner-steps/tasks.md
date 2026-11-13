# Tasks

Decisions D-1 to D-6 are in design.md. Tests go only where a mistake would stop a run or lose the owner's work.

## 1. Ticks in the build PR

- [ ] 1.1 Session commits count ticks against the build's base commit, not `HEAD` (D-1). Verify: an orchestrator test where the branch already holds a tick commit and the next session ticks one more task. The change is not parked for making no progress, and the run change records every tick.
- [ ] 1.2 At delivery, before the push, make the tick-only commit from the recorded ticks through the adapter (D-2). It skips owner steps and tasks that are gone, commits as the owner with the run trailer, and resets the worktree's list. The planning check accepts the change's task list when it differs from the branch point only in build-task ticks. The PR body gets its "Ticks:" line. Verify with delivery tests on a fixture host:
  - the pushed list differs from the branch point only in the recorded ticks, though the builder reworded a task and ticked an owner step;
  - the PR is not a draft, and its body says the ticks are in this PR;
  - a second delivery adds one commit with only the new ticks.

## 2. Ticks that would conflict

- [ ] 2.1 At delivery, a three-way merge of the task list alone decides (D-3). No conflict: the tick commit is made. A conflict: no tick commit, and the run change is marked "ticks after merge" (store migration, one nullable column). Verify: a fixture test where the base ticked 13.3 after the branch point and the build ticked 13.2. No tick commit is made, the body says the ticks land after the merge, and a trial merge of the branch into the base is clean.
- [ ] 2.2 On the minute PR tick, take the ticks back out of an open PR whose list now conflicts (D-3). The commit puts back the branch-point list, is built with plumbing and pushed. It is made only when the remote branch is at Counterpoint's last push and no run holds the change. Verify with a local bare remote:
  - after a neighbouring tick lands on the base, the branch gets that commit and merges into the base cleanly;
  - with someone else's commit on the remote branch, nothing is pushed.
- [ ] 2.3 After a build PR delivered by this version merges, land the recorded ticks missing on the base as one small planning write: one edit holding every tick, tasks that are gone dropped, shown under Landing (D-3, D-4). Verify with a local bare remote and a fake `gh`: after the merge, the base has every recorded build tick and no owner step ticked. A blocked write shows Retry and Cancel.

## 3. Owner steps of built changes

- [ ] 3.1 Owner-step cards take built changes that are not archived. Their cards stay open when the change turns Built, the why line names the merged PR and the console links it, and Do it for me stays offered (D-5). Verify in the running console on a fixture host with a merged change:
  - its two owner steps show as cards with the PR link;
  - Done on one resolves only that card once its small PR merged;
  - after archiving, the change has no cards.
- [ ] 3.2 Add "Archive a change once every task is ticked on the base" to `docs/backlog.md` under Build lane. Verify: the item is there.

## 4. Prove on Cena

- [ ] 4.1 Owner: with the next real Cena build, check that the merged build PR leaves its build tasks ticked on `master`. Also check that its after-the-build owner steps show in Needs You with the PR linked until they are Done. An agent may run this only with the owner's go-ahead, and opens no real PR on Cena without the owner. Verify:
  - `master`'s task count after the merge matches the ticks the PR body lists;
  - Done on one step shows a merged small PR, and that card resolves.
