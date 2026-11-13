# runway Spec Delta

## ADDED Requirements

### Requirement: Transient errors do not pin the runway
A verification that fails for a transient reason (such as a git or ssh-keygen timeout) SHALL NOT be cached; the next read SHALL verify again even if the base tip has not moved.

#### Scenario: Timeout under load
- **WHEN** one verification times out and the next read happens at the same base tip
- **THEN** the approval is verified again and the change returns to the runway if valid

### Requirement: Uncommitted-edits hint runs no repository program
The check behind the uncommitted-edits hint SHALL NOT run any content filter, hook or other program configured by the host repository; a covered file that a filter applies to SHALL show as edited and not checkable.

#### Scenario: Clean filter configured
- **WHEN** the host's attributes assign a clean filter to a covered file
- **THEN** the hint check runs no filter and shows the file as not checkable
