# needs-you Spec Delta

## ADDED Requirements

### Requirement: Builder questions in Needs You
A change that parks because its remaining tasks wait on an ask-first question SHALL appear in Needs You with the builder's question, its options and the option the builder recommends.

#### Scenario: Ask-first question
- **WHEN** a change parks because a task would delete data on a hosted database
- **THEN** Needs You shows the question, its options and the recommended one, and names the tasks that wait on it

## REMOVED Requirements

### Requirement: Approved version changed
**Reason**: An approval now stays with the change when its plan or the gate config is revised, so there is no drift to report.
**Migration**: `approvals`, "Approval stays with the change".

### Requirement: Change view reads like a PR review
**Reason**: It reviewed the difference between the signed and the current content. Nothing is signed.
**Migration**: None. The owner reads a change's history in git or on GitHub.

### Requirement: Self-resolving items
**Reason**: It covered only approved-version-changed items.
**Migration**: "One inbox" still says items resolve themselves when their cause goes away.
