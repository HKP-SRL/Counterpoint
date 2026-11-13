# console-home Spec Delta

## Purpose
The host's home page is the owner's inbox: the one thing that needs them most, on one line with its buttons, and below it everything else waiting, one line each.

## ADDED Requirements

### Requirement: Home is the inbox
The host's home page SHALL show everything waiting for the owner on one page: the most urgent item as the top line, with its actions, and below it the queue of the other items, one line each. There SHALL be no other content on the home.

#### Scenario: A question and a green PR
- **WHEN** a question card is open and one change has a green PR
- **THEN** the home shows the question as the top line and the PR as the one row in the queue

### Requirement: What comes first
Items SHALL be ordered by kind: a stopped run; cards that block work and planning writes that cannot land; other questions; green PRs; drafts waiting for the owner; owner steps and their results; changes ready to approve; changes that can build now; a run in progress. Within a kind, the oldest SHALL come first. A green PR SHALL mean that Counterpoint's gates passed on the change's latest build and its PR is open. When an item is resolved, the next one SHALL move up without a reload.

#### Scenario: Stopped run comes first
- **WHEN** a run stopped on a sign-in problem while a green PR waits
- **THEN** the top line is the stopped run with what fixes it, and the PR is in the queue

#### Scenario: Owner steps after drafts
- **WHEN** an owner step, a finished low-fi round and a green PR are all waiting
- **THEN** the PR comes first, then the drafts, then the owner step

#### Scenario: Next item moves up
- **WHEN** the owner answers the question on the top line
- **THEN** the next item becomes the top line without a reload

### Requirement: Act from the row
Each item SHALL carry its own actions on its line: a question's options, Preview and Merge for a green PR, Open drafts, Approve, Run and Stop. The top line SHALL show what the decision needs: for a question, each option with its consequence and the recommended one preselected. The keyboard SHALL work as in the card inbox (`1`–`4`, `Enter` for the recommended option, `L` for Later) on the focused item. `J` and `K` SHALL move the focus, and the top line SHALL be focused when the home opens.

#### Scenario: Answer from the keyboard
- **WHEN** the owner opens the home with a question on the top line and presses Enter
- **THEN** the recommended option is chosen, and the next item moves up

#### Scenario: Act on a queue row
- **WHEN** the owner presses `J` to focus a ready-to-approve row and presses Enter
- **THEN** the change is approved

### Requirement: Enter never merges
`Enter` SHALL never merge anything on GitHub. On an owner step, an owner-step result or a planning write that cannot land, `Enter` SHALL open the item's details, and Done, Land it, Retry and Cancel SHALL need their digit. A green PR SHALL merge only from its Merge button or its own key.

#### Scenario: Enter on an owner step
- **WHEN** an owner step is focused and the owner presses Enter
- **THEN** the step's details open, and the step is not ticked

#### Scenario: Enter on a green PR
- **WHEN** a green PR's row is focused and the owner presses Enter
- **THEN** its preview opens, and nothing is merged

### Requirement: One line per row
Every queue row SHALL be one line: what it is and its actions. Details, such as a gate's output, attempts, a question's why or a PR's assumed decisions, SHALL open on click and SHALL NOT be shown on the row.

#### Scenario: Parked change in the queue
- **WHEN** a parked change is in the queue
- **THEN** its row shows the change and its options on one line, and its failing gate's output opens on click

### Requirement: Each waiting thing shows once
A change held for sign-off SHALL show as one drafts row with Open drafts, and SHALL count once in the waiting count. A held change's sign-off that cannot land SHALL show on that row with its reason, Retry and Cancel, and not as a row of its own. A change with a green PR SHALL show only as its PR row and SHALL NOT be counted among the changes that can build now.

#### Scenario: Held change
- **WHEN** an approved change waits for its Home screen to be signed off
- **THEN** the home shows one row for it, naming Home, with Open drafts, and the waiting count counts it once

#### Scenario: Green change not counted to build
- **WHEN** a change's PR is green and two other changes can build
- **THEN** the PR has its own row, and the run row says 2 changes can build now

### Requirement: Planning writes that cannot land
A planning write that cannot land SHALL be a row on the home, with the reason in one line, a link to its PR, Retry and Cancel. Planning writes that are landing or waiting for checks SHALL NOT be rows on the home; they SHALL be listed in History with their PR links.

#### Scenario: Review needed
- **WHEN** the PR of an owner step's tick cannot merge because a review is needed
- **THEN** the home shows a row saying a review is needed, with the PR link, Retry and Cancel

#### Scenario: Write landing
- **WHEN** a tick's PR is waiting for checks
- **THEN** the home shows no row for it, and History lists it with its PR link

### Requirement: History behind one control
The Home page SHALL open, from one control in its header, the Answered list, the "Done for you" list and the planning writes that are landing or waiting for checks. None of them SHALL be shown on the home itself.

#### Scenario: See what was done for you
- **WHEN** Counterpoint refreshed the login environment without asking and the owner opens History from Home
- **THEN** "Done for you" lists the refresh, and the home itself shows no trace of it

### Requirement: All clear
With nothing waiting, the home SHALL show one line, "All clear", with the runway's size and a link to Changes. The runway's size SHALL include changes held for sign-off and changes waiting on a dependency.

#### Scenario: Nothing waits
- **WHEN** no card is open, no PR is green, no change is ready to approve or can build now, and no run is going
- **THEN** the home shows only "All clear", the runway's size and a link to Changes
