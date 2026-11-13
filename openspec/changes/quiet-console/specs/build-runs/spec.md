# build-runs Spec Delta

## MODIFIED Requirements

### Requirement: Start and stop a run from the console
The owner SHALL start a run from the Home page's run row. Run SHALL build every change on the runway that can build now, in build order, until they are done. A menu on the row SHALL let the owner pick which changes to build and a stop time. While the run goes, its row SHALL say what it is building and how many changes are left, with Stop. The run SHALL use the project's run settings at the moment it starts and SHALL record them with the run. The CLI SHALL offer the same start and stop. Starting and stopping SHALL require the console session or the control token.

#### Scenario: Budget shown as tokens
- **WHEN** the owner sets the budget to 40% on a model with a 1M-token window
- **THEN** the run settings show "40% of 1M = 400k tokens"

#### Scenario: Start from the home
- **WHEN** three changes can build and the owner clicks Run on the home's run row
- **THEN** the run starts on all three in build order, and the row shows what it is building and how many are left

#### Scenario: Start from the console
- **WHEN** the owner picks two of the three changes and a stop time in the run row's menu, and starts the run
- **THEN** the run builds only those two, its row shows each change's progress, and it stops at a clean point by the stop time

#### Scenario: Agent tries to start a run
- **WHEN** an agent session sends a start request without the console session or the control token
- **THEN** the request is refused
