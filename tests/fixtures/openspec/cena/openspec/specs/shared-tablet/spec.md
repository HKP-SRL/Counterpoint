# shared-tablet Specification

## Purpose
A venue's in-restaurant tablet becomes a trusted staff device that the owner enrols, can unlock for full access, and can revoke remotely, while staff identify themselves on it by tapping their name and entering their PIN.

## Requirements

### Requirement: Owner enrols a tablet as a staff device
The system SHALL let an owner signed in on a tablet turn it into a staff device for a chosen venue under a device name, after which the tablet holds a venue-scoped staff session backed by its own provisioned, non-anonymous account, appears in the venue's device registry, and shows the PIN screen.

#### Scenario: Enabling staff mode
- **WHEN** the owner, signed in on a tablet, enables staff mode for Venue A with the name "Bar"
- **THEN** the tablet shows Venue A's staff name grid and "Bar" is listed as Active in Venue A's device registry
- **AND** the tablet's session has the staff role at Venue A only

#### Scenario: Re-enrolling under the same name
- **WHEN** a tablet is enrolled at Venue A under a name that already has an active device
- **THEN** the previous device is revoked and only the new one is active under that name

### Requirement: Staff identify by name then PIN
The system SHALL show the tablet a grid of the venue's active staff, and when a staff member taps their name and enters their correct PIN, SHALL start a signed staff session of at most 30 minutes that attributes their actions to their profile; a wrong PIN SHALL be refused with "Wrong PIN. Try again."

#### Scenario: Correct PIN
- **WHEN** Ana taps her name and enters her PIN
- **THEN** a staff session attributed to Ana starts on the tablet

#### Scenario: Wrong PIN
- **WHEN** Ana taps her name and enters a wrong PIN
- **THEN** the tablet shows "Wrong PIN. Try again." and no staff session starts

#### Scenario: Caller from another venue
- **WHEN** a session that is not a member of the profile's venue submits that profile's correct PIN
- **THEN** the answer is a plain refusal, indistinguishable from a wrong PIN

### Requirement: Escalating PIN backoff
The system SHALL allow two wrong PINs per profile without delay and then lock that profile for 2 seconds, doubling with each further wrong PIN up to a 300-second cap, SHALL refuse even the correct PIN while locked, SHALL show the remaining time as a countdown, and SHALL keep enforcing the lock however many wrong attempts accumulate.

#### Scenario: Third wrong PIN
- **WHEN** a third consecutive wrong PIN is entered for a profile
- **THEN** that profile is locked for 2 seconds and the tablet shows "Too many attempts. Try again in 2s."

#### Scenario: Correct PIN while locked
- **WHEN** the correct PIN is entered while the profile is locked
- **THEN** it is refused

#### Scenario: Long brute-force run
- **WHEN** a profile has accumulated 32 or more wrong attempts and another wrong PIN arrives
- **THEN** the attempt is refused without error, the counter advances, and the profile is locked for 300 seconds

### Requirement: Remote revoke
The system SHALL let the owner revoke an enrolled tablet from the device registry, after which the tablet's session is denied on its very next request even while holding an unexpired token, its credentials and refresh no longer work, and the revoked tablet stays listed with a Revoked badge and no revoke control.

#### Scenario: Revoking a lost tablet
- **WHEN** the owner confirms "Revoke this device?" for the tablet "Bar"
- **THEN** the next query from that tablet's existing session returns nothing from Venue A
- **AND** "Bar" stays in the registry marked Revoked

### Requirement: Enrolment stays reachable
The system SHALL show the "Enable staff mode" link on the device registry page whatever the registry holds, including when it holds only revoked tablets and when it already holds an active one.

#### Scenario: Only a revoked tablet listed
- **WHEN** the owner opens the devices page of a venue whose only tablet has been revoked
- **THEN** the "Enable staff mode" link is shown below the revoked row

#### Scenario: An active tablet listed
- **WHEN** the venue already has an active tablet
- **THEN** the "Enable staff mode" link is still shown so a second tablet can be enrolled

### Requirement: Owner unlock on the tablet
The system SHALL let an owner sign in with their own account on an enrolled tablet to get full access, SHALL return the tablet to the PIN screen when the owner exits owner mode or after 3 idle minutes, and SHALL keep the tablet's staff-device identity across that round trip.

#### Scenario: Unlock and exit
- **WHEN** the owner unlocks the tablet, works in the dashboard, then chooses "Exit owner mode"
- **THEN** the tablet is back on the PIN screen as the same enrolled device

#### Scenario: Walking away
- **WHEN** the tablet is left in owner mode with no interaction for 3 minutes
- **THEN** the owner session ends and the tablet returns to the PIN screen

### Requirement: Tablet identity survives transient faults
The system SHALL clear a browser's tablet identity only when the device registry has been read successfully and shows the browser is no longer an active tablet, and SHALL keep the identity when that read fails, while still ending any owner session on the tablet.

#### Scenario: Registry read fails on exit
- **WHEN** the owner exits owner mode and the device registry read fails, even ten times in a row
- **THEN** the owner is signed out and the tablet still holds its device identity, needing no re-enrolment

#### Scenario: Device genuinely revoked
- **WHEN** the registry read succeeds and shows no active device for this tablet
- **THEN** the tablet's device and staff identities are cleared

### Requirement: Local un-enrolment
The system SHALL let a browser that holds a tablet identity drop it locally with "Stop using this browser as a tablet", without revoking the device on the server, so the device stays listed for the owner to revoke.

#### Scenario: Un-enrolling a browser
- **WHEN** someone on a revoked or unwanted tablet chooses "Stop using this browser as a tablet"
- **THEN** the browser no longer acts as a tablet and the device's registry row is unchanged
