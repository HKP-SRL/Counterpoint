# council-seats Spec Delta

## Purpose
The council is a set of role seats defined per host; this capability covers how seats are declared and keeps council work out of the way of the build lane.

## ADDED Requirements

### Requirement: Seats in per-host config
Seats (name, role, and the evidence and tools each may use) SHALL be defined in the host's Counterpoint config. Sensible defaults SHALL ship, and adding a seat SHALL be a config edit only.

#### Scenario: Add a seat
- **WHEN** the owner adds a "Waiter" seat to the host's config and commits it
- **THEN** the Waiter seat is available to the council without other changes

### Requirement: Seats differ by evidence and tools
Each seat SHALL receive only the evidence and tools its definition grants (for example the tech seat reads the diff), not just a different persona prompt.

#### Scenario: Customer seat
- **WHEN** a customer-voice seat reviews a change
- **THEN** it gets the screens and fixtures its definition lists and not the code diff

### Requirement: Council never blocks
Approving, drafting and building SHALL never wait on council work.

#### Scenario: Council busy during approval
- **WHEN** the council is still working on a change's cards and the owner approves it
- **THEN** the approval proceeds without waiting
