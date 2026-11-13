# daemon-lifecycle Spec Delta

## ADDED Requirements

### Requirement: Restart into a new install
When a newer Counterpoint is installed while the daemon runs, the daemon SHALL restart into it on its own if no run is active, and otherwise SHALL show a card offering to restart after the run or now. The restart SHALL keep state, approvals and console sessions, and SHALL be noted in "Done for you".

#### Scenario: Install between runs
- **WHEN** a new Counterpoint version is installed and no run is active
- **THEN** the daemon restarts into it within a minute and the console reconnects without a new sign-in

#### Scenario: Install during a run
- **WHEN** a new version is installed while a run is building
- **THEN** a card offers "Restart after this run" (recommended) and "Restart now"

## MODIFIED Requirements

### Requirement: Crash-only restart
On every start the daemon SHALL reconcile its state from scratch: clear stale run files, apply store migrations, expire sign-in codes, drop console sessions that have expired, and re-check registered hosts. Console sessions that have not expired SHALL be kept, after a crash as after a planned self-restart, so a restart never needs a terminal to sign in again. Liveness SHALL be decided by the control channel answering, never by a pid file alone.

#### Scenario: Start after a crash
- **WHEN** the daemon was killed and the owner runs `counterpoint`
- **THEN** a new daemon starts and the open console reconnects with its existing session

#### Scenario: Planned self-restart
- **WHEN** the daemon restarts itself into a new install
- **THEN** the open console reconnects with its existing session
