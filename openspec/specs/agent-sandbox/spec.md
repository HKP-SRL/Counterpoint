# agent-sandbox Specification

## Purpose
The confinement every headless Claude Code session started by Counterpoint runs under, so agents running as the owner's OS user cannot reach the approval key, the owner's credentials, Counterpoint's state or the host's shared git configuration.

## Requirements

### Requirement: One launch profile for every agent session
Counterpoint SHALL start every agent session (the doctor probe today, builders later) from one launch profile, so the probe tests exactly the confinement production sessions get. Sessions SHALL be headless `claude -p` runs with stream-json output, the OS sandbox enabled and required, and no unsandboxed-command escape.

#### Scenario: Probe and builder share confinement
- **WHEN** doctor runs its probe session
- **THEN** that session's settings are the same profile any other agent session would get for the same host

### Requirement: Protected paths are unreadable
An agent session SHALL NOT read the approval signing key's folder, `~/.ssh`, the gh credentials folder or the Counterpoint home, through Bash, the file tools, search tools or symlinks.

#### Scenario: Read through a symlink
- **WHEN** an agent creates a symlink in its working folder to a file in `~/.ssh` and reads it
- **THEN** the read is refused by a deny rule

#### Scenario: Bash read
- **WHEN** an agent runs `cat` on a file inside the Counterpoint home
- **THEN** the OS sandbox refuses it

### Requirement: Shared git configuration is not writable
An agent session SHALL NOT write the host's shared `.git/config`, `.git/hooks` or `.git/info`, located through the repository's common git dir so linked worktrees are covered too.

#### Scenario: Hook planted from a worktree
- **WHEN** an agent working in a linked worktree tries to create a file in the main repository's `.git/hooks`
- **THEN** the write is refused

### Requirement: File edits confined to the session folder
The Write and Edit tools SHALL be able to change files only inside the session's working folder; every write outside it SHALL be refused by a deterministic rule, not by the permission classifier.

#### Scenario: Edit a shell rc file
- **WHEN** an agent tries to Write to `~/.zshrc`
- **THEN** the write is refused as outside the working folder

### Requirement: Host-repo settings are not loaded
Agent sessions SHALL load Claude Code settings from the user scope only, never from project or local settings in the host repository or worktree, and SHALL use only explicitly passed MCP servers, so an agent cannot plant hooks or settings that a later session would run.

#### Scenario: Planted project hook
- **WHEN** an agent commits `.claude/settings.json` with a SessionStart hook into its worktree
- **THEN** the next agent session started there does not run that hook

### Requirement: Environment allow-list
Agent sessions SHALL receive only an allow-listed environment. The SSH agent socket, askpass helpers, GitHub tokens and every Counterpoint variable SHALL NOT be passed, and the launch profile SHALL deny the messaging token Claude Code would otherwise expose to Bash.

#### Scenario: Owner shell holds GH_TOKEN
- **WHEN** the owner's shell exports `GH_TOKEN` and Counterpoint starts an agent session
- **THEN** the session's Bash environment has no `GH_TOKEN`

### Requirement: Auto permission mode without trusting the classifier
Agent sessions SHALL run in Claude Code's auto permission mode so unlisted commands do not stall a headless run. No protection in this capability SHALL rely on the classifier or the mode: each SHALL come from a deny rule, the OS sandbox or the outside-folder write block.

#### Scenario: Classifier would allow a protected read
- **WHEN** the classifier would allow a command that reads a protected path
- **THEN** the deny rule or OS sandbox still refuses it
