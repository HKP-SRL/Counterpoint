# runway Specification

## Purpose
The runway is the headline metric: how much approved, ready-to-build work sits ahead of the builder. It holds the changes the owner has approved with one click in the console that are not built yet.

## Requirements

### Requirement: Runway is the Mission headline
The Mission page SHALL lead with the runway count and list the changes on the runway with title, task count and approved time, each linking to its detail. A zero runway SHALL show its empty state, and the figure SHALL not change color.

#### Scenario: First approval
- **WHEN** the owner approves the first change into an empty runway
- **THEN** the Mission headline goes from 0 to 1 without a reload

### Requirement: Uncommitted edits do not change the runway
Uncommitted edits in the owner's checkout SHALL NOT take a change off the runway or change what its build uses; the runway and builds read the change's files at the base-branch tip.

#### Scenario: Owner edits an approved proposal locally
- **WHEN** the owner edits an approved change's proposal without committing
- **THEN** the change stays on the runway, and its build uses the proposal as committed at the base-branch tip

### Requirement: Runway is the approved work not yet built
The runway SHALL be the set of changes the owner has approved that are readable and not yet built. It SHALL follow the owner's approvals and withdrawals at once, and the base branch on the remote within about a minute.

#### Scenario: Approved change joins
- **WHEN** the owner approves a Ready to approve change
- **THEN** the change is on the runway

#### Scenario: Built change leaves
- **WHEN** an approved change's PR merges on GitHub and the change shows Built
- **THEN** the change is no longer on the runway, without the owner pulling the base branch

### Requirement: A merged build PR means built
A change whose latest build PR has merged SHALL show Built and leave the runway within about a minute, and no run SHALL build it again. This SHALL need no pull of the owner's base branch and no task ticked on the base branch. A merged PR SHALL count only while every open build task of the change on the base branch is one that build covered: open when the build started, or ticked by it. A closed PR SHALL still be checked, so a PR reopened and merged counts.

#### Scenario: Build PR merged with its tasks unticked on the base
- **WHEN** a change's build PR merges on GitHub, and its task list on the base branch still has open tasks
- **THEN** the change shows Built and is off the runway, and a run started afterwards does not build it

#### Scenario: Build task added after the merge
- **WHEN** a build task is added to a change after its build PR merged
- **THEN** the change is no longer Built: it shows Ready to approve and can build again

#### Scenario: A new change reuses the name
- **WHEN** a new change takes the name of a change whose build PR merged earlier
- **THEN** the new change shows Ready to approve, not Built

#### Scenario: Closed PR reopened and merged
- **WHEN** the owner reopens a closed build PR and merges it
- **THEN** the change shows Built within about a minute

### Requirement: Where each runway change stands
Changes and the change page SHALL show where an approved change stands instead of On runway: Up next or Building while a run has it, Parked, On hold, PR open or PR closed (with a link to the PR), or Waits on the changes it depends on that are not built. A change with none of these SHALL show On runway.

#### Scenario: Green build with its PR open
- **WHEN** a change's latest build is green and its PR is open
- **THEN** Changes and the change page show PR open with a link to the PR

#### Scenario: Parked change
- **WHEN** a change parked in the last run that built it
- **THEN** it shows Parked, and its page offers Retry

### Requirement: Changes that can build now
Run, the run form's default choice and the count of changes ready to build SHALL include only the changes on the runway that can build now: not building, not parked, not on hold, not waiting on a dependency, and without an open PR from their latest build. The owner MAY still pick a parked change (a retry), one with an open PR (a rebuild) or one that waits (the run skips it and says why). A change on hold SHALL NOT be built by any run until the owner retries it.

#### Scenario: One click never rebuilds a green PR
- **WHEN** a change's PR is open and green and the owner clicks Run
- **THEN** that change is not built again

#### Scenario: Pick a parked change
- **WHEN** the owner picks a parked change in the run form and starts the run
- **THEN** the run builds it
