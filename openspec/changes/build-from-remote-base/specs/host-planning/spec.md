# Spec Delta

## ADDED Requirements

### Requirement: Base branch read from the remote
Counterpoint SHALL read a host's base branch as it is on the remote the base branch tracks, else `origin`. The change list, change statuses, approvals, the runway, builds and the host config SHALL all use that one base. Commits on the local base branch that are not on the remote SHALL NOT be listed or built, and the console SHALL say how many there are.

#### Scenario: Local base branch behind the remote
- **WHEN** a PR merges on GitHub and the owner's local base branch is 2 commits behind the remote
- **THEN** within about a minute the console shows the base with that merge, and the next build starts from it, with no terminal step

#### Scenario: Unpushed local commit
- **WHEN** the owner commits a new change to the local base branch and does not push it
- **THEN** the change is not listed, and the console says the local base branch has 1 commit that is not on the remote

### Requirement: Fetching leaves the owner's checkout alone
Getting the remote's base branch SHALL update only the repository's remote-tracking branch for it, as a plain fetch does. It SHALL NOT change the owner's local branches, the checked-out branch, the index or any working file.

#### Scenario: Owner mid-edit
- **WHEN** the owner has uncommitted edits and an unpushed commit on the local base branch, and Counterpoint fetches
- **THEN** the local base branch, the checked-out branch and every working file are unchanged

### Requirement: When the base is fetched
Counterpoint SHALL fetch the base branch at each run start, at each change's build start, and about once a minute while it runs. Approving and withdrawing SHALL NOT wait for a fetch. A change resumed after a crash SHALL keep the base its build started from.

#### Scenario: Merge during a run
- **WHEN** the owner merges a PR on GitHub while change A builds
- **THEN** change B, built next in the same run, starts from the base with that merge

#### Scenario: Approve while offline
- **WHEN** the owner clicks Approve while the remote cannot be reached
- **THEN** the change is on the runway at once, recorded at the base the console shows

### Requirement: A failed fetch never stops work
When a fetch fails (no network, expired credentials, the remote down), Counterpoint SHALL use the base as last fetched. It SHALL NOT end a run, park a change or ask the owner for anything because of it. The console SHALL show when the base was last fetched and why the latest fetch failed, until a fetch succeeds. The run report SHALL name each change built from a base that could not be fetched at its build start.

#### Scenario: Remote unreachable at a build start
- **WHEN** the fetch at a change's build start fails
- **THEN** the change builds from the base as last fetched, the run goes on, and the run report says that change used the base fetched at that earlier time

#### Scenario: Fetch works again
- **WHEN** a fetch succeeds after failing
- **THEN** the console note about the failed fetch goes away

### Requirement: Hosts with no remote
A host whose base branch has no remote, or whose remote has no branch of that name, SHALL be read from its local base branch, and the console SHALL say it is local only.

#### Scenario: Repository with no remote
- **WHEN** a host repository has no remote
- **THEN** its changes are read from the local base branch and the console shows that the host is local only

## MODIFIED Requirements

### Requirement: Live refresh from the base branch
When the base-branch tip on the remote moves, the change list, statuses and runway SHALL refresh in the console within about a minute without a reload, and within a few seconds of Counterpoint fetching it.

#### Scenario: Owner commits a new change
- **WHEN** a new change directory reaches the base branch on the remote, pushed or merged through a PR on GitHub
- **THEN** it appears in the console within about a minute, without a reload and without the owner pulling

### Requirement: Change statuses
Each change SHALL show one status derived at read time, in this precedence: Unreadable; Built (archived, every task checked, or its latest build PR merged); On runway (the owner approved it); Ready to approve (a proposal and at least one task); otherwise Not ready, with the reason (no proposal or no tasks). Only Ready to approve changes SHALL offer approval, and only On runway changes SHALL offer withdrawing it.

#### Scenario: Missing tasks
- **WHEN** a change has a proposal but no tasks.md
- **THEN** it shows Not ready with the reason that it has no tasks, and no approve action

#### Scenario: Every task checked
- **WHEN** every task in an unarchived change's tasks.md is checked
- **THEN** it shows Built and is not offered for approval

#### Scenario: Approved change edited
- **WHEN** an On runway change's proposal is edited on the base branch
- **THEN** it still shows On runway
