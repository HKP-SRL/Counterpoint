# planning-writes Spec Delta

## MODIFIED Requirements

### Requirement: Single serialized write path
Every write Counterpoint makes to the host's planning files (decisions, backlog items, bookkeeping such as ticking tasks or archiving a change) SHALL go through one serialized path that lands one write at a time. The one exception is a build's own ticks: the tick-only commit Counterpoint adds to a build branch rides in that change's build PR and is not a separate write. Ticks kept out of the build PR land after its merge through the serialized path.

#### Scenario: Two writes at once
- **WHEN** two builds finish at the same moment and both need bookkeeping
- **THEN** the writes land one after the other as separate small PRs, each merged

#### Scenario: A build's ticks
- **WHEN** a change is delivered with build tasks recorded done
- **THEN** its ticks reach the base branch in its build PR, and no separate small PR is opened for them

### Requirement: Builds never write planning files directly
A build worktree's commits SHALL NOT change the host's planning files, with one exception that Counterpoint makes itself: a commit that only ticks tasks in the change's own task list, made from the ticks it recorded. A PR whose diff touches planning files in any other way SHALL be flagged and not offered for merge.

#### Scenario: Builder edits a proposal
- **WHEN** a builder commits a change to `openspec/changes/<name>/proposal.md` in its worktree
- **THEN** the change is flagged and its PR is not offered for merge

#### Scenario: Builder ticks tasks
- **WHEN** a builder ticks tasks in its worktree's task list
- **THEN** its session commits leave the task list out, and the ticks reach the branch only through Counterpoint's tick commit

#### Scenario: Task list changed beyond ticks
- **WHEN** a build branch's task list differs from the branch point in anything other than ticked boxes
- **THEN** the change is flagged and its PR is not offered for merge

## ADDED Requirements

### Requirement: Build ticks ride in the build PR
When Counterpoint delivers a change, it SHALL add one commit to the build branch that ticks, in the change's task list, each build task it recorded as done and not yet ticked there, and changes nothing else. It SHALL NOT tick an owner step. Merging the build PR SHALL leave those tasks ticked on the base branch, with no other PR.

#### Scenario: Every build task done
- **WHEN** a change with 30 build tasks and 2 owner steps is built with all 30 recorded done, and its PR merges
- **THEN** the base branch shows the 30 build tasks ticked and the 2 owner steps open

#### Scenario: Builder's own edit is not used
- **WHEN** the builder also reworded a task or unticked one in its worktree
- **THEN** the PR's task list differs from the branch point only in the ticks Counterpoint recorded

#### Scenario: Built again on the same branch
- **WHEN** a change is delivered again on its branch after more tasks were done
- **THEN** the PR gets one more tick-only commit with the tasks ticked since, and the earlier ticks stay

### Requirement: Ticks that would conflict land after the merge
When the base's copy of the change's task list has changed so that the build PR would conflict in it, Counterpoint SHALL keep its ticks out of the PR, or take them back out with a new commit while the PR is open, so the PR still merges. Once the PR merges, the ticks SHALL land as one small planning write, started by that merge with no click. The PR body SHALL say where the ticks are.

#### Scenario: Owner ticked a neighbouring step during the build
- **WHEN** the owner marks owner step 13.3 Done while the change builds, and the build ticked 13.2, the line above it
- **THEN** the build PR carries no ticks and its body says they land after the merge, and once it merges the base shows both 13.2 and 13.3 ticked

#### Scenario: Base task list changes while the PR is open
- **WHEN** the build PR is open with its tick commit, and a tick of a neighbouring owner step merges on the base
- **THEN** within about a minute Counterpoint takes its ticks back out of the PR with a new commit, the PR has no conflict, and the ticks land after the merge

#### Scenario: Change far from the ticks
- **WHEN** the base's task list changed only in lines that neither are nor border the ticked tasks
- **THEN** the ticks stay in the PR

#### Scenario: After-merge write blocked
- **WHEN** the after-merge write's PR cannot be merged
- **THEN** a card says why, links that PR and offers Retry and Cancel, as for any planning write
