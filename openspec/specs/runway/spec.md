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
A change whose latest build PR has merged SHALL show Built and leave the runway within about a minute, and no run SHALL build it again. This SHALL need no pull of the owner's base branch and no task ticked on the base branch.

#### Scenario: Build PR merged with its tasks unticked on the base
- **WHEN** a change's build PR merges on GitHub, and its task list on the base branch still has open tasks
- **THEN** the change shows Built and is off the runway, and a run started afterwards does not build it

#### Scenario: Run started right after a merge
- **WHEN** the owner starts a run seconds after a change's build PR merged on GitHub
- **THEN** the run does not build that change
