# needs-you Specification

## Purpose
Needs You is the owner's single inbox for things only the owner can resolve; today it receives approved changes whose content changed after signing, each with a review view that reads like a pull request.

## Requirements

### Requirement: One inbox
The console SHALL have one Needs You inbox listing items newest first, each with an icon, a title and a detail line, shown with a count in the navigation and the browser tab title. Items SHALL resolve themselves when their cause goes away; there is no manual dismiss for recomputed items.

#### Scenario: Count badge
- **WHEN** two items are in Needs You
- **THEN** the navigation shows 2 and the tab title starts with `(2)`

### Requirement: Approved version changed
When an approved change's covered content or the gate config changes on the base branch, it SHALL leave the runway and appear in Needs You under a visible `Approved version changed` label. A gate-config change SHALL appear as its own row.

#### Scenario: Proposal edited after signing
- **WHEN** a commit on the base branch edits the proposal of a change on the runway
- **THEN** the runway drops by one and Needs You shows that the change changed since it was signed

#### Scenario: Mission warning
- **WHEN** any approved change is Changed since signed
- **THEN** the Mission page shows a warning above the runway linking to Needs You

### Requirement: Change view reads like a PR review
Each approved-version-changed item SHALL open a view that lists the changed files (Modified, Added or Removed, with signed and current digests), shows git's diff between the content at the approval's recorded base commit and the base tip now, and gives the one-line re-sign command.

#### Scenario: Review the diff
- **WHEN** the owner opens the item
- **THEN** each changed file shows its diff as plain text and the re-sign command is shown

### Requirement: Self-resolving items
An approved-version-changed item SHALL disappear when the change is re-signed or its content returns to the signed state.

#### Scenario: Revert without re-signing
- **WHEN** the owner reverts the edit on the base branch
- **THEN** the item disappears and the change is back on the runway

#### Scenario: Re-sign
- **WHEN** the owner runs the re-sign command
- **THEN** the item disappears and the runway goes back up

### Requirement: Parked changes in Needs You
A change that parks after N failed attempts SHALL appear in Needs You with its last failing gate output and its attempt history.

#### Scenario: Parked change
- **WHEN** a change parks during a run
- **THEN** Needs You shows it with the failing gate's last lines and every attempt

### Requirement: Run-stopping errors in Needs You
An error that stops a run (authentication, credit or spend limit) SHALL appear in Needs You with what the owner needs to do.

#### Scenario: Spend limit reached
- **WHEN** a run stops on a spend-limit error
- **THEN** Needs You shows the error and that the run is stopped
