# gates Spec Delta

## Purpose
Gates are the external judge of a build: commands defined in the host's Counterpoint config, read from the approved base and judged only by exit code, so an agent saying "done" never counts.

## ADDED Requirements

### Requirement: Gate commands from the approved base
Gates SHALL be commands defined in the gates section of the host's Counterpoint config, read at the approved base commit, never from the build worktree. Counterpoint SHALL ship no built-in knowledge of any test tool.

#### Scenario: Agent edits the gate config in its worktree
- **WHEN** a builder changes the gates section in its worktree
- **THEN** the gates that run are still the ones at the approved base

### Requirement: Exit code is the only verdict
A gate SHALL pass only when its command exits 0. A non-zero exit, a signal or a timeout SHALL fail it with a distinct stored reason. Each gate SHALL run in its own process group, killed as a group on timeout or stop.

#### Scenario: Gate times out
- **WHEN** a gate exceeds its timeout
- **THEN** its whole process group is killed and the gate fails with reason timeout

#### Scenario: Agent claims success
- **WHEN** the builder reports the work is done but the unit gate exits 1
- **THEN** the change is not green

### Requirement: Gate output kept
Gate output SHALL stream to a log file per gate and attempt, and the last lines SHALL be kept with the result, stripped of terminal colors.

#### Scenario: Failing gate
- **WHEN** a gate fails
- **THEN** its last lines are stored with the result and its full log is on disk

### Requirement: Bounded retries then parking
A failing gate's output SHALL go back to the builder for a bounded number of retries. After N failed attempts the change SHALL park in Needs You with its last failing gate output and its attempt history, and the run SHALL continue with other runway.

#### Scenario: Third failure
- **WHEN** a change fails its e2e gate for the third time with N = 3
- **THEN** it parks with the failing output and three attempts listed, and the next change starts

### Requirement: Service programs checked before building
Before a change's first builder session, every program of every host service its gates need SHALL be checked as runnable from Counterpoint's own environment. If one is not, the run SHALL stop before any session, and Needs You SHALL name the program and how to fix it.

#### Scenario: Service program missing from Counterpoint's PATH
- **WHEN** the gates need the supabase service and `supabase` is not on the PATH Counterpoint was started with
- **THEN** the run stops before any builder session, no change is parked or charged an attempt, and Needs You says which program is missing and to restart Counterpoint from a terminal that has it

### Requirement: Service programs that cannot start cost no attempt
A service program that cannot be started during a run SHALL park the change at once, spending no attempt and never going back to the builder. A service program that runs and fails SHALL count as a gate failure like any other, since the change's own code can cause it.

#### Scenario: Service program gone mid-run
- **WHEN** a service's start program cannot be started during a gate round
- **THEN** the change parks at once with that reason and zero attempts spent

#### Scenario: Migration breaks the reset
- **WHEN** a service's reset command runs and exits 1 on the change's own migration
- **THEN** the failure goes back to the builder as a gate failure and counts one attempt

### Requirement: Protected-path check
Edits by the builder to tests, gate configs or visual baselines SHALL be flagged by a protected-path check and shown on the change. The host's Counterpoint config MAY list further protected paths; that list SHALL be read at the approved base, like the gates.

#### Scenario: Test weakened
- **WHEN** the builder edits an existing test file
- **THEN** the change is flagged with the edited protected paths

#### Scenario: Host-listed protected path
- **WHEN** the host config lists `src/core/security/**` as protected and the builder edits a file there
- **THEN** the change is flagged with that path, even if the builder also removed the entry from the config in its worktree

### Requirement: Zero-test guard
A test gate that ran zero tests SHALL fail.

#### Scenario: Filter matches nothing
- **WHEN** the unit gate exits 0 but reports zero tests run
- **THEN** the gate fails with reason zero tests

### Requirement: Shared test lock
Gates marked as needing exclusive resources SHALL run under one machine-wide test lock that the operating system releases when the holder dies, so a crash cannot leave a stale lock.

#### Scenario: Holder crashes
- **WHEN** a gate holding the test lock is killed
- **THEN** the next gate acquires the lock without manual cleanup
