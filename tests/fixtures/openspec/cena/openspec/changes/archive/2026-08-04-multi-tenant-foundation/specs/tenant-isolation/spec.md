## Purpose
No venue's data reaches another venue's principals, and the staff role can change nothing but item availability, enforced in the database for every caller of the client API and proven by a role-by-venue test suite.

## ADDED Requirements

### Requirement: Cross-venue data is invisible and unwritable
The database SHALL return zero rows from every venue-scoped table to any principal that is not a member of the venue concerned, and SHALL refuse that principal's updates and deletes, so that an owner or tablet of one venue can neither read nor change another venue's accounts, venues, memberships, staff profiles, devices or items.

#### Scenario: Owner of Venue B reads Venue A
- **WHEN** Venue B's owner selects from each venue-scoped table through the client API
- **THEN** no Venue A row is returned

#### Scenario: Tablet of Venue B writes to Venue A
- **WHEN** Venue B's tablet session attempts to update a Venue A row in any venue-scoped table
- **THEN** the write is denied and a service-side re-read shows the row unchanged

### Requirement: Unauthenticated callers reach nothing
The database SHALL return no tenant rows to an unauthenticated caller holding only the public API key, and SHALL refuse that caller every tenant function, including the availability toggle and staff provisioning.

#### Scenario: Anonymous read
- **WHEN** an unauthenticated caller selects from every tenant table
- **THEN** every result is empty

#### Scenario: Anonymous toggle
- **WHEN** an unauthenticated caller invokes the availability toggle
- **THEN** the call is refused

### Requirement: Inserts and deletes go through checked functions only
The database SHALL refuse direct inserts and deletes on every tenant table from every signed-in principal, including owners, so that venues, memberships, staff profiles and devices are created and removed only through server functions that re-check the caller's identity and role.

#### Scenario: Owner deletes a row directly
- **WHEN** a venue's owner sends a direct delete for one of their own venue's rows in any tenant table
- **THEN** the delete is denied

#### Scenario: Owner promotes a membership directly
- **WHEN** an owner sends a direct update setting a membership's role to owner
- **THEN** the update is denied

#### Scenario: Owner flags a device revoked by hand
- **WHEN** an owner sends a direct update setting a device's revoked timestamp
- **THEN** the update is denied, because revocation happens only through the revoke action

### Requirement: Staff can only change item availability
The database SHALL give the staff role no direct update on venue items, SHALL let a staff session of the item's venue flip only an item's availability through the narrow availability function, and SHALL refuse staff writes to prices, content and venue settings.

#### Scenario: Staff marks an item sold out
- **WHEN** a Venue A tablet session flips an item at Venue A to unavailable through the availability function
- **THEN** the item becomes unavailable and nothing else about it changes

#### Scenario: Staff edits a price directly
- **WHEN** the same tablet session sends a direct update of that item's price
- **THEN** the update is denied and the price is unchanged

#### Scenario: Staff flips availability directly
- **WHEN** the same tablet session sends a direct update of the item's availability column
- **THEN** the update is denied, because the function is the only staff write path

#### Scenario: Staff renames the venue
- **WHEN** the tablet session sends a direct update of the venue's name
- **THEN** the update is denied

### Requirement: Availability changes are attributed and leak nothing
The availability function SHALL record which active staff profile of the item's venue made a change, or record the change as unattributed when none is given, SHALL refuse the whole change when the named profile is deactivated or from another venue, and SHALL give the identical response for an authorized no-op, an unknown item and another venue's item.

#### Scenario: Attributed toggle
- **WHEN** Ana's staff session flips an item's availability
- **THEN** the item records Ana's profile as the last to toggle it

#### Scenario: Foreign or deactivated profile
- **WHEN** a toggle names a staff profile from another venue or a deactivated profile
- **THEN** neither the availability nor the attribution changes

#### Scenario: Probing for items
- **WHEN** a staff session toggles an item at another venue and an id that does not exist
- **THEN** both responses are byte-identical to a successful no-op and nothing changes

#### Scenario: Concurrent toggles
- **WHEN** two staff toggle the same item at the same moment
- **THEN** the item ends in one consistent state whose availability and attribution come from the same call

### Requirement: Owners have full write access to their own venue
The database SHALL let a venue's owner read every row of their venue and change the venue's name, currency and languages and every item's price and availability, so that the limits placed on staff never apply to the owner.

#### Scenario: Owner edits venue settings and prices
- **WHEN** Venue A's owner renames the venue, changes its currency and languages, and changes an item's price through the client API
- **THEN** every change lands

### Requirement: Tablet sessions see only what they need
The database SHALL let a venue's tablet session read its venue and that venue's items, SHALL show it only its own membership row and never the owner's identity, and SHALL return it no account rows, no staff profile rows and no device registry rows.

#### Scenario: Tablet reads memberships
- **WHEN** Venue A's tablet session selects memberships
- **THEN** only its own membership row is returned

#### Scenario: Tablet reads the registry
- **WHEN** Venue A's tablet session selects device registry rows, including its own
- **THEN** no rows are returned

### Requirement: Owner dashboard is limited to the venue's owner
The system SHALL answer every page under a venue's dashboard with not-found for any signed-in principal that is not that venue's owner, including the venue's own tablet session, and SHALL send a tablet or staff session that opens the owner dashboard back to the tablet screen.

#### Scenario: The venue's own tablet opens the venue dashboard
- **WHEN** Venue A's tablet session requests Venue A's dashboard page
- **THEN** a not-found page is returned with none of the venue's name, currency, languages, country or timezone

#### Scenario: Another owner types a venue URL
- **WHEN** Venue B's owner opens the URL of Venue A's dashboard
- **THEN** a not-found page is returned
