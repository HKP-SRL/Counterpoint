# key-trust Specification

## Purpose
How the owner establishes what Counterpoint trusts: one dedicated, passphrase-only approval key pinned outside every repository, and a per-host baseline of the git configuration surface that could make git run a program.

## Requirements

### Requirement: Dedicated approval key setup
`counterpoint init-key` SHALL print the exact `ssh-keygen` command for a new passphrase-protected ed25519 approval key for the owner to run. Counterpoint SHALL never generate the key itself, see the passphrase or store it.

#### Scenario: Guided key creation
- **WHEN** the owner runs `counterpoint init-key`
- **THEN** it prints an `ssh-keygen -t ed25519` command for a dedicated approval key and changes nothing

### Requirement: Key pinned only after terminal confirmation
`counterpoint trust-key <public-key>` SHALL show the key's fingerprint and write the trusted signer only after the owner types `y` at a terminal. The trusted signer SHALL live in the Counterpoint home, outside every repository, hold exactly one key with one principal, and pin its fingerprint.

#### Scenario: Owner declines
- **WHEN** the owner answers anything but `y`
- **THEN** nothing is written

#### Scenario: No terminal
- **WHEN** `counterpoint trust-key` runs without a terminal
- **THEN** it refuses and writes nothing

#### Scenario: Two keys in the file
- **WHEN** the trusted-signers file holds more than one key or a wildcard principal
- **THEN** verification refuses to use it

### Requirement: Host integrity baseline
`counterpoint trust {host}` SHALL show the host's execution-capable git surface and record it as the baseline only after the owner types `y` at a terminal. The surface SHALL include every config key that can run a program or change where git talks (including external diff, pagers, sequence editor, submodule update commands, diff and merge tool commands, alternate-refs command and proxies), non-sample hooks, `info` files, every worktree's own config, and the content of every included config file.

#### Scenario: Baseline recorded
- **WHEN** the owner confirms the shown list with `y`
- **THEN** the baseline is stored in the Counterpoint home for that host

#### Scenario: Included file changes
- **WHEN** a config file pulled in by `include.path` changes after the baseline
- **THEN** the integrity check fails

#### Scenario: Worktree config adds a pager
- **WHEN** a linked worktree's own config sets a pager command after the baseline
- **THEN** the integrity check fails

### Requirement: Unexpected git changes block signing
Before signing, `counterpoint approve` SHALL compare the host's current execution-capable git surface with the baseline and refuse when it differs or no baseline exists. Doctor SHALL report the same comparison. Ordinary bookkeeping such as upstream tracking changes SHALL NOT trigger it.

#### Scenario: Hook added
- **WHEN** a new non-sample file appears in the host's `.git/hooks` after the baseline
- **THEN** approve refuses with the integrity-changed message and doctor fails the integrity check

#### Scenario: Push sets upstream
- **WHEN** `git push -u` rewrites the branch tracking keys in `.git/config`
- **THEN** the integrity check still passes

### Requirement: Trust-key pins exactly the confirmed key
`counterpoint trust-key` SHALL pin the exact key bytes whose fingerprint the owner confirmed, read without following symlinks, and SHALL refuse if the key file changed between the prompt and the write.

#### Scenario: Key swapped during the prompt
- **WHEN** the public key file is replaced while the confirmation prompt is open
- **THEN** trust-key refuses and writes nothing
