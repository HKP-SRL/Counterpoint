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
Uncommitted edits in the owner's checkout SHALL NOT take a change off the runway; the console SHALL show a soft hint that an approved change has uncommitted edits.

#### Scenario: Owner edits an approved proposal locally
- **WHEN** the owner edits an approved change's proposal without committing
- **THEN** the change stays on the runway and shows the uncommitted-edits hint

### Requirement: Uncommitted-edits hint runs no repository program
The check behind the uncommitted-edits hint SHALL NOT run any content filter, hook or other program configured by the host repository; a covered file that a filter applies to SHALL show as edited and not checkable.

#### Scenario: Clean filter configured
- **WHEN** the host's attributes assign a clean filter to a covered file
- **THEN** the hint check runs no filter and shows the file as not checkable

### Requirement: Runway is the approved work not yet built
The runway SHALL be the set of changes the owner has approved that are readable and not yet built. It SHALL follow the owner's approvals and withdrawals at once, and the base branch within a few seconds.

#### Scenario: Approved change joins
- **WHEN** the owner approves a Ready to approve change
- **THEN** the change is on the runway

#### Scenario: Built change leaves
- **WHEN** an approved change's work is merged and the change shows Built
- **THEN** the change is no longer on the runway
