# owner-steps Spec Delta

## Purpose
A step the plan reserves for the owner (an `Owner:` task) reaches the owner as a card, and Counterpoint does the step for them when they say yes and it can.

## ADDED Requirements

### Requirement: Owner steps are cards
Every unchecked `Owner:` step of a change that is planned or on the runway SHALL appear in Needs You as a card with the step's text, the options Done and Later, and Do it for me where Counterpoint can perform the step. Answering Done SHALL tick the step through the planning-write path, matched by the step's full text however long it is, and the step SHALL show Done once that write's small PR merged.

#### Scenario: A long step
- **WHEN** the owner marks Done on an owner step of 400 characters
- **THEN** that step is ticked like any other

#### Scenario: Step done by hand
- **WHEN** the owner marks an owner step Done
- **THEN** the card shows the tick landing with a link to its small PR, and the step shows Done once that PR merged

#### Scenario: Tick cannot merge
- **WHEN** the tick's PR cannot be merged
- **THEN** the card says why and offers Retry, and the step is not shown Done

### Requirement: Owner-step cards ask only when the step can be done
An owner step listed after an open build task in the change's task list SHALL wait for the build: it SHALL be no card until the change is built. Because Done and Land it merge to the base branch, Later SHALL be the recommended option on owner-step and Land it cards. Do it for me SHALL NOT be offered for a step whose named paths are all under `.git/` or `.claude/`, which a result may never touch.

#### Scenario: Step after the build
- **WHEN** a change on the runway has "Owner: after the build, use it for a day" listed after open build tasks
- **THEN** Needs You shows no card for it until the change is built

#### Scenario: Enter on an owner-step card
- **WHEN** the owner presses `Enter` on an owner-step card
- **THEN** the card is put off as Later and nothing is ticked

### Requirement: Do it for me
For a step Counterpoint can perform, picking Do it for me SHALL run the step in a worktree of the base branch, never the owner's checkout. It SHALL run as the owner, as builder sessions do. The result SHALL then be shown on a second card with its diff and the options Land it, Discard and Later, with Later recommended. A result MAY change files under `.counterpoint/`, since the owner sees the diff before it lands; it SHALL NOT change files under `.git/` or `.claude/`.

#### Scenario: A step for Counterpoint's own config
- **WHEN** the owner picks Do it for me on "Owner: land `.counterpoint/design-rules.md`"
- **THEN** the Land it card shows the new file, and Land it lands it

#### Scenario: Approve and install a package version
- **WHEN** the owner answers "Approve Astryx 0.7.12 and install it" on a supply-chain step card
- **THEN** Counterpoint installs the exact pinned versions in its own worktree and shows the changed manifest and lockfile on a Land it card

### Requirement: Land it
Only Land it SHALL put an owner-step result on the base branch, together with the step's tick, through one small PR that the same click merges. If the base changed so that the shown diff no longer applies, nothing SHALL land and the card SHALL offer Do it again. If only the step itself changed in the plan (reworded or ticked), the result SHALL still land, without the tick, and the card SHALL say so.

#### Scenario: Nothing lands without the owner
- **WHEN** an owner-step result is waiting on its Land it card
- **THEN** the base branch is unchanged until the owner picks Land it

#### Scenario: Land it
- **WHEN** the owner picks Land it on the Astryx result
- **THEN** one small PR with exactly the shown diff and the ticked step is opened and merged, and the step shows Done once it merged

#### Scenario: Base moved under the result
- **WHEN** the base changed the same files after the result was made
- **THEN** nothing lands, and the card says so and offers Do it again on the new base
