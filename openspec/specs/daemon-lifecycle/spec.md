# daemon-lifecycle Specification

## Purpose
How the owner starts, stops and inspects Counterpoint: one background daemon per machine, started by one command, serving every registered host, with state kept in a home folder that must already exist.

## Requirements

### Requirement: One command starts the daemon
Running `counterpoint` inside a git repository SHALL start one background daemon (or attach to the one already running), register that repository as a host, print the console URL and a one-time sign-in link, open the link, and return the terminal to the owner.

#### Scenario: First start
- **WHEN** no daemon is running and the owner runs `counterpoint` in a repository
- **THEN** a background daemon starts, the repository appears as a host, and the terminal prints `Counterpoint is running at http://127.0.0.1:{port}/` and a sign-in link that works once

#### Scenario: Already running
- **WHEN** a daemon is already running and the owner runs `counterpoint` again
- **THEN** no second daemon starts, the terminal says Counterpoint is already running, and a fresh one-time sign-in link is printed

### Requirement: One daemon per machine serves every host
Counterpoint SHALL run at most one daemon per machine. Running `counterpoint` in another repository SHALL register it as another host of the same daemon, and every stored record, route and console view SHALL be scoped to a host.

#### Scenario: Second host
- **WHEN** the owner runs `counterpoint` in a second repository while the daemon serves the first
- **THEN** the console's host switcher lists both hosts and each host's data stays separate

#### Scenario: Second daemon refused
- **WHEN** a second daemon process tries to start while one holds the single-instance lock
- **THEN** it exits as "already running" and the first daemon keeps serving

### Requirement: Stop and status commands
`counterpoint stop` SHALL stop the daemon and be idempotent; it SHALL NOT delete state or approvals. `counterpoint status` SHALL print one line per host with the port, runway count and Needs You count, or say Counterpoint is not running.

#### Scenario: Stop a running daemon
- **WHEN** the owner runs `counterpoint stop` while the daemon runs
- **THEN** the daemon exits, the console closes, and the command exits 0

#### Scenario: Stop when not running
- **WHEN** the owner runs `counterpoint stop` and no daemon runs
- **THEN** it prints `Counterpoint is not running.` and exits 0

#### Scenario: Status
- **WHEN** the owner runs `counterpoint status` while the daemon runs
- **THEN** each host prints as `{host}  running on 127.0.0.1:{port}  runway {n}  needs you {m}`

### Requirement: Stop on a signal
When the daemon receives SIGTERM or SIGINT it SHALL stop as `counterpoint stop` does: a running run first stops at its next clean point and writes its run report, then the daemon exits. If the run does not reach its clean point within a time limit, its sessions and gates SHALL be ended, keeping their work on the branch, and the daemon SHALL exit; a run that still did not end SHALL be finished at the next start. A second signal SHALL stop the daemon at once.

#### Scenario: Signal during a gate
- **WHEN** the daemon gets SIGTERM while a run's gate is running
- **THEN** the gate is stopped, the run ends with its report written, and the daemon exits

#### Scenario: Session does not wrap up in time
- **WHEN** the daemon gets SIGTERM while a builder session is mid-task and the session does not wrap up within the time limit
- **THEN** the session is ended, its work so far stays on the branch, and the daemon exits

### Requirement: Home must exist before start
Counterpoint SHALL keep its state in a home folder taken from `COUNTERPOINT_HOME`, else the platform's application-data folder. If that folder does not exist, every command except `counterpoint init` SHALL refuse with a clear message and create nothing. `counterpoint init` SHALL create the home with owner-only permissions.

#### Scenario: Home volume unmounted
- **WHEN** `COUNTERPOINT_HOME` points to a folder on an unmounted volume and the owner runs `counterpoint`
- **THEN** it prints that the home does not exist, asks whether the volume is mounted, says nothing was created, and exits non-zero

#### Scenario: Init creates the home
- **WHEN** the owner runs `counterpoint init` and the home is missing
- **THEN** the home folder is created readable only by the owner

### Requirement: Fixed port without silent drift
The daemon SHALL listen on a fixed default port (4170) unless configured otherwise. If the port is taken it SHALL exit non-zero with a message naming the port, and SHALL NOT pick another port on its own.

#### Scenario: Port taken
- **WHEN** another process already listens on the configured port and the owner runs `counterpoint`
- **THEN** it prints `Port {port} is already in use. Free it, or choose a different port in the Counterpoint config.` and exits non-zero

### Requirement: Private control channel
The CLI SHALL control the daemon only through a local channel that requires a token kept in an owner-only file in the Counterpoint home. The token SHALL never appear in a URL, argv or environment variable of any child process.

#### Scenario: Request without the token
- **WHEN** a local process sends a control request without the token
- **THEN** the daemon refuses it

### Requirement: Crash-only restart
On every start the daemon SHALL reconcile its state from scratch: clear stale run files, apply store migrations, expire sign-in codes and sessions, and re-check registered hosts. Liveness SHALL be decided by the control channel answering, never by a pid file alone.

#### Scenario: Start after a crash
- **WHEN** the daemon was killed and the owner runs `counterpoint`
- **THEN** a new daemon starts, previous console sessions are signed out, and the owner gets a new sign-in link

### Requirement: Stop never signals an unrelated process
When the control channel does not answer, `counterpoint stop` SHALL signal a process only after confirming it is the Counterpoint daemon recorded by the current start; stale run records SHALL be cleared at daemon start.

#### Scenario: Stale record after a crash
- **WHEN** a crashed daemon left a record naming a pid now used by another program
- **THEN** `counterpoint stop` does not signal that program

### Requirement: Stop Counterpoint from the console
The owner SHALL be able to stop the daemon from the console with a guarded request; a running build run SHALL first stop at its next clean point.

#### Scenario: Stop with a run going
- **WHEN** the owner stops Counterpoint from the console during a run
- **THEN** the run stops at its next clean point, its report is written, and then the daemon exits
