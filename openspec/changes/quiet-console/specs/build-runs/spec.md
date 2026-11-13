# build-runs Spec Delta

## MODIFIED Requirements

### Requirement: Start and stop a run from the console
The owner SHALL start a run from the Home page's run row. Run SHALL build every change that can build now, in build order, until they are done: the changes on the runway that are not held for sign-off, not waiting for a dependency, and without an open PR from their latest green build. A menu on the row SHALL let the owner pick which changes to build and a stop time. While the run goes, its row SHALL say what it is building and how many changes are left, with Stop. The run SHALL use the project's run settings at the moment it starts and SHALL record them with the run. The CLI SHALL offer the same start and stop. Starting and stopping SHALL require the console session or the control token.

#### Scenario: Budget shown as tokens
- **WHEN** the owner sets the budget to 40% on a model with a 1M-token window
- **THEN** the run settings show "40% of 1M = 400k tokens"

#### Scenario: Start from the home
- **WHEN** three changes can build now and the owner clicks Run on the home's run row
- **THEN** the run starts on all three in build order, and the row shows what it is building and how many are left

#### Scenario: Green change not rebuilt
- **WHEN** one runway change has an open PR from a green build, two others can build now, and the owner clicks Run
- **THEN** the run builds only the two, and the green change's PR is left as it is

#### Scenario: Start from the console
- **WHEN** the owner picks two of the three changes and a stop time in the run row's menu, and starts the run
- **THEN** the run builds only those two, its row shows each change's progress, and it stops at a clean point by the stop time

#### Scenario: Agent tries to start a run
- **WHEN** an agent session sends a start request without the console session or the control token
- **THEN** the request is refused

### Requirement: Run settings page
Each project SHALL have a Settings page in the console holding its run settings: model, effort, context budget and per-session limits. Saving SHALL be a guarded POST to the daemon. Until the owner saves, defaults apply. A run SHALL use the settings saved when it starts and keep them until it ends. The Settings page SHALL show the settings a new run will use. The CLI MAY override model, effort and budget for one run.

#### Scenario: Effort set in Settings
- **WHEN** the owner sets the effort to high on the Settings page and starts a run
- **THEN** every builder session of that run launches with effort high, and the run shows it

#### Scenario: Settings changed during a run
- **WHEN** the owner changes the model while a run is going
- **THEN** the running run keeps its model and the next run uses the new one

#### Scenario: Per-session limits
- **WHEN** the owner sets 300 turns, $30 and 6 sessions per attempt
- **THEN** each builder session stops at 300 turns or $30 estimated cost, and the gates run after at most 6 sessions of one attempt
