# owner-identity Specification

## Purpose
Counterpoint acts as the owner, not as a separate party: its agent sessions, gates and services run with the owner's own permissions, environment, tools and network, and its commits carry the owner's identity.

## Requirements

### Requirement: Sessions run as the owner
Every agent session SHALL be a headless Claude Code session in auto permission mode, started in the change's worktree with the owner's own permissions. Counterpoint SHALL add no sandbox and no file or network restriction of its own, and the session SHALL load the host's own project instructions and skills. A call that would wait for a person SHALL be denied at once, so a session never waits.

#### Scenario: A task needs a new package
- **WHEN** a build task needs a dependency the host does not have yet
- **THEN** the session installs it from the network in its worktree and goes on

#### Scenario: A task needs the local database
- **WHEN** a build task needs the host's local database running
- **THEN** the session starts it and works against it

#### Scenario: Nothing waits for a person
- **WHEN** a tool call would need a person's permission
- **THEN** it is denied at once and the session continues with the denial

### Requirement: Gates and services run as the owner
Gate commands and host service commands SHALL run as ordinary child processes with the owner's permissions and the run's environment, with no sandbox added by Counterpoint.

#### Scenario: A gate binds a local port
- **WHEN** a gate's build command binds a local port
- **THEN** the gate runs to its own exit code and is not refused

### Requirement: The owner's login environment, read at each run start
At the start of every run, Counterpoint SHALL read the owner's environment from the owner's login shell (the shell's startup files, with a time limit) and use it, whole, for that run's sessions, gates and services. Only Counterpoint's own variables SHALL be left out. If the login shell cannot be read, the run SHALL use the daemon's own environment and Needs You SHALL say so.

#### Scenario: Tool installed after Counterpoint started
- **WHEN** the owner installs the Supabase CLI and adds it to their shell's PATH after starting Counterpoint, then starts a run
- **THEN** the run finds `supabase` without a restart

#### Scenario: Login shell hangs
- **WHEN** the owner's shell startup does not finish within the time limit
- **THEN** the run uses the daemon's environment and Needs You names the problem

#### Scenario: Token in the owner's shell
- **WHEN** the owner's login shell exports `GH_TOKEN`
- **THEN** sessions and gates see it, as a command in the owner's own terminal would

### Requirement: Commits carry the owner's identity
Every commit Counterpoint makes in a host repository SHALL be authored and committed with the owner's git identity, as the owner's own `git commit` in that repository would use it. Without an owner identity in git config, Counterpoint SHALL use its own identity and Needs You SHALL say so with one card that offers to set the identity GitHub knows for the owner.

#### Scenario: No git identity
- **WHEN** a commit falls back to Counterpoint's own identity because git config names no owner
- **THEN** one card in Needs You says so and offers to set the owner's name and email, and later commits raise no second card

#### Scenario: Preview host checks the author
- **WHEN** a build's pull request is opened on a host whose previews deploy only commits from known accounts
- **THEN** its commits are authored by the owner and the preview deploys

### Requirement: Commits name what made them
Every commit Counterpoint makes SHALL carry a trailer naming what made it. A build session's commit and a build branch's tick commit SHALL carry `Counterpoint-Run` with the run, and the session where there is one. A planning write's commit (Done on an owner step, Land it, ticks after a merged build) SHALL carry `Counterpoint-Write` with the write's id.

#### Scenario: Planning write traced
- **WHEN** the owner reads the history of the base branch after marking an owner step Done
- **THEN** the tick's commit carries `Counterpoint-Write: <id>`

#### Scenario: Agent work stays identifiable
- **WHEN** the owner reads the history of a build branch
- **THEN** every session commit carries `Counterpoint-Run: <run> session <n>`
