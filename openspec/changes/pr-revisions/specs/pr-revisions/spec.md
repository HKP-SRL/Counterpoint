# pr-revisions Spec Delta

## Purpose
After the runway clears a change and its PR is open, the owner gets the change right without writing code: revision notes go back to the builder as rounds in the change's own worktree, every gate re-runs, and the PR updates.

## ADDED Requirements

### Requirement: Owner revision notes
The owner SHALL be able to write revision notes in Counterpoint on a change whose PR is open or that has parked: pinned to an element of the change's preview, or as a general note on the change in the console. Notes SHALL collect in a batch until the owner sends them as one revision round.

#### Scenario: Two notes, one round
- **WHEN** the owner pins one note on the preview, writes one general note, and sends the batch
- **THEN** one revision round starts with both notes

#### Scenario: Notes on a parked change
- **WHEN** the owner sends a note on a parked change explaining what its failing gate needs
- **THEN** a revision round starts in that change's worktree with the note

### Requirement: Pins on the change's preview
Counterpoint SHALL serve a local preview of each open change's worktree on a loopback origin isolated from the console, with an in-house pin overlay injected in a Shadow DOM. A pin SHALL record the element's anchor (its `data-cp-id`, else a generated selector), a text snippet, the viewport and the page.

#### Scenario: Pin a built screen
- **WHEN** the owner clicks a card on the preview and pins "too much padding"
- **THEN** a note with that element's anchor joins the change's batch

### Requirement: Pins stay anchored across rounds
A pin SHALL stay anchored across rounds through `data-cp-id`, falling back to text matching, and SHALL show as detached rather than disappear when no anchor is found.

#### Scenario: Element gone after a round
- **WHEN** a round removes the pinned element
- **THEN** the pin shows as detached in the console

### Requirement: Only the owner starts a round
A revision round SHALL start only when the owner sends the batch from the console with the owner credential. Pins made on the preview origin SHALL be listed in the console's batch before sending, because that origin runs agent-written code. Text written by agents, including comments on the host's PR, council cards and persona findings, SHALL NOT start a round or join a batch on its own.

#### Scenario: Comment on the PR
- **WHEN** a comment on the change's PR asks for a change
- **THEN** no revision round starts

#### Scenario: Pin created by preview code
- **WHEN** script in the preview creates a pin the owner did not make
- **THEN** it appears in the console's batch list and nothing builds until the owner sends the batch

### Requirement: Revision in the change's own worktree
A round SHALL run in fresh builder sessions in the change's existing worktree and branch, with the notes, the change's artifacts and the PR's diff as context, and SHALL change only what the notes ask. The sandbox, context budget, protected-path check and zero-test guard SHALL apply exactly as in a build, whatever the notes say.

#### Scenario: Label note
- **WHEN** the only note asks to rename a button from "Chat" to "Message owner"
- **THEN** the round's commits change that label and the tests that check it

#### Scenario: Note asks to change a test
- **WHEN** a round edits an existing test file because a note asked for it
- **THEN** the protected-path check flags the change exactly as it would for a build

### Requirement: Every gate re-runs
After a round, every gate SHALL re-run on the new head. Counterpoint SHALL push the branch only when every gate passes. A failing round SHALL get the usual bounded retries and then park with its reason, and the PR SHALL keep its last green head.

#### Scenario: Round breaks a gate
- **WHEN** a round's head fails the unit gate on every attempt
- **THEN** the round parks with the failing output and the PR still points at its last green head

### Requirement: Notes outside the change are flagged
A note that asks for behaviour outside the change's proposal and specs SHALL be flagged to the owner with a reason instead of built. The owner SHALL be able to send it again marked as in scope, or file it as a backlog item.

#### Scenario: New feature in a note
- **WHEN** a note on a menu-layout change asks for online payments
- **THEN** the round does not build it and the note is flagged as outside the change

#### Scenario: Owner overrides the flag
- **WHEN** the owner sends a flagged note again marked as in scope
- **THEN** the next round builds it

### Requirement: Round history
Each round SHALL be recorded with its notes, which notes it addressed or flagged, its commits and its gate results. The PR body and the run report SHALL list the rounds.

#### Scenario: Second round
- **WHEN** a change has had two rounds
- **THEN** its PR body lists both rounds with their notes and outcomes

### Requirement: The owner's round goes first
A round the owner sends SHALL take the next free build slot ahead of queued changes. Usage-limit pauses SHALL still apply to it.

#### Scenario: Round sent during a day run
- **WHEN** the owner sends a round while two changes wait in the queue
- **THEN** the round starts in the next free build slot, before either of them
