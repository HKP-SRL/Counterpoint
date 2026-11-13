# planning-writes Spec Delta

## MODIFIED Requirements

### Requirement: Single serialized write path
Every write Counterpoint makes to the host's planning files (decisions, backlog items, bookkeeping such as ticking tasks or archiving a change) SHALL go through one serialized path that lands one write at a time.

#### Scenario: Two writes at once
- **WHEN** two builds finish at the same moment and both need bookkeeping
- **THEN** the writes land one after the other as separate small PRs, each merged

## ADDED Requirements

### Requirement: Writes land through a small PR
A planning write SHALL reach the base branch only through its own small PR, which Counterpoint opens and merges as the owner, with the owner's existing `gh` login, on the same click that asked for it. It SHALL NOT push to the base branch directly or bypass the base branch's protection rules. It SHALL NOT change the owner's local branches, checked-out branch or working files.

#### Scenario: Owner ticks a step
- **WHEN** the owner clicks Done on an owner step
- **THEN** a small PR with the ticked task list is opened and merged on GitHub, and the console shows the step Done within about a minute, with no terminal step

#### Scenario: Owner's checkout untouched
- **WHEN** a planning write lands while the owner has the base branch checked out with uncommitted edits
- **THEN** the owner's local base branch and working files are unchanged

#### Scenario: Base moved
- **WHEN** another PR changed the same task list after the write was made
- **THEN** the write is made again on the new base, and after it merges both changes are on the base branch

### Requirement: Landing is shown
While a write's PR is open, the card that started it SHALL show that it is landing, with a link to the PR, and SHALL NOT ask again. It SHALL show Done once the PR merged, also when the owner merged it on GitHub. While required checks run, the write SHALL merge once they pass, with no second click.

#### Scenario: Waiting for required checks
- **WHEN** the base branch requires checks and the owner clicks Done on an owner step
- **THEN** the card shows it is waiting for checks, with the PR link, and the step shows Done once the checks pass and the PR merged

### Requirement: A blocked write is kept
When the merge fails or is refused (failed checks, a required review, a closed PR, a conflict that cannot be redone, GitHub or the network failing), the card SHALL say why in one line, link the PR, and offer Retry and Cancel. The write SHALL be kept, also across a restart, until it merges or the owner cancels it.

#### Scenario: Review required
- **WHEN** GitHub refuses the merge because the base branch needs an approving review
- **THEN** the card says a review is needed, links the PR and offers Retry and Cancel, and the step is not shown Done

#### Scenario: Restart while waiting
- **WHEN** Counterpoint restarts while a write's PR waits for checks
- **THEN** after the restart the card still shows the write landing, and it merges when the checks pass

#### Scenario: Cancel
- **WHEN** the owner picks Cancel on a write whose PR cannot merge
- **THEN** the PR is closed, the base branch is unchanged, and the card is back as it was before the click

### Requirement: Local-only hosts write locally
A planning write for a host read from its local base branch, because it has no remote, SHALL commit to that local branch, one write at a time.

#### Scenario: Host with no remote
- **WHEN** a host has no remote and the owner clicks Done on an owner step
- **THEN** the step is ticked on the local base branch and shows Done
