# approvals Specification

## Purpose
How the owner says "build this": one click in the console puts a change on the runway, and one click takes it off again.

## Requirements

### Requirement: Approve in one click
The console SHALL offer Approve on every Ready to approve change, and one action that approves every ready change together. An approval SHALL take effect at once, with no terminal step, key or passphrase. It SHALL record the change, the time and the base-branch commit it was given at.

#### Scenario: Approve one change
- **WHEN** the owner clicks Approve on a Ready to approve change
- **THEN** the change shows On runway and the Mission headline goes up by one, without a reload

#### Scenario: Approve all
- **WHEN** three changes are Ready to approve and the owner clicks Approve all
- **THEN** all three are on the runway

### Requirement: Approval stays with the change
An approval SHALL stay valid when the change's planning files or the host's gate config change afterwards. A build SHALL use the change as committed at the base-branch tip when the build starts. An approval SHALL end only when the change is built or the owner withdraws it.

#### Scenario: Plan revised after approval
- **WHEN** the owner revises an approved change's tasks and commits them to the base branch
- **THEN** the change stays on the runway and its next build uses the revised tasks

### Requirement: Withdraw in one click
The console SHALL offer Withdraw on every On runway change. A withdrawn change SHALL leave the runway at once and show Ready to approve again.

#### Scenario: Withdraw before a run
- **WHEN** the owner withdraws an approved change that is not building
- **THEN** the runway drops by one and the change offers Approve again

### Requirement: Approvals outlast restarts
Approvals SHALL be kept across daemon restarts and Counterpoint upgrades.

#### Scenario: Restart
- **WHEN** Counterpoint restarts with two changes on the runway
- **THEN** both are still on the runway

### Requirement: Earlier approvals carry over
On the first start after the upgrade, an open change that has an approval file from an earlier version at the base-branch tip SHALL be recorded as approved. After that, approval files in a host repository SHALL have no effect.

#### Scenario: Signed approval from before the upgrade
- **WHEN** the base-branch tip holds an earlier approval file for an open change and the upgraded Counterpoint starts for the first time
- **THEN** that change is on the runway without the owner approving it again

#### Scenario: Approval file added later
- **WHEN** a commit adds an approval file for another change after the upgrade
- **THEN** that change is not approved by it
