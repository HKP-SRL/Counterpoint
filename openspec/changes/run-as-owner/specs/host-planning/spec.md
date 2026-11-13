# host-planning Spec Delta

## MODIFIED Requirements

### Requirement: Change statuses
Each change SHALL show one status derived at read time, in this precedence: Unreadable; Built (archived, or every task checked); On runway (the owner approved it); Ready to approve (a proposal and at least one task); otherwise Not ready, with the reason (no proposal or no tasks). Only Ready to approve changes SHALL offer approval, and only On runway changes SHALL offer withdrawing it.

#### Scenario: Missing tasks
- **WHEN** a change has a proposal but no tasks.md
- **THEN** it shows Not ready with the reason that it has no tasks, and no approve action

#### Scenario: Every task checked
- **WHEN** every task in an unarchived change's tasks.md is checked
- **THEN** it shows Built and is not offered for approval

#### Scenario: Approved change edited
- **WHEN** an On runway change's proposal is edited on the base branch
- **THEN** it still shows On runway

### Requirement: Change detail
The console SHALL show a change's detail page with its title, why, dependencies, artifacts, task progress, owner steps (unchecked tasks whose text starts with `Owner:`), base-branch tip and approval state.

#### Scenario: Open a ready change
- **WHEN** the owner opens a Ready to approve change
- **THEN** the page offers `Approve`, and one click approves it

#### Scenario: Owner step present
- **WHEN** a ready change has an unchecked task `Owner: create the Supabase project`
- **THEN** the detail page shows it prominently, and the change can still be approved
