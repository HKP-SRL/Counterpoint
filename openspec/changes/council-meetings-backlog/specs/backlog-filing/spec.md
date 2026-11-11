# backlog-filing Spec Delta

## Purpose
The council can file what it finds straight into the host's backlog without adding triage work for the owner, while staying bounded and easy to dismiss.

## ADDED Requirements

### Requirement: Council files backlog items
The council SHALL file backlog items straight into the host's backlog through the adapter, each tagged "council" with evidence and a severity, and committed through the serialized planning-write path.

#### Scenario: Root issue found
- **WHEN** a meeting finds a critical issue rooted in an already merged change
- **THEN** a backlog item tagged "council" with its evidence and severity is committed

### Requirement: Deduplicated and capped
Council backlog items SHALL be deduplicated against the existing backlog and capped per meeting.

#### Scenario: Duplicate finding
- **WHEN** a meeting finds an issue that is already in the backlog
- **THEN** no new item is filed
