# build-runs Spec Delta

## Purpose
Unattended builds of approved changes: how a run starts and stops, where each change is built, how sessions hand off at the context budget, and how the run survives usage limits, errors and crashes.

## ADDED Requirements

### Requirement: Start and stop a run from the CLI
The owner SHALL start a run from the CLI choosing which changes on the runway to build, a stop time, a model and a context budget, and SHALL be able to stop it. Starting and stopping SHALL require the owner credential that agents cannot read.

#### Scenario: Budget shown as tokens
- **WHEN** the owner sets the budget to 40% on a model with a 1M-token window
- **THEN** the run settings show "40% of 1M = 400k tokens"

#### Scenario: Agent tries to start a run
- **WHEN** an agent session sends a start request without the owner credential
- **THEN** the request is refused

### Requirement: Only runway changes are built
A run SHALL build only changes whose approval verifies at the moment the build starts. A change that leaves the runway during a run SHALL NOT start; one already building SHALL stop at its next handoff and land in Needs You.

#### Scenario: Approval drifts mid-run
- **WHEN** a queued change's proposal is edited on the base branch during a run
- **THEN** that change is not built and appears in Needs You as approved version changed

### Requirement: No agent spawns while doctor fails
Counterpoint SHALL refuse to start a run, and the governor SHALL refuse every agent spawn, while the last doctor verdict is not a pass (with accepted risks only).

#### Scenario: Probe failing
- **WHEN** the last doctor run has a Reachable row not covered by an accepted risk
- **THEN** starting a run is refused with the reason and the doctor command

### Requirement: One worktree and branch per change
Each change SHALL build in its own git worktree and branch created from the approved base commit, outside the owner's checkout. The builder SHALL never run git commands in the owner's checkout. Builder sessions SHALL write no git state: Counterpoint commits each session's work in the worktree itself, outside the agent sandbox.

#### Scenario: Owner works during a day run
- **WHEN** the owner edits files in their checkout while a change builds
- **THEN** the build is unaffected and the owner's checkout is untouched

### Requirement: Fresh sessions with context-budget handoff
Each build SHALL run in fresh `claude -p` sessions. When a session's context passes the run's budget, measured against the model's real window (never a hard-coded size), Counterpoint SHALL have it finish the current task, write a handoff and stop, SHALL commit the session's work with the handoff, and SHALL start the next fresh session from that handoff.

#### Scenario: Budget reached
- **WHEN** a session's context passes 40% of the model's window mid-task
- **THEN** it finishes that task, writes a handoff and stops, Counterpoint commits the work with the handoff, and a new session continues from it

### Requirement: Usage limits pause every lane
On a usage limit every agent lane SHALL pause until the reported reset time plus 2 minutes and then resume on its own. Transient API errors SHALL back off and retry. Auth, credit and spend-limit errors SHALL stop the run and land in Needs You.

#### Scenario: Five-hour limit hit at 02:00
- **WHEN** a usage limit resets at 03:10
- **THEN** the run holds and resumes at 03:12 without the owner

#### Scenario: Expired login
- **WHEN** a session fails with an authentication error
- **THEN** the run stops and Needs You says why

### Requirement: Single governor in front of every spawn
Every agent spawn on the machine, across hosts, SHALL go through one governor that applies usage-limit pauses to all lanes together.

#### Scenario: Two hosts
- **WHEN** a usage limit is hit while building on one host
- **THEN** agent work on every host pauses until the reset

### Requirement: Crash and reboot recovery
If Counterpoint is killed or the machine reboots mid-run, the next start SHALL reconcile in-progress runs and resume each from its last handoff, leaving no orphaned agent, gate or server processes.

#### Scenario: Reboot during a build
- **WHEN** the machine reboots while a change builds
- **THEN** after `counterpoint` starts again the run resumes from the last committed handoff

### Requirement: Stop time honoured
A run SHALL start no new session after its stop time and SHALL stop at a clean point, recording what remains.

#### Scenario: Stop time reached
- **WHEN** the stop time passes during a session
- **THEN** the session ends at its next handoff and no new session starts
