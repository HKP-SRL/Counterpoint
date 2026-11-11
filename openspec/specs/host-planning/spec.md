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
Each change SHALL show one status derived at read time, in this precedence: Unreadable; Built (archived, or every task checked); On runway or Changed since signed (from its approval); Ready to approve (a proposal and at least one task); otherwise Not ready, with the reason (no proposal or no tasks). Only Ready to approve and Changed since signed changes SHALL offer approval.

#### Scenario: Missing tasks
- **WHEN** a change has a proposal but no tasks.md
- **THEN** it shows Not ready with the reason that it has no tasks, and no approve action

#### Scenario: Every task checked
- **WHEN** every task in an unarchived change's tasks.md is checked
- **THEN** it shows Built and is not offered for approval

### Requirement: Change detail
The console SHALL show a change's detail page with its title, why, dependencies, artifacts, task progress, owner steps (unchecked tasks whose text starts with `Owner:`), base-branch tip, approval state, and every file an approval would cover with a short digest.

#### Scenario: Open a ready change
- **WHEN** the owner opens a Ready to approve change
- **THEN** the page lists the covered files with 12-hex digests and offers `Approve change`

#### Scenario: Owner step present
- **WHEN** a ready change has an unchecked task `Owner: create the Supabase project`
- **THEN** the detail page and the approval summary show it prominently, and the change can still be approved

### Requirement: Live refresh from the base branch
When the base-branch tip moves, the change list, statuses and runway SHALL refresh in the console within a few seconds without a reload.

#### Scenario: Owner commits a new change
- **WHEN** the owner commits a new change directory to the base branch
- **THEN** it appears in the console within a few seconds

### Requirement: Framework adapter boundary
Core SHALL reach the planning framework only through the adapter port. An import rule SHALL fail the build when core imports an adapter, and only the composition root may import one.

#### Scenario: Core imports the adapter
- **WHEN** a core module imports from an adapter folder
- **THEN** lint fails and the package build stops
