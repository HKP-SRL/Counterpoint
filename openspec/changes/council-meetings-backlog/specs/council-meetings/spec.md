# council-meetings Spec Delta

## Purpose
How the council deliberates: bounded structured meetings and async threads that run alongside the work and end in concrete outputs the owner can act on.

## ADDED Requirements

### Requirement: Structured meeting protocol
A meeting SHALL run an independent blind pass per seat, then one anonymised critique round, then a chair synthesis, in a deterministic turn order, with hard caps on rounds, tokens and wall time. Dissent SHALL be kept as a minority report, never settled by vote.

#### Scenario: Wall-time cap reached
- **WHEN** a meeting reaches its wall-time cap during the critique round
- **THEN** it stops, the chair synthesises what exists, and the minutes say the cap was hit

### Requirement: Owner-called meetings with minutes and transcript
The owner SHALL be able to call a meeting on any topic or screen, and read its minutes and full transcript.

#### Scenario: Meeting on a screen
- **WHEN** the owner calls a meeting on a draft screen
- **THEN** the meeting runs and its minutes and transcript are available afterwards

### Requirement: Discrete outputs
Every meeting SHALL produce discrete outputs: cards, backlog items and review notes, each linked to the meeting.

#### Scenario: Meeting finds a question
- **WHEN** a meeting finds an open planning question
- **THEN** it appears as a card linked to the meeting's minutes

### Requirement: Cost visibility and caps
The owner SHALL see token cost per seat and per meeting. Per-meeting and per-day caps SHALL be enforced.

#### Scenario: Daily cap reached
- **WHEN** council spend reaches the per-day cap
- **THEN** no new meeting starts until the next day and the owner sees why

### Requirement: Async threads with escalation
Seats SHALL clarify small points among themselves in async threads; a thread that stalls SHALL escalate to a meeting.

#### Scenario: Stalled thread
- **WHEN** a thread passes its turn limit without agreement
- **THEN** a meeting on that topic is scheduled

### Requirement: Persona pins on drafts
Relevant persona seats SHALL pin their own comments on a draft before the owner reviews it, marked with the seat that wrote them.

#### Scenario: Cook reviews a kitchen screen
- **WHEN** a kitchen display draft is ready for review
- **THEN** the Cook seat's pins are on it, labelled as the Cook's, before the owner opens it

### Requirement: Automatic meetings alongside the work
The council SHALL meet automatically at the configured lifecycle points, and those meetings SHALL never hold up approving, drafting or building.

#### Scenario: Meeting at a lifecycle point during a run
- **WHEN** a configured lifecycle point triggers a meeting while a build runs
- **THEN** the meeting runs within the council's share and the build continues
