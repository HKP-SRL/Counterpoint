## Purpose
An owner account holds one or more venues, each with its own name, currency, languages, country and timezone, and the owner can create, find and switch between their venues from the dashboard.

## ADDED Requirements

### Requirement: A venue can be created with a locked last language
The system SHALL submit the language the owner cannot remove — the last enabled language, shown checked and disabled on the venue form — together with the rest of the form, so a venue whose currency seeds a single language, such as EUR seeding English only, can be created without the owner touching the language controls.

#### Scenario: EUR venue with default languages
- **WHEN** an owner picks EUR on the venue form and submits without changing the languages
- **THEN** the venue is created with its enabled languages exactly `["en"]`

#### Scenario: The refusal stays visible
- **WHEN** only one language remains enabled on the venue form
- **THEN** its checkbox stays checked and disabled, so the owner can see it cannot be removed

### Requirement: The venue switcher shows a newly created venue at once
The system SHALL refresh the dashboard layout after a venue is created and before redirecting to it, so the venue switcher lists the new venue without a manual reload.

#### Scenario: Switcher after creation
- **WHEN** an owner who already has a venue creates another one
- **THEN** the dashboard they land on lists the new venue in the venue switcher

#### Scenario: Refresh precedes the redirect
- **WHEN** venue creation succeeds
- **THEN** the dashboard layout is refreshed before the redirect is issued
