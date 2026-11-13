# pull-requests Spec Delta

## MODIFIED Requirements

### Requirement: Generated PR body
The PR body SHALL be generated from the change's artifacts (title, why, tasks) and SHALL list every decision the builder assumed. It SHALL also say what share of the change's added lines is tests, and name every existing test file the change edited or deleted.

#### Scenario: Assumed decision
- **WHEN** the builder proceeded on an assumption during the build
- **THEN** the PR body lists it under assumed decisions

#### Scenario: Existing test edited
- **WHEN** the build edited one existing test file and added three new ones
- **THEN** the PR body gives the test share and names the one edited file
