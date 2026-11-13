# host-planning Specification

## Purpose
How Counterpoint reads a host's planning truth: through a framework adapter (OpenSpec first) over committed git content at the base-branch tip, turning the host's OpenSpec changes into the work units the owner browses and approves.

## Requirements

### Requirement: Host detection
Counterpoint SHALL treat a host as an OpenSpec host when `openspec/config.yaml` exists in the commit at the tip of the host's base branch. A host with no supported framework SHALL still register and show that no planning was found.

#### Scenario: OpenSpec host
- **WHEN** the base-branch tip contains `openspec/config.yaml`
- **THEN** the host is read through the OpenSpec adapter

#### Scenario: Config only in the working tree
- **WHEN** `openspec/config.yaml` exists in the owner's checkout but not in the base-branch tip
- **THEN** the host is not treated as an OpenSpec host

### Requirement: Committed content only
The adapter SHALL read planning files only as committed blobs at the base-branch tip, never from the working tree, and SHALL refuse symlinks and oversized files instead of following or loading them.

#### Scenario: Uncommitted edit
- **WHEN** the owner edits a proposal without committing
- **THEN** the change list still shows the committed content

### Requirement: Active changes listed
Counterpoint SHALL list each directory under `openspec/changes/` other than `archive/` as one change, identified by its kebab-case directory name, with: title (the first heading of `proposal.md`, else the name), why (the proposal's `## Why` section), which of proposal, specs, design and tasks are present, and task progress as checked over total checkboxes in `tasks.md`.

#### Scenario: Change with tasks
- **WHEN** `openspec/changes/qr-menu-browsing/` has a proposal titled "QR menu browsing" and a tasks.md with 3 of 8 boxes checked
- **THEN** the change shows as "QR menu browsing" with tasks 3/8 and the artifacts present

#### Scenario: Proposal without a heading
- **WHEN** a change's proposal.md has no heading
- **THEN** the change is titled with its directory name

### Requirement: Dependencies between changes
The adapter SHALL read a change's dependencies from `x-depends-on: [...]` in its `.openspec.yaml`, parsed as data, and show them on the change.

#### Scenario: Dependency listed
- **WHEN** `.openspec.yaml` of `table-ordering` holds `x-depends-on: [qr-menu-browsing]`
- **THEN** `table-ordering` shows that it depends on `qr-menu-browsing`

### Requirement: Archived changes are done
A change archived under `openspec/changes/archive/<date>-<name>/` SHALL show as Built (done), listed after the active changes with the newest first, and SHALL NOT be offered for approval.

#### Scenario: Archived change
- **WHEN** `openspec/changes/archive/2026-11-01-menu-import/` exists
- **THEN** `menu-import` shows with status Built after every active change

### Requirement: Change order
Active changes SHALL be listed with dependencies before their dependents, then by the `created` date in `.openspec.yaml`, then by name. A dependency on an unknown or archived change SHALL count as satisfied for ordering.

#### Scenario: Dependency created later
- **WHEN** change B depends on change A and A was created after B
- **THEN** A is listed before B

### Requirement: Unreadable changes are reported
A change whose files cannot be read or parsed SHALL show as unreadable with the reason, and SHALL NOT be offered for approval.

#### Scenario: Malformed metadata
- **WHEN** a change's `.openspec.yaml` is not valid YAML
- **THEN** the change shows as unreadable with that reason

### Requirement: Change statuses
Each change SHALL show one status derived at read time, in this precedence: Unreadable; Built (archived, every task checked, or its latest build PR merged); Owner steps left; On runway (the owner approved it); Ready to approve (a proposal and at least one task); otherwise Not ready, with the reason (no proposal or no tasks). Only Ready to approve changes SHALL offer approval, and only On runway changes SHALL offer withdrawing it.

#### Scenario: Missing tasks
- **WHEN** a change has a proposal but no tasks.md
- **THEN** it shows Not ready with the reason that it has no tasks, and no approve action

#### Scenario: Every task checked
- **WHEN** every task in an unarchived change's tasks.md is checked
- **THEN** it shows Built and is not offered for approval

#### Scenario: Approved change edited
- **WHEN** an On runway change's proposal is edited on the base branch
- **THEN** it still shows On runway

### Requirement: Only owner steps left
A change with a proposal whose every unchecked task is an owner step SHALL show Owner steps left: there is nothing to build. It SHALL NOT be offered for approval or be on the runway, its owner steps SHALL still be shown, and it SHALL show Built once every task is checked.

#### Scenario: Built outside Counterpoint with owner steps open
- **WHEN** every task of a change is checked on the base branch except two `Owner:` steps
- **THEN** it shows Owner steps left, is not offered for approval and is not on the runway, and its owner steps are still listed

### Requirement: Change detail
The console SHALL show a change's detail page with its title, why, dependencies, artifacts, task progress, owner steps (unchecked tasks whose text starts with `Owner:`), base-branch tip and approval state.

#### Scenario: Open a ready change
- **WHEN** the owner opens a Ready to approve change
- **THEN** the page offers `Approve`, and one click approves it

#### Scenario: Owner step present
- **WHEN** a ready change has an unchecked task `Owner: create the Supabase project`
- **THEN** the detail page shows it prominently, and the change can still be approved

### Requirement: Live refresh from the base branch
When the base-branch tip on the remote moves, the change list, statuses and runway SHALL refresh in the console within about a minute without a reload, and within a few seconds of Counterpoint fetching it.

#### Scenario: Owner commits a new change
- **WHEN** a new change directory reaches the base branch on the remote, pushed or merged through a PR on GitHub
- **THEN** it appears in the console within about a minute, without a reload and without the owner pulling

### Requirement: Framework adapter boundary
Core SHALL reach the planning framework only through the adapter port. An import rule SHALL fail the build when core imports an adapter, and only the composition root may import one.

#### Scenario: Core imports the adapter
- **WHEN** a core module imports from an adapter folder
- **THEN** lint fails and the package build stops

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
