# owner-steps Spec Delta

## Purpose
A step the plan reserves for the owner (an `Owner:` task) reaches the owner as a card, and Counterpoint does the step for them when they say yes and it can.

## ADDED Requirements

### Requirement: Owner steps are cards
Every unchecked `Owner:` step of a change that is planned or on the runway SHALL appear in Needs You as a card with the step's text, the options Done and Later, and Do it for me where Counterpoint can perform the step. Answering Done SHALL tick the step through the planning-write path.

#### Scenario: Step done by hand
- **WHEN** the owner marks an owner step Done
- **THEN** the step is ticked in the change's task list on the base branch and the card closes

### Requirement: Do it for me
For a step Counterpoint can perform, picking Do it for me SHALL run the step in a worktree of the base branch, never the owner's checkout. It SHALL run as the owner, as builder sessions do. The result SHALL then be shown on a second card with its diff and the options Land it, Discard and Later. Only Land it SHALL put the result on the base branch.

#### Scenario: Approve and install a package version
- **WHEN** the owner answers "Approve Astryx 0.7.12 and install it" on a supply-chain step card
- **THEN** Counterpoint installs the exact pinned versions in its own worktree and shows the changed manifest and lockfile on a Land it card

#### Scenario: Nothing lands without the owner
- **WHEN** an owner-step result is waiting on its Land it card
- **THEN** the base branch is unchanged until the owner picks Land it
