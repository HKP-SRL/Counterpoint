# key-trust Spec Delta

## ADDED Requirements

### Requirement: Passkey registration confirmed at a terminal
`counterpoint passkey register` SHALL print a one-time console link. After the owner creates a passkey there with user verification, the terminal and the browser SHALL both show the new credential's fingerprint, and the terminal SHALL pin the credential and the console's origin in the Counterpoint home, outside every repository, only after the owner types `y`. It SHALL refuse without a terminal.

#### Scenario: Owner confirms
- **WHEN** the fingerprints in the terminal and the browser match and the owner types `y`
- **THEN** the passkey is pinned and changes can be approved in the console

#### Scenario: Credential the owner did not create
- **WHEN** the terminal shows a fingerprint that differs from the browser's and the owner answers `n`
- **THEN** nothing is pinned

#### Scenario: No terminal
- **WHEN** `counterpoint passkey register` runs without a terminal
- **THEN** it refuses and pins nothing

### Requirement: Pinned credentials change only at a terminal
Adding, replacing or removing a pinned passkey SHALL happen only through terminal commands confirmed with `y`. The console SHALL offer no way to change pinned credentials.

#### Scenario: Console request to pin a credential
- **WHEN** a console API request tries to pin a new credential
- **THEN** it is refused and nothing changes

## MODIFIED Requirements

### Requirement: Unexpected git changes block signing
Before landing an approval, Counterpoint SHALL compare the host's current execution-capable git surface with the baseline and refuse when it differs or no baseline exists, showing the `counterpoint trust {host}` step in the console. Doctor SHALL report the same comparison. Ordinary bookkeeping such as upstream tracking changes SHALL NOT trigger it.

#### Scenario: Hook added
- **WHEN** a new non-sample file appears in the host's `.git/hooks` after the baseline
- **THEN** approving is refused with the integrity-changed message and doctor fails the integrity check

#### Scenario: Push sets upstream
- **WHEN** `git push -u` rewrites the branch tracking keys in `.git/config`
- **THEN** the integrity check still passes

## REMOVED Requirements

### Requirement: Dedicated approval key setup
**Reason**: SSH approval keys are replaced by a passkey.
**Migration**: See "Passkey registration confirmed at a terminal".

### Requirement: Key pinned only after terminal confirmation
**Reason**: There is no SSH approval key to pin; the passkey is pinned instead.
**Migration**: See "Passkey registration confirmed at a terminal" and "Pinned credentials change only at a terminal".

### Requirement: Trust-key pins exactly the confirmed key
**Reason**: `trust-key` is removed with the SSH approval key.
**Migration**: See "Passkey registration confirmed at a terminal".
