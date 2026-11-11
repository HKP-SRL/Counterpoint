# merge-approval Spec Delta

## Purpose
Nothing reaches the host's base branch without the owner's own signature: a merge is a `--no-ff` merge commit of the exact PR head, signed at a terminal and verified from git every time.

## ADDED Requirements

### Requirement: Summary before signing
Before a merge can be signed, the console and the merge command SHALL show the change's summary: its PR, gate results, preview link, protected-path flags and every assumption the builder proceeded on.

#### Scenario: Assumptions listed
- **WHEN** the builder proceeded on two assumed decisions
- **THEN** both are listed in the summary before the owner signs

### Requirement: Signed merge of the exact PR head
The owner SHALL approve a merge by signing, at a terminal with the trusted approval key, a `--no-ff` merge commit whose second parent is the exact PR head commit shown in the summary. Signing SHALL use the same clean-environment path and integrity check as runway approvals.

#### Scenario: Owner signs the merge
- **WHEN** the owner runs the prepared merge command and enters the passphrase
- **THEN** a signed merge commit of the shown PR head is created, Counterpoint pushes it, and the PR shows as merged

### Requirement: Head moved means no merge
If the PR head moves after the summary was prepared or after signing, the merge SHALL NOT be pushed; the owner SHALL be asked to review and sign again.

#### Scenario: Builder pushes after review
- **WHEN** a new commit lands on the PR branch after the owner opened the summary
- **THEN** the old merge is refused and a fresh summary is required

### Requirement: Nothing merges without a verified signature
Counterpoint SHALL push a merge only when it verifies, from git at that moment, an owner-signed merge commit for the pinned key whose parents are the current base tip and the approved head. Approval state SHALL never be trusted from a stored flag.

#### Scenario: Unsigned merge commit
- **WHEN** a merge commit without the owner's signature exists for a PR
- **THEN** Counterpoint does not push it and the PR stays open

### Requirement: Cleanup after merge
After a verified merge is pushed, Counterpoint SHALL remove the change's worktree and branch and record bookkeeping through the planning-write path.

#### Scenario: Merged change
- **WHEN** a change's signed merge is pushed
- **THEN** its worktree and local branch are gone and the change shows as merged
