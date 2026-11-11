## ADDED Requirements

### Requirement: Ingest a menu from a photo
The system SHALL let an owner upload a photo of a physical menu and SHALL extract a structured draft of categories, items, prices and descriptions.

#### Scenario: Photo of a paper menu
- **WHEN** an owner uploads a photo of a two-page paper menu
- **THEN** a draft menu with its categories, items, prices and descriptions is created for review

### Requirement: Ingest a menu from a PDF
The system SHALL let an owner upload a PDF menu and SHALL extract a structured draft.

#### Scenario: PDF menu
- **WHEN** an owner uploads a PDF of their menu
- **THEN** a draft menu is created from it for review

### Requirement: Resumable background extraction with progress
Extraction SHALL run as a resumable background job that shows the owner its progress, and a failure on one part SHALL NOT fail the whole extraction.

#### Scenario: Owner watches progress
- **WHEN** an extraction of a large menu is running
- **THEN** the owner sees its progress and can leave and come back to it

#### Scenario: One section fails
- **WHEN** one page of a menu cannot be extracted
- **THEN** the rest of the draft is still produced and the failed part is reported for retry or manual entry

### Requirement: AI-filled fields marked unverified
The system SHALL attempt allergens and macros where inferable, and SHALL visibly mark every AI-filled field as unverified until the owner confirms it.

#### Scenario: Inferred allergens shown as unverified
- **WHEN** the AI infers that a dish contains milk
- **THEN** the milk allergen is shown on the draft with the unverified marker

### Requirement: Dedicated correction interface
The system SHALL provide a correction interface where the owner reviews and edits the extracted draft before anything is published.

#### Scenario: Owner corrects a price
- **WHEN** an owner corrects a misread price in the correction interface
- **THEN** the corrected value is saved and no longer marked unverified

### Requirement: Publish blocked until allergens and macros confirmed
A menu containing any AI-filled allergen or macro field that the owner has not explicitly confirmed SHALL NOT be publishable; each such field SHALL require its own confirmation.

#### Scenario: Unconfirmed allergen blocks publish
- **WHEN** an owner tries to publish a menu with one unconfirmed AI-filled allergen
- **THEN** publishing is refused and the unconfirmed field is pointed out

#### Scenario: All confirmed
- **WHEN** the owner confirms every AI-filled allergen and macro field
- **THEN** the menu can be published

### Requirement: Manual entry is a complete alternative
The system SHALL let an owner build a complete menu by hand without using ingestion.

#### Scenario: Owner skips ingestion
- **WHEN** an owner declines ingestion and builds the menu manually
- **THEN** every menu capability is available and the menu can be published
