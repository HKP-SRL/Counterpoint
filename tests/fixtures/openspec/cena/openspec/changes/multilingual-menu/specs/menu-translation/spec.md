## ADDED Requirements

### Requirement: Venue languages
The system SHALL let an owner or manager enable the set of languages a venue's menu supports.

#### Scenario: Owner enables languages
- **WHEN** an owner enables Hungarian, English and Romanian for a venue
- **THEN** those three languages are available for the venue's menu content

### Requirement: Author in one primary language
The system SHALL let an owner author all menu content in one primary language without having to fill the others.

#### Scenario: Publish authored in one language
- **WHEN** an owner writes the menu only in Hungarian
- **THEN** the menu can be saved and published with Hungarian content

### Requirement: One-button AI pre-fill
The system SHALL let an owner trigger, with one action, an AI translation that pre-fills every other enabled language for the menu content.

#### Scenario: Pre-fill all languages
- **WHEN** an owner of a venue with Hungarian primary and English and Romanian enabled presses the translate action
- **THEN** English and Romanian content is filled for every item and category and marked as machine translation

### Requirement: Owner edits lock translations
The system SHALL keep every AI translation editable, and SHALL never overwrite a translation the owner has edited or confirmed when AI translation runs again.

#### Scenario: Edited translation survives re-translation
- **WHEN** an owner edits the English name of a dish and later triggers translation again
- **THEN** the edited English name is unchanged and only unlocked machine translations are refreshed
