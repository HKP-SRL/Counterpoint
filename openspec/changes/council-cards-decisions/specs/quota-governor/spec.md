# quota-governor Spec Delta

## Purpose
One governor shares the owner's agent usage between lanes so the council can never starve a build.

## ADDED Requirements

### Requirement: Builder priority and a capped council share
The governor in front of every agent spawn SHALL give the builder priority and cap council spend to a configured share; council work SHALL wait or be dropped rather than exceed it.

#### Scenario: Council at its cap during a run
- **WHEN** council spend reaches its share while a build is running
- **THEN** further council spawns wait and the builder keeps running
