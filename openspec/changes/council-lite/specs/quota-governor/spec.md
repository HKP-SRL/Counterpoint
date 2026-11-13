# quota-governor Spec Delta

## Purpose
One governor shares the owner's agent usage between lanes: work the owner is waiting on comes first, and the council can never starve a build.

## ADDED Requirements

### Requirement: Owner-waiting work, then builds, then a capped council share
The governor in front of every agent spawn SHALL order spawns: first work the owner is waiting on (a revision round, or a draft round the owner just asked for), then builds, then council work capped to a configured share. Council work SHALL wait or be dropped rather than exceed its share.

#### Scenario: Owner asks for variants during a day run
- **WHEN** the owner asks for new draft variants while two build tasks wait for a slot
- **THEN** the draft round starts before either build task

#### Scenario: Council at its cap during a run
- **WHEN** council spend reaches its share while a build is running
- **THEN** further council spawns wait and the builder keeps running
