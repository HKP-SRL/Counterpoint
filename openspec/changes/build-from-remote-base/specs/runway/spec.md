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
