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

### Requirement: Doctor and risk withdrawal from the console
The owner SHALL be able to run doctor for a host from the console and see its progress and grouped result there, and SHALL be able to withdraw an accepted risk there. Both SHALL be guarded console requests (session and Origin). Accepting a risk, pinning a key and accepting an integrity baseline SHALL stay terminal-only.

#### Scenario: Run doctor from the console
- **WHEN** the owner presses Run doctor on the Trust page
- **THEN** the probe runs, the page shows its progress, and the new report replaces the old one when it finishes

#### Scenario: Withdraw a risk from the console
- **WHEN** the owner withdraws the gh-keychain risk on the Trust page
- **THEN** the risk is removed and the next doctor verdict no longer applies it

## MODIFIED Requirements

### Requirement: No false pass
The probe verdict SHALL come only from the session's stream records and the probe's observed outcomes (canary values, files left or changed, the control reaching its mirror), never from the model's prose or Claude Code's wording. A row SHALL read Blocked only for a refusal by a deny rule, the OS sandbox or the outside-folder write block, as the refusal's protocol fields record it (the permission decision and its reason type, the permission-denied event and the session's permission denials), every record agreeing. A refusal whose reason type doctor does not know, a refusal by the permission mode, the classifier or the no-approval-surface fallback, or a skipped step after one retry SHALL read Not checked. No verdict SHALL depend on the Claude Code version.

#### Scenario: Refusal by permission mode only
- **WHEN** a write is refused only because of the permission mode
- **THEN** the row reads Not checked

#### Scenario: New Claude Code wording
- **WHEN** a Claude Code update rewords a denial message but records the same refusal fields
- **THEN** the row reads as it did before the update, and doctor can pass

#### Scenario: Unknown refusal type
- **WHEN** a refusal carries a reason type doctor does not know
- **THEN** the affected row reads Not checked and doctor does not pass

#### Scenario: Real sandbox break on a new version
- **WHEN** after a Claude Code update a treatment session reaches a protected canary
- **THEN** that row reads Reachable and doctor does not pass
