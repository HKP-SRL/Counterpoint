# key-trust Spec Delta

## ADDED Requirements

### Requirement: Trust-key pins exactly the confirmed key
`counterpoint trust-key` SHALL pin the exact key bytes whose fingerprint the owner confirmed, read without following symlinks, and SHALL refuse if the key file changed between the prompt and the write.

#### Scenario: Key swapped during the prompt
- **WHEN** the public key file is replaced while the confirmation prompt is open
- **THEN** trust-key refuses and writes nothing

## MODIFIED Requirements

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
