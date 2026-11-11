## MODIFIED Requirements

### Requirement: Enrolment stays reachable
The system SHALL show the "Enable staff mode" action in the device registry page's header, opening the enrolment sheet, whatever the registry holds, including when it holds only revoked tablets and when it already holds an active one.

#### Scenario: Only a revoked tablet listed
- **WHEN** the owner opens the devices page of a venue whose only tablet has been revoked
- **THEN** the "Enable staff mode" action is shown in the page header

#### Scenario: An active tablet listed
- **WHEN** the venue already has an active tablet
- **THEN** the "Enable staff mode" action is still shown so a second tablet can be enrolled
