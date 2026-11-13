# runway Spec Delta

## REMOVED Requirements

### Requirement: Runway is the Mission headline
**Reason**: The Mission page is replaced by the Home page, which shows one line per waiting item instead of a headline card.
**Migration**: The runway's size shows on the Home page (Requirement: Runway on the home), and the changes on the runway, each with Withdraw, are listed on Changes.

## ADDED Requirements

### Requirement: Runway on the home
The Home page SHALL show the runway's size: in the run row ("3 changes ready to build") when changes can build, and in the "All clear" line otherwise. The figure SHALL follow approvals and withdrawals without a reload and SHALL NOT change color. Changes SHALL list the changes on the runway, each with Withdraw.

#### Scenario: First approval
- **WHEN** the owner approves the first change into an empty runway and no run is going
- **THEN** the Home page shows "1 change ready to build" with Run, without a reload

#### Scenario: Withdraw from Changes
- **WHEN** the owner clicks Withdraw on a runway change on the Changes page
- **THEN** the change leaves the runway and the home's figure goes down by one
