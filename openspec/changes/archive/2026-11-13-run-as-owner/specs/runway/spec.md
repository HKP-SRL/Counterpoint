# runway Spec Delta

## ADDED Requirements

### Requirement: Runway is the approved work not yet built
The runway SHALL be the set of changes the owner has approved that are readable and not yet built. It SHALL follow the owner's approvals and withdrawals at once, and the base branch within a few seconds.

#### Scenario: Approved change joins
- **WHEN** the owner approves a Ready to approve change
- **THEN** the change is on the runway

#### Scenario: Built change leaves
- **WHEN** an approved change's work is merged and the change shows Built
- **THEN** the change is no longer on the runway

## MODIFIED Requirements

### Requirement: Runway is the Mission headline
The Mission page SHALL lead with the runway count and list the changes on the runway with title, task count and approved time, each linking to its detail. A zero runway SHALL show its empty state, and the figure SHALL not change color.

#### Scenario: First approval
- **WHEN** the owner approves the first change into an empty runway
- **THEN** the Mission headline goes from 0 to 1 without a reload

## REMOVED Requirements

### Requirement: Runway recomputed from git
**Reason**: It existed so a forged record could not put unsigned work on the runway. Approvals are no longer signed files in git.
**Migration**: "Runway is the approved work not yet built", and the `approvals` capability.

### Requirement: Transient errors do not pin the runway
**Reason**: There is no signature verification left to time out.
**Migration**: None.
