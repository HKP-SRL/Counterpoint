# needs-you Spec Delta

## ADDED Requirements

### Requirement: Parked changes in Needs You
A change that parks after N failed attempts SHALL appear in Needs You with its last failing gate output and its attempt history.

#### Scenario: Parked change
- **WHEN** a change parks during a run
- **THEN** Needs You shows it with the failing gate's last lines and every attempt

### Requirement: Run-stopping errors in Needs You
An error that stops a run (authentication, credit or spend limit) SHALL appear in Needs You with what the owner needs to do.

#### Scenario: Spend limit reached
- **WHEN** a run stops on a spend-limit error
- **THEN** Needs You shows the error and that the run is stopped
