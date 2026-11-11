# daemon-lifecycle Spec Delta

## ADDED Requirements

### Requirement: Stop never signals an unrelated process
When the control channel does not answer, `counterpoint stop` SHALL signal a process only after confirming it is the Counterpoint daemon recorded by the current start; stale run records SHALL be cleared at daemon start.

#### Scenario: Stale record after a crash
- **WHEN** a crashed daemon left a record naming a pid now used by another program
- **THEN** `counterpoint stop` does not signal that program
