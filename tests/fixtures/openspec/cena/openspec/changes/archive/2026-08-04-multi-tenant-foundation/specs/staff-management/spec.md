## Purpose
Owners give their staff a personal identity without email or login: a named profile with a 4-digit PIN, provisioned and deactivated from the owner dashboard, stored so the PIN cannot be read back.

## ADDED Requirements

### Requirement: Owner provisions staff PIN profiles
The system SHALL let a venue's owner add a staff member to that venue with a name and a 4-digit PIN, with no email address or individual login, and SHALL allow two staff members of the same venue to share a PIN.

#### Scenario: Adding a staff member
- **WHEN** the owner adds "Ana" with PIN 1234 on the staff page
- **THEN** Ana appears on the venue's staff list with an Active badge

#### Scenario: Shared PIN
- **WHEN** the owner adds a second staff member with the same PIN as an existing one
- **THEN** both profiles exist and each verifies with that PIN when chosen by name

### Requirement: Only the venue owner manages staff
The system SHALL refuse staff provisioning and deactivation from anyone other than the venue's owner, including another venue's owner, the venue's own tablet session and unauthenticated callers, and SHALL give the same refusal for a profile that does not exist as for one at another venue.

#### Scenario: Another venue's owner provisions staff
- **WHEN** the owner of Venue B calls staff provisioning for Venue A directly
- **THEN** the call is refused and no profile is created at Venue A

#### Scenario: The venue's tablet provisions staff
- **WHEN** Venue A's tablet session calls staff provisioning for Venue A directly
- **THEN** the call is refused

#### Scenario: No existence oracle on deactivation
- **WHEN** a non-owner deactivates a real profile at another venue and then a random non-existent profile id
- **THEN** both calls fail with an identical error message

### Requirement: PINs are stored hashed and never served
The system SHALL store staff PINs only as salted hashes, SHALL serve the tablet's staff list as id and name without any PIN material, and SHALL return no staff profile rows, and therefore no hashes, to anyone but the venue's owner.

#### Scenario: Tablet reads the staff list
- **WHEN** the venue's tablet session requests the staff list for PIN entry
- **THEN** it receives ids and names of active staff and no PIN hash

#### Scenario: Tablet selects the profile table directly
- **WHEN** the venue's tablet session selects staff profiles, including the hash column, through the client API
- **THEN** no rows are returned

### Requirement: Deactivation keeps history
The system SHALL let the owner deactivate a staff member, after which that person's PIN stops working at once, they disappear from the tablet's name list, and their profile stays on record with a Deactivated badge so past attribution remains intact; adding the person again SHALL create a new profile.

#### Scenario: Deactivating a staff member
- **WHEN** the owner confirms "Deactivate Ana?"
- **THEN** Ana's PIN is refused on the tablet, Ana is no longer on the name grid, and the owner's staff list still shows Ana as Deactivated
