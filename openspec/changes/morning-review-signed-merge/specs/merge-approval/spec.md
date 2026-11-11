# merge-approval Spec Delta

## Purpose
Nothing reaches the host's base branch without the owner's own signature: a merge is a `--no-ff` merge commit of the exact PR head, approved with the owner's passkey in the console and verified from git every time.

## ADDED Requirements

### Requirement: Summary before signing
Before a merge can be approved, the console SHALL show the change's summary: its PR, gate results, preview link, protected-path flags, every assumption the builder proceeded on, and every revision round with its notes.

#### Scenario: Assumptions listed
- **WHEN** the builder proceeded on two assumed decisions
- **THEN** both are listed in the summary before the owner signs

#### Scenario: Revision rounds listed
- **WHEN** a change went through two revision rounds
- **THEN** the summary lists both rounds, their notes and any flagged notes before the owner signs

### Requirement: Signed merge of the exact PR head
The owner SHALL approve a merge with the pinned passkey over a merge statement naming the change, the base tip and the exact PR head shown in the summary, using the same signature rules and integrity check as runway approvals. Counterpoint SHALL then create a `--no-ff` merge commit with those two parents that carries the statement and the owner's signature.

#### Scenario: Owner signs the merge
- **WHEN** the owner clicks Merge under the summary and confirms with Touch ID
- **THEN** a merge commit of the shown PR head carrying the owner's signature is created, Counterpoint pushes it, and the PR shows as merged

### Requirement: Head moved means no merge
If the PR head moves after the summary was prepared or after signing, the merge SHALL NOT be pushed; the owner SHALL be asked to review and sign again.

#### Scenario: Builder pushes after review
- **WHEN** a new commit lands on the PR branch after the owner opened the summary
- **THEN** the old merge is refused and a fresh summary is required

### Requirement: Nothing merges without a verified signature
Counterpoint SHALL push a merge only when it verifies, from git at that moment, a merge commit whose parents are the current base tip and the approved head and that carries a merge statement naming those two commits with a passkey signature that counts for the pinned credential. Approval state SHALL never be trusted from a stored flag.

#### Scenario: Unsigned merge commit
- **WHEN** a merge commit without a valid owner signature exists for a PR
- **THEN** Counterpoint does not push it and the PR stays open

#### Scenario: Base moved after the touch
- **WHEN** another merge lands on the base branch after the owner approved this one
- **THEN** the signed statement names the old base tip, nothing is pushed, and the owner is asked to approve again

### Requirement: Cleanup after merge
After a verified merge is pushed, Counterpoint SHALL remove the change's worktree and branch and record bookkeeping through the planning-write path.

#### Scenario: Merged change
- **WHEN** a change's signed merge is pushed
- **THEN** its worktree and local branch are gone and the change shows as merged
