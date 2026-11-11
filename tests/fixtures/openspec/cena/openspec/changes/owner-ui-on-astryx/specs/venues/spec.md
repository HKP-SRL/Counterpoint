## MODIFIED Requirements

### Requirement: Venue switcher
The system SHALL show a venue switcher in the dashboard at every venue count — zero, one or many, and when the venue list cannot be read — listing only venues the signed-in owner owns, in creation order with ties broken by venue id, marking the current venue, and ending with an entry to create another venue.

#### Scenario: Single venue
- **WHEN** an owner with exactly one venue opens the switcher
- **THEN** it lists that venue followed by the entry to create another venue

#### Scenario: Several venues
- **WHEN** an owner with three venues opens the switcher
- **THEN** it lists those three venues in creation order, marks the current one, and lists no other owner's venue

#### Scenario: No venues or a failed read
- **WHEN** the owner has no venues, or the venue list cannot be read
- **THEN** the switcher is still shown, headed "Venues", and holds only the entry to create a venue
