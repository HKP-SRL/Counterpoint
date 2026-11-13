# Build Ticks and Owner Steps

## Why

Two things go missing after a build PR merges. On Cena, `owner-ui-on-astryx` was built and its PR #16 merged, yet `master` still shows 2 of 32 tasks ticked: the builder did all 30 build tasks, but Counterpoint keeps the ticks in its own store and nothing ever writes them back. And the change's two after-the-build owner steps (13.3, a real-device check; 13.4, a UI audit) never reach Needs You, because owner-step cards cover only planned and runway changes. They show only as "2 owner steps" in the change list.

## What Changes

- **Build ticks ride in the build PR.** At delivery Counterpoint adds one tick-only commit to the build branch, made from the ticks it recorded, never from the builder's own edit. Merging the PR ticks the base too, in one PR.
- **Later deliveries add the ticks since.** A change built again on the same branch gets a new tick commit for the tasks ticked since the last one.
- **Owner steps are never ticked by a build.** They stay for the owner (Done, or Land it).
- **A task list that would conflict stays out of the PR.** If the base's task list changed so that the ticks would conflict, they are left out of (or taken back out of) the PR, and land as one small planning write once the PR merges. The PR body says which.
- **The planning-writes rule is reworded:** builders never write planning files; Counterpoint's own tick commit is the one planning edit a build branch may carry.
- **Owner steps of built changes stay cards.** A built, unarchived change keeps a Needs You card for each open `Owner:` step until it is ticked on the base. The card says the change is merged and links its PR. Done, Later and Do it for me work as on any owner-step card.

Out of scope: archiving a change once every task is ticked (added to `docs/backlog.md`).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `planning-writes`: builds may carry Counterpoint's own tick commit; build ticks reach the base with the build PR, or after it merges when they would conflict.
- `owner-steps` (added by `owner-inbox`): owner-step cards also cover built changes that are not archived.

## Impact

- **Code:** delivery (`src/build/deliver.ts`) makes the tick commit before the push; the planning check (`src/build/branch-diff.ts`) accepts a tick-only task list; session commits (`src/build/session-commit.ts`) count ticks against the branch point; the per-host PR tick (`src/build/pr-state.ts`) watches for a task-list conflict and starts the after-merge write; owner-step cards (`src/build/owner-steps.ts`) include built changes.
- **Store:** one nullable column on run changes for where the ticks are (in the PR, or to land after merge).
- **Depends on** `owner-inbox` (owner-step cards and planning writes as small PRs).
- **Hosts:** a build PR now touches the change's `tasks.md`. A host whose CI or preview deploys skip planning-only paths is unaffected; the PR still has code.
