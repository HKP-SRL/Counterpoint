# needs-you Spec Delta

## ADDED Requirements

### Requirement: PRs awaiting a signed merge
A change whose PR is green and ready SHALL appear in Needs You as awaiting the owner's signed merge, linking to its summary.

#### Scenario: Green PR
- **WHEN** a change's PR passes every gate
- **THEN** Needs You lists it as ready for a signed merge
