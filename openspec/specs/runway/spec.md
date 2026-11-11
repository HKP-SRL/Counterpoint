# runway Specification

## Purpose
The runway is the headline metric: how much approved, ready-to-build work sits ahead of the builder, always recomputed from signed approvals in git and never stored as authority.

## Requirements

### Requirement: Runway recomputed from git
The runway SHALL be the set of changes whose approval is valid and whose current covered content and gate config at the base-branch tip match the signed statement. It SHALL be recomputed from git on every read; any cache SHALL be keyed by the base tip and never trusted as authority.

#### Scenario: Forged store row
- **WHEN** a process writes an "approved" record into Counterpoint's store for an unsigned change
- **THEN** the change is not on the runway

#### Scenario: Gate config edited
- **WHEN** the host's gate config changes on the base branch after a change was signed
- **THEN** that change leaves the runway

### Requirement: Runway is the Mission headline
The Mission page SHALL lead with the runway count and list the changes on the runway with title, task count and signed time, each linking to its detail. A zero runway SHALL show its empty state, and the figure SHALL not change color.

#### Scenario: First approval
- **WHEN** the owner signs the first change into an empty runway
- **THEN** the Mission headline goes from 0 to 1 without a reload

### Requirement: Uncommitted edits do not change the runway
Uncommitted edits in the owner's checkout SHALL NOT take a change off the runway; the console SHALL show a soft hint that an approved change has uncommitted edits.

#### Scenario: Owner edits an approved proposal locally
- **WHEN** the owner edits an approved change's proposal without committing
- **THEN** the change stays on the runway and shows the uncommitted-edits hint
