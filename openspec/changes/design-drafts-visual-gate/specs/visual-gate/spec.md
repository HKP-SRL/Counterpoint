# visual-gate Spec Delta

## Purpose
A gate that holds the build to the signed-off design: built screens are compared with the signed full render by landmark regions, and drift fails the gate with evidence.

## ADDED Requirements

### Requirement: Structural comparison against the signed render
For each screen with a signed-off full render, the visual gate SHALL render the built screen in the same viewport and states and compare its landmark regions (elements with `data-cp-id`) with the render's. The verdict SHALL come from this comparison only; any vision-model review is advisory.

#### Scenario: Landmark missing
- **WHEN** a built screen lacks a landmark region the signed render has
- **THEN** the visual gate fails

### Requirement: Drift evidence
A failing visual gate SHALL attach a side-by-side image of the signed render and the built screen with the drifting regions marked.

#### Scenario: Region moved
- **WHEN** a landmark region moves beyond tolerance
- **THEN** the gate fails with a side-by-side image marking that region

### Requirement: No visual gate without a reference
A change with no signed-off render SHALL skip the visual gate, and its gate row SHALL say there is no reference.

#### Scenario: Backend-only change
- **WHEN** a change has no drafts
- **THEN** the visual gate shows as not applicable

### Requirement: Revisions that change a signed screen
When a revision note deliberately changes a screen with a signed-off render, the round SHALL produce an updated render for the owner to sign. Until the owner signs it, the visual gate SHALL keep comparing against the previous signed render.

#### Scenario: Owner moves a button
- **WHEN** a revision note moves a landmark button on a signed screen
- **THEN** an updated render waits for the owner's signature, and the gate passes against it once signed
