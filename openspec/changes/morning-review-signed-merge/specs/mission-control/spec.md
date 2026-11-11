# mission-control Spec Delta

## Purpose
The console's view of the build lane: what each change is doing, which gates have passed, what a running session is doing right now, and a few honest counters that reward needing the owner less.

## ADDED Requirements

### Requirement: Build status per change
Each change in a run SHALL show one status: queued, running, waiting on owner, parked, gates failing, in revision, ready for approval, or merged, updated live.

#### Scenario: Gate fails
- **WHEN** a running change's lint gate fails
- **THEN** its status changes to gates failing without a reload

### Requirement: Gate row
Each change SHALL show its gate row (for example typecheck, lint, unit, DB, flows, visual) lighting up as each gate passes, with the failing gate's last lines one click away.

#### Scenario: Open a failing gate
- **WHEN** the owner clicks a failed gate in the row
- **THEN** the gate's last lines are shown as plain text with a link to the full log

### Requirement: Live session log and stop
The owner SHALL be able to open a running session's live log (tool calls and progress) and stop that session from the console, with the owner credential.

#### Scenario: Stop a session
- **WHEN** the owner stops a running session
- **THEN** the session ends, its processes are killed, and the change shows as waiting on owner

### Requirement: Daytime mode
The Mission page SHALL support runs with the owner present: a run with a daytime stop time or none, PRs listed for review as each one lands rather than in a morning debrief, and revision rounds in flight shown beside builds.

#### Scenario: PR lands mid-afternoon
- **WHEN** a change's PR opens at 14:20 during a day run
- **THEN** it is listed for review at once while the run keeps building

### Requirement: Honest counters
Beside the runway the console SHALL show a few counters (such as first-attempt gate pass rate, changes merged without intervention, and changes merged with no revision round), each paired with a counter-metric (such as gate-touch rate, or rework filed after merge) so it cannot reward a failure mode.

#### Scenario: Gates edited to pass
- **WHEN** first-attempt pass rate rises while builders edit protected gate files
- **THEN** the paired gate-touch rate rises beside it

#### Scenario: Merges waved through
- **WHEN** more changes merge with no revision round while rework items filed against merged changes rise
- **THEN** the paired rework count rises beside it
