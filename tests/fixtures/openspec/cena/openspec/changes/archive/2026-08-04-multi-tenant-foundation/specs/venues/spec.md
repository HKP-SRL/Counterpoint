## Purpose
An owner account holds one or more venues, each with its own name, currency, languages, country and timezone, and the owner can create, find and switch between their venues from the dashboard.

## ADDED Requirements

### Requirement: Venue creation
The system SHALL let an owner create a venue with a name, a currency of RON, HUF or EUR, one or more enabled languages from Romanian, Hungarian and English, a default language that is one of the enabled ones, and an optional country and timezone, and SHALL make the creating owner the venue's owner.

#### Scenario: First venue during signup
- **WHEN** a new owner submits the venue form with a name, currency RON and Romanian enabled
- **THEN** the venue exists under their account with the owner as its owner member
- **AND** the owner lands on that venue's dashboard

#### Scenario: Unsupported currency
- **WHEN** a venue is submitted with a currency outside RON, HUF and EUR
- **THEN** creation is refused and no venue is stored

### Requirement: Country and timezone derive from the currency
The system SHALL pre-fill country and timezone from the chosen currency (RON gives Romania and Europe/Bucharest, HUF gives Hungary and Europe/Budapest), SHALL leave both blank for EUR, and SHALL let the owner override or clear them before submitting.

#### Scenario: RON venue
- **WHEN** the owner picks RON on the venue form
- **THEN** country shows RO and timezone shows Europe/Bucharest

#### Scenario: EUR venue
- **WHEN** the owner picks EUR on the venue form
- **THEN** country and timezone stay blank and the venue can be created without them

### Requirement: Venue values are constrained by the database
The database SHALL refuse any venue whose name is blank, whose currency is not RON, HUF or EUR, whose enabled languages are empty or include a code other than ro, hu or en, whose default language is not enabled, or whose country is neither empty nor a two-letter upper-case code, whichever client wrote it.

#### Scenario: Direct write with an unsupported language
- **WHEN** an owner updates their venue through the client API to enable a language code outside ro, hu and en
- **THEN** the write is refused and the stored languages are unchanged

#### Scenario: Malformed country code
- **WHEN** a venue is written with country "Romania"
- **THEN** the write is refused

### Requirement: One owner account holds many venues
The system SHALL let one owner account own several venues, SHALL keep venues with identical names as distinct venues, and SHALL keep each venue attached to the account that created it for its whole life, refusing any change of a venue's owning account by any caller, including the service role.

#### Scenario: Two venues with the same name
- **WHEN** an owner creates two venues with byte-identical names
- **THEN** both exist as separate venues under the same account

#### Scenario: Moving a venue to another account
- **WHEN** any caller, including the service role, updates a venue's owning account
- **THEN** the update is refused and the venue stays with its original account

### Requirement: Another venue can always be created from the dashboard
The system SHALL offer a "Create venue" entry in the owner dashboard that is shown regardless of how many venues the owner already has, leading to a venue creation page from which the owner lands on the new venue.

#### Scenario: Owner with one venue adds a second
- **WHEN** an owner who already has a venue follows "Create venue" and submits the form
- **THEN** a second venue is created under the same account and the owner lands on its dashboard

### Requirement: Venue switcher
The system SHALL show a venue switcher in the dashboard once the owner has two or more venues, listing only venues the signed-in owner owns, in creation order with ties broken by venue id, marking the current venue, and including an entry to create another venue.

#### Scenario: Single venue
- **WHEN** an owner with exactly one venue opens the dashboard
- **THEN** no switcher is shown

#### Scenario: Several venues
- **WHEN** an owner with three venues opens the switcher
- **THEN** it lists those three venues in creation order, marks the current one, and lists no other owner's venue

### Requirement: Venue landing
When an owner opens the venues landing page, the system SHALL redirect them to their earliest-created venue (ties broken by venue id), SHALL show the first-venue form when they have no venues, and SHALL show an error screen rather than the first-venue form when the venues cannot be read.

#### Scenario: Owner with venues
- **WHEN** an owner with venues opens the venues landing page
- **THEN** they are redirected to the same earliest-created venue on every visit

#### Scenario: Read fault on the landing page
- **WHEN** the venues read fails with a database error
- **THEN** the owner sees the "This page didn't load" screen with a retry control and is not invited to create a venue

### Requirement: Dashboard read faults are reported, not disguised
The system SHALL show the owner dashboard's error screen, with a retry control and without exposing database error details, when a venue, staff roster or device registry read fails, and SHALL NOT present such a failure as a missing venue or an empty list.

#### Scenario: Venue read fails
- **WHEN** the owner opens their venue's dashboard and the venue read fails
- **THEN** the error screen "This page didn't load" is shown instead of a not-found page

#### Scenario: Device registry read fails
- **WHEN** the device registry read fails
- **THEN** the error screen is shown instead of "No devices enrolled"

### Requirement: Stable order for positional list reads
The system SHALL return every venue, staff and device list that the product picks from by position in a total order, with ties on the primary sort broken by ascending id, so repeated reads with tied timestamps give the same result.

#### Scenario: Venues created in the same instant
- **WHEN** two venues of one owner share the same creation timestamp
- **THEN** the switcher order and the landing redirect target are the same on every read
