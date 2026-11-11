# owner-auth Specification

## Purpose
Restaurant owners create and reach their Cena account on their own: email and password or Google sign-in, recorded agreement to the Terms and Privacy Policy, and a password reset that cannot be replayed or bypassed.

## Requirements

### Requirement: Owner self-serve signup
The system SHALL let a prospective owner create an account with an email address, a password of at least 8 characters and an explicit Terms of Service and Privacy Policy agreement, with no manual help and no email-verification gate, and SHALL take the new owner straight on to creating their first venue in the same flow.

#### Scenario: Signup with the agreement ticked
- **WHEN** a visitor submits the signup form with a new email, an 8-character password and the agreement ticked
- **THEN** an owner account exists for that email
- **AND** the owner is signed in and shown the venue creation form without verifying their email first

#### Scenario: Signup without the agreement
- **WHEN** a visitor submits the signup form without ticking the agreement
- **THEN** signup is refused with a validation message and no account record is created

### Requirement: Consent evidence is recorded once and kept
The system SHALL record on every owner account the Terms version the owner accepted and the time of acceptance, SHALL keep the first accepted version when consent is recorded again for the same account, and SHALL refuse to record consent with a blank version.

#### Scenario: Consent stamped at signup
- **WHEN** an owner completes signup with the agreement ticked
- **THEN** their account carries the current Terms version and an acceptance timestamp

#### Scenario: A second consent call keeps the first version
- **WHEN** consent is recorded again for an account that already has an accepted version
- **THEN** the stored version and timestamp are unchanged and the same account is returned

#### Scenario: Blank version refused
- **WHEN** consent is recorded with an empty version string
- **THEN** the call is refused and no account record is created

### Requirement: Account records are not directly editable
The system SHALL deny every signed-in principal, including the account's own owner, a direct update of an account record, so that consent evidence and the reserved plan tier change only through server-controlled functions.

#### Scenario: Owner tries to rewrite their consent evidence
- **WHEN** an owner sends a direct update of their own account's accepted Terms version through the client API
- **THEN** the update is denied and the stored version is unchanged

#### Scenario: Owner tries to raise their plan tier
- **WHEN** an owner sends a direct update of their own account's plan tier through the client API
- **THEN** the update is denied and the stored plan tier is unchanged

### Requirement: A failed consent write is recoverable
The system SHALL let an owner whose consent write failed after signup complete account setup by re-submitting the signup form for the same address, and SHALL tell a signed-in owner who has no account record that their account setup did not finish rather than showing a generic error.

#### Scenario: Re-submitting signup after a failed consent write
- **WHEN** an owner holds a session for an address that has no account record and re-submits the signup form for that address with the agreement ticked
- **THEN** the account record is created with their consent and they continue to venue creation

#### Scenario: Creating a venue without an account record
- **WHEN** a signed-in owner with no account record tries to create a venue
- **THEN** the venue is not created and the owner sees the "account setup didn't finish" message instead of the generic error

### Requirement: Login does not reveal which credential was wrong
The system SHALL let an owner sign in with email and password, and SHALL answer a wrong password and an unknown email with the same message.

#### Scenario: Correct credentials
- **WHEN** an owner signs in with their email and password
- **THEN** they are signed in and taken to their venues

#### Scenario: Wrong password and unknown email look the same
- **WHEN** one sign-in uses a registered email with a wrong password and another uses an unregistered email
- **THEN** both are refused with the identical message "That email or password isn't right. Check and try again, or reset your password."

### Requirement: Uniform password-reset request
The system SHALL give the same response to a password-reset request whether or not the address belongs to an account, SHALL email a reset link only to a registered address, and SHALL build that link from the configured site URL, never from request headers, refusing to send links in production when no site URL is configured.

#### Scenario: Registered and unregistered addresses
- **WHEN** a reset is requested once for a registered address and once for an unregistered one
- **THEN** both requests show the same confirmation message
- **AND** only the registered address receives a reset email

#### Scenario: Forged forwarding header
- **WHEN** a reset request arrives with a forged forwarding host header
- **THEN** the emailed link still points at the configured site URL

### Requirement: Password change requires a single-use recovery grant
The system SHALL set a new password only for a session holding a recovery grant issued when an emailed recovery link was redeemed, bound to that session's user and valid for at most 15 minutes; a successful change SHALL consume the grant, and a session without a valid grant SHALL NOT be able to change the password through the reset flow.

#### Scenario: Redeemed recovery link
- **WHEN** an owner opens a valid recovery link from their email and submits a new password
- **THEN** the password is changed and the owner can sign in with it

#### Scenario: Replaying the reset
- **WHEN** the same browser submits a second new password after a successful reset
- **THEN** the change is refused because no recovery grant remains

#### Scenario: Signed-in owner without a recovery link
- **WHEN** a signed-in owner who has not redeemed a recovery link opens the reset page
- **THEN** only the request-a-link stage is offered and no password can be set

#### Scenario: Non-recovery links mint nothing
- **WHEN** a signup confirmation, invite, magic-link or code-exchange link is redeemed
- **THEN** no recovery grant is issued

#### Scenario: Failed change keeps the grant
- **WHEN** the password update itself fails
- **THEN** the recovery grant remains so the owner can retry within its lifetime

### Requirement: Google sign-in control
The system SHALL offer a rendered "Continue with Google" control on both the login and signup pages that does not depend on the One Tap prompt appearing, SHALL keep Google sign-in unavailable with an explanation until the Terms agreement is ticked, SHALL bind each Google credential to a hashed single-use nonce, and SHALL show an "unavailable" message when the Google library cannot load.

#### Scenario: Control on both pages
- **WHEN** the login page or the signup page renders with a Google client configured
- **THEN** a Google sign-in control is present on the page

#### Scenario: Before the agreement is ticked
- **WHEN** the agreement box is not ticked
- **THEN** the Google control is disabled and the message "Accept the Terms of Service and Privacy Policy to continue with Google." is shown

#### Scenario: Nonce binding
- **WHEN** Google sign-in starts
- **THEN** Google receives the SHA-256 hash of the nonce that is later presented with the credential

#### Scenario: Google library blocked
- **WHEN** the agreement is ticked and the Google library fails to load
- **THEN** the page shows "Google sign-in isn't available right now. Use your email and password, or try again." instead of an empty section
