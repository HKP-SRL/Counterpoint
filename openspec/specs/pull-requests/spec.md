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
The PR body SHALL be generated from the change's artifacts (title, why, tasks) and SHALL list every decision the builder assumed.

#### Scenario: Assumed decision
- **WHEN** the builder proceeded on an assumption during the build
- **THEN** the PR body lists it under assumed decisions

### Requirement: Preview link
Each PR SHALL carry a preview link: the host's own preview deploy when one exists, otherwise a local preview Counterpoint serves for that worktree on loopback with its own port.

#### Scenario: Host has preview deploys
- **WHEN** the host's PR receives a preview deployment
- **THEN** the PR and the run report link to it

#### Scenario: No preview deploys
- **WHEN** the host has no preview deploy
- **THEN** Counterpoint serves a loopback preview of the worktree and links to it
