# runway Spec Delta

## REMOVED Requirements

### Requirement: Runway is the Mission headline
**Reason**: The Mission page is replaced by the Home page, which shows one line per waiting item instead of a headline card.
**Migration**: The number of changes that can build now shows in the home's run row, the runway's size in the "All clear" line (Requirement: Runway on the home), and the changes on the runway, each with Withdraw, are listed on Changes.

## ADDED Requirements

### Requirement: Runway on the home
The Home page's run row SHALL show how many changes can build now: changes on the runway that are not held for sign-off, not waiting for a dependency, and without an open PR from their latest green build. The "All clear" line SHALL show the runway's size, held and waiting changes included. Both figures SHALL follow approvals and withdrawals without a reload and SHALL NOT change color. Changes SHALL list the changes on the runway, each with Withdraw.

#### Scenario: First approval
- **WHEN** the owner approves the first change into an empty runway and no run is going
- **THEN** the Home page shows "1 change can build now" with Run, without a reload

#### Scenario: Held change not counted
- **WHEN** two changes are on the runway and one of them is held for sign-off
- **THEN** the run row says 1 change can build now

#### Scenario: Withdraw from Changes
- **WHEN** the owner clicks Withdraw on the Changes page on a runway change that could build now
- **THEN** the change leaves the runway and the run row's figure goes down by one
