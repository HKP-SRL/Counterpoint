## ADDED Requirements

### Requirement: Printable per-table QR codes
The system SHALL let an owner or manager generate a QR code for each table of a venue and print it.

#### Scenario: Owner prints table QR codes
- **WHEN** an owner defines tables 1 to 12 and chooses to print their QR codes
- **THEN** a printable sheet with one QR code per table, labelled with its table, is produced

### Requirement: Scanning opens the venue's published menu
Scanning a table QR code SHALL open the correct venue's published menu in a mobile browser with nothing to install, and SHALL carry the table's identity.

#### Scenario: Diner scans a table code
- **WHEN** a diner scans the QR code on table 7 of a venue
- **THEN** that venue's published menu opens in the phone's browser and the table is identified as table 7

#### Scenario: Codes never cross venues
- **WHEN** a diner scans a QR code generated for venue A
- **THEN** venue A's menu opens, never another venue's
