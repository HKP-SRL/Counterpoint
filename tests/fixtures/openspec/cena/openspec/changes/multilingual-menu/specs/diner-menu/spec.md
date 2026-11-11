## ADDED Requirements

### Requirement: Diner language auto-detected
When a diner opens the menu, the system SHALL show it in the best match between the browser's preferred languages and the venue's enabled languages, falling back to the venue's primary language.

#### Scenario: Romanian browser
- **WHEN** a diner whose browser prefers Romanian opens a menu with Romanian enabled
- **THEN** the menu is shown in Romanian

#### Scenario: Unsupported browser language
- **WHEN** a diner whose browser prefers German opens a menu without German
- **THEN** the menu is shown in the venue's fallback language

### Requirement: Manual language switch
A diner SHALL be able to switch the menu language manually, and the choice SHALL override detection for the rest of the visit.

#### Scenario: Diner switches to English
- **WHEN** a diner selects English in the language switcher
- **THEN** the menu re-renders in English and stays in English while they browse
