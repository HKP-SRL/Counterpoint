# doctor Spec Delta

## ADDED Requirements

### Requirement: Write widenings are judged
Doctor's isolation check SHALL fail, naming the source and key, when any settings source an agent session loads (other than the launch profile's own grant) widens where agents may write or read: sandbox filesystem allow-write or allow-read entries, extra working directories for the file tools, or unix-socket allowances. It SHALL also fail on the other keys the Claude Code docs name as weakening the sandbox: local port binding, the weaker nested sandbox and weaker network isolation.

#### Scenario: User settings allow writes to home
- **WHEN** `~/.claude/settings.json` sets a sandbox allow-write entry for `~`
- **THEN** the isolation check fails naming that file and key, and doctor does not pass

#### Scenario: Local binding allowed
- **WHEN** user settings turn on sandbox local port binding
- **THEN** the isolation check fails naming that file and key

#### Scenario: Extra working directory
- **WHEN** user settings add an additional working directory for the file tools
- **THEN** the isolation check fails naming it

### Requirement: Bash outside-write probe step
The probe's files-outside-the-working-folder row SHALL include a Bash write outside the working folder alongside the Write and Edit steps, run by both the treatment and the control session, and SHALL remove any file it created.

#### Scenario: Bash write accepted
- **WHEN** a sandboxed Bash `touch` outside the working folder succeeds in the treatment session
- **THEN** the row reads Reachable and the probe file is removed

### Requirement: Build-lane probe rows
Before the first run, doctor SHALL prove three more things live: a sandboxed shell started in a linked worktree of the host cannot create or move a git ref; the host's committed `.claude/settings.json`, which builder sessions load, widens no isolation setting; and a gate command under the gate sandbox cannot read a protected path, write outside its folder or reach the console port, while it can reach a port its gate lists.

#### Scenario: Worktree session moves a ref
- **WHEN** the treatment shell in a linked worktree of the host creates a probe ref
- **THEN** the worktree row reads Reachable and doctor does not pass

#### Scenario: Gate reaches the console
- **WHEN** a probe command under the gate sandbox connects to the console port
- **THEN** the gate-sandbox row reads Reachable and doctor does not pass
