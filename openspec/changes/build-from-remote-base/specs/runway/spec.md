# Spec Delta

## MODIFIED Requirements

### Requirement: Runway is the approved work not yet built
The runway SHALL be the set of changes the owner has approved that are readable and not yet built. It SHALL follow the owner's approvals and withdrawals at once, and the base branch on the remote within about a minute.

#### Scenario: Approved change joins
- **WHEN** the owner approves a Ready to approve change
- **THEN** the change is on the runway

#### Scenario: Built change leaves
- **WHEN** an approved change's PR merges on GitHub and the change shows Built
- **THEN** the change is no longer on the runway, without the owner pulling the base branch

## ADDED Requirements

### Requirement: A merged build PR means built
A change whose latest build PR has merged SHALL show Built and leave the runway within about a minute, and no run SHALL build it again. This SHALL need no pull of the owner's base branch and no task ticked on the base branch.

#### Scenario: Build PR merged with its tasks unticked on the base
- **WHEN** a change's build PR merges on GitHub, and its task list on the base branch still has open tasks
- **THEN** the change shows Built and is off the runway, and a run started afterwards does not build it
