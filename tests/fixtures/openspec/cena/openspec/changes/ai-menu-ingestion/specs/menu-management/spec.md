## ADDED Requirements

### Requirement: Publishing respects the unverified-AI gate
Publishing a menu SHALL be refused while any AI-filled allergen or macro field in it is unconfirmed, regardless of how the publish is triggered.

#### Scenario: Direct publish call
- **WHEN** a publish is requested through the API for a menu with an unconfirmed AI-filled macro field
- **THEN** the database refuses the publish
