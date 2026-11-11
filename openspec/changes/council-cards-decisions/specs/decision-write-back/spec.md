# decision-write-back Spec Delta

## Purpose
Council outcomes become part of the host's planning truth: decisions and backlog items are written through the framework adapter and committed, never kept only in Counterpoint.

## ADDED Requirements

### Requirement: Decisions written into the change's design
A decision picked on a card SHALL be written into the Decisions section of the change's design.md (creating it if absent) through the adapter and committed through the serialized planning-write path, with a minimal diff that leaves the rest of the file byte-identical.

#### Scenario: Minimal diff
- **WHEN** a decision is written into an existing design.md
- **THEN** the commit adds only the decision entry and changes no other line

### Requirement: Backlog items written into the host's backlog
A backlog item from the council SHALL be written into the host's backlog through the adapter and committed through the serialized planning-write path.

#### Scenario: Rework after merge
- **WHEN** a rework backlog item is filed
- **THEN** it is committed to the host's backlog and visible in the host's planning
