# pull-requests Specification

## Purpose
Every finished change becomes its own pull request on the host repository, with a body generated from the change's artifacts and a preview link the owner can try quickly.

## Requirements

### Requirement: One PR per change
When every gate passes for a change, Counterpoint SHALL push its branch and open one PR against the base branch using the owner's existing `gh` login, storing no GitHub token of its own.

#### Scenario: Green change
- **WHEN** a change's last attempt passes every gate
- **THEN** a PR for that change's branch is opened against the base branch

### Requirement: Generated PR body
The PR body SHALL be generated from the change's artifacts (title, why, tasks) and SHALL list every decision the builder assumed. It SHALL also say what share of the change's added lines is tests, and name every existing test file the change edited or deleted.

#### Scenario: Assumed decision
- **WHEN** the builder proceeded on an assumption during the build
- **THEN** the PR body lists it under assumed decisions

#### Scenario: Existing test edited
- **WHEN** the build edited one existing test file and added three new ones
- **THEN** the PR body gives the test share and names the one edited file

### Requirement: Short PR body
The PR body SHALL read at a glance: it SHALL lead with the preview link, a summary of the change's why in a few lines, the gate results and the test share in a line each, and the first three assumed decisions with how many more there are. The full list of assumed decisions, the edited test files, the gate table and the task list SHALL follow in one collapsed section.

#### Scenario: Long proposal and many decisions
- **WHEN** a change's proposal is long, its task list has 150 tasks and the builder assumed eight decisions
- **THEN** the PR body opens with the preview link, a few lines of why, the gates, the test share and three decisions, and everything else is in a collapsed section

### Requirement: Preview link
Each PR SHALL say how to preview the change: the host's own preview deploy when one exists; otherwise, when the host config names a preview command, a link to a console page where the owner starts and stops a local preview of the change's worktree on loopback; otherwise "Preview: none" with the reason. A local preview SHALL run as the owner, like a gate, only while the owner wants it and Counterpoint runs.

#### Scenario: Host has preview deploys
- **WHEN** the host's PR receives a preview deployment
- **THEN** the PR and the run report link to it

#### Scenario: No preview deploys
- **WHEN** the host has no preview deploy and its config names a preview command
- **THEN** the PR links to the change's preview page in the console, and pressing Start there serves the change's worktree on a loopback port

#### Scenario: Nothing to preview with
- **WHEN** the host has no preview deploy and its config names no preview command
- **THEN** the PR says "Preview: none" and why

#### Scenario: Counterpoint crashed with a preview running
- **WHEN** Counterpoint is killed while a local preview runs, and the owner starts it again
- **THEN** the old preview is ended, and the preview page offers Start again
