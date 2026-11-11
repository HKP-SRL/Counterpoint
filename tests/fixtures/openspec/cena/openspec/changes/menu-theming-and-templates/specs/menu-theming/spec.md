## ADDED Requirements

### Requirement: Choose a menu template
The system SHALL let an owner or manager choose one of a curated set of templates for a venue's diner menu, and the live diner menu SHALL render in the chosen template.

#### Scenario: Owner switches template
- **WHEN** an owner selects a different template and publishes
- **THEN** diners see the menu rendered in that template

### Requirement: Guardrailed brand controls
The system SHALL let an owner or manager set a colour palette, a font pairing, a logo and a cover image within predefined guardrails, and SHALL reject values outside them.

#### Scenario: Owner applies brand settings
- **WHEN** an owner picks a palette, a font pairing and uploads a logo and cover image
- **THEN** the diner menu shows them

#### Scenario: Staff cannot change branding
- **WHEN** a staff member attempts to change brand settings
- **THEN** the change is refused

### Requirement: Templates hold up at any photo count
Every template SHALL render as intentional with zero item photos, some photos, or a full set, with no empty image slots.

#### Scenario: Zero, some and full photos
- **WHEN** each template is rendered for a menu with no photos, a menu with some photos and a menu with all photos
- **THEN** all three render without empty image placeholders and pass the visual review

### Requirement: Brand choices cannot break legibility
No combination of brand-control values SHALL produce a text/background pair below WCAG AA 4.5:1 on the diner menu.

#### Scenario: Low-contrast palette rejected
- **WHEN** an owner chooses colours that would put text below 4.5:1 on its background
- **THEN** the choice is rejected or corrected before it can be published

#### Scenario: Automated sweep
- **WHEN** the contrast guardrail test runs over every template and every allowed palette
- **THEN** it reports zero pairs below 4.5:1
