# planning-writes Spec Delta

## Purpose
One serialized path for every write Counterpoint makes to the host's planning files, so parallel builds never conflict on planning bookkeeping and approvals are never invalidated by accident.

## ADDED Requirements

### Requirement: Single serialized write path
Every write Counterpoint makes to the host's planning files (decisions, backlog items, approvals, bookkeeping such as ticking tasks or archiving a change) SHALL go through one serialized path that commits one write at a time.

#### Scenario: Two writes at once
- **WHEN** two builds finish at the same moment and both need bookkeeping
- **THEN** the writes land one after the other as separate commits

### Requirement: Builds never write planning files directly
A build worktree's commits SHALL NOT change the host's planning files; a PR whose diff touches them SHALL be flagged and not offered for merge.

#### Scenario: Builder edits a proposal
- **WHEN** a builder commits a change to `openspec/changes/<name>/proposal.md` in its worktree
- **THEN** the change is flagged and its PR is not offered for merge
