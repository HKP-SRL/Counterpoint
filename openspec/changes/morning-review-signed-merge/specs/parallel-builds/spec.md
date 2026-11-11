# parallel-builds Spec Delta

## Purpose
Several changes build at once without passing gates against each other's servers or data, and builds keep up with the owner's own pushes to the base branch.

## ADDED Requirements

### Requirement: Isolated resources per worktree
Each build worktree SHALL get its own ports and its own database, so no gate passes against another worktree's server or data. Tests that need exclusive resources SHALL run under the one shared test lock.

#### Scenario: Two changes run e2e
- **WHEN** two changes run their e2e gates in the same hour
- **THEN** each talks only to its own server and database

### Requirement: Rebase on a moved base
When the base branch moves and conflicts with a build, the builder SHALL rebase onto the new base, resolve the conflict, and re-run every gate; if it cannot, the change SHALL park in Needs You. The owner's pushed changes SHALL never be dropped.

#### Scenario: Owner pushes a conflicting edit
- **WHEN** the owner pushes to the base branch a change that conflicts with a build
- **THEN** the build rebases, re-runs every gate, and either goes green or parks, and the owner's commit is in its history
