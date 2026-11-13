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
Items SHALL be ordered by kind: a stopped run; cards that block work; other questions; green PRs; drafts waiting for the owner; changes ready to approve; changes ready to build; a run in progress. Within a kind, the oldest SHALL come first. When an item is resolved, the next one SHALL move up without a reload.

#### Scenario: Stopped run comes first
- **WHEN** a run stopped on a sign-in problem while a green PR waits
- **THEN** the top line is the stopped run with what fixes it, and the PR is in the queue

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

### Requirement: One line per row
Every queue row SHALL be one line: what it is and its actions. Details, such as a gate's output, attempts, a question's why or a PR's assumed decisions, SHALL open on click and SHALL NOT be shown on the row.

#### Scenario: Parked change in the queue
- **WHEN** a parked change is in the queue
- **THEN** its row shows the change and its options on one line, and its failing gate's output opens on click

### Requirement: History behind one control
The Home page SHALL open, from one control in its header, the Answered list and the "Done for you" list. Neither list SHALL be shown on the home itself.

#### Scenario: See what was done for you
- **WHEN** Counterpoint refreshed the login environment without asking and the owner opens History from Home
- **THEN** "Done for you" lists the refresh, and the home itself shows no trace of it

### Requirement: All clear
With nothing waiting, the home SHALL show one line, "All clear", with the runway's size and a link to Changes.

#### Scenario: Nothing waits
- **WHEN** no card is open, no PR is green, no change is ready to approve or build, and no run is going
- **THEN** the home shows only "All clear", the runway's size and a link to Changes
