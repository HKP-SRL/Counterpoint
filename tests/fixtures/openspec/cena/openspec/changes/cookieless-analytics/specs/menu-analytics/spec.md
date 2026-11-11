## ADDED Requirements

### Requirement: Cookieless, non-identifying capture
The system SHALL record diner menu activity without setting cookies or other client storage identifiers and without storing personal identifiers, so that no consent banner is shown to diners.

#### Scenario: No cookies set
- **WHEN** a diner opens a menu and views several items
- **THEN** no cookie or persistent client identifier is set and no consent banner appears

#### Scenario: No personal data stored
- **WHEN** the recorded events are inspected
- **THEN** they contain no IP address, user agent string, account or device identifier

### Requirement: Owner sees aggregate insights
The system SHALL show an owner or manager aggregate dish views, language split and busy hours for a venue they manage, and SHALL not show them to other venues.

#### Scenario: Owner opens insights
- **WHEN** an owner opens the insights screen for their venue
- **THEN** they see dish views, the split of menu views by language and views by hour of day

#### Scenario: Insights are venue-isolated
- **WHEN** a member of venue B queries venue A's analytics
- **THEN** no data is returned
