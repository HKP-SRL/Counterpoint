# daemon-lifecycle Spec Delta

## ADDED Requirements

### Requirement: Stop never signals an unrelated process
When the control channel does not answer, `counterpoint stop` SHALL signal a process only after confirming it is the Counterpoint daemon recorded by the current start; stale run records SHALL be cleared at daemon start.

#### Scenario: Stale record after a crash
- **WHEN** a crashed daemon left a record naming a pid now used by another program
- **THEN** `counterpoint stop` does not signal that program

### Requirement: Stop Counterpoint from the console
The owner SHALL be able to stop the daemon from the console with a guarded request; a running build run SHALL first stop at its next clean point.

#### Scenario: Stop with a run going
- **WHEN** the owner stops Counterpoint from the console during a run
- **THEN** the run stops at its next clean point, its report is written, and then the daemon exits
