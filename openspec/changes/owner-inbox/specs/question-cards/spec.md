# question-cards Spec Delta

## Purpose
A question card turns anything Counterpoint or an agent needs from the owner into a decision the owner can make in one step. Counterpoint then carries out the answer. Council cards build on this model.

## ADDED Requirements

### Requirement: Card contents
A card SHALL show a plain-language question, one line on why it matters, where it came from (a run, a change, a session or the machine), 2–4 options each with its consequence in one line, exactly one recommended option, and whether the decision is reversible. A card MAY offer Later and a free-text note.

#### Scenario: Supply-chain step
- **WHEN** a change's plan needs the owner to approve a third-party package version
- **THEN** the card names the versions as options, marks the one the plan was proven on as recommended, and says the choice is hard to reverse

### Requirement: Answer in one step
The owner SHALL answer a card with one click or one key: `1`–`4` pick an option, `Enter` picks the preselected recommended option, and `L` defers it. A note MAY be added to an answer. The answer SHALL be recorded with the time, and the card SHALL move to an Answered list showing what happened next.

#### Scenario: Accept the recommendation
- **WHEN** the owner opens Needs You and presses `Enter` on the first card
- **THEN** the recommended option is recorded and the next card is focused

### Requirement: Counterpoint carries out the answer
An option on a card raised by Counterpoint itself MAY carry an action from a fixed catalog Counterpoint implements (re-read the environment and resume, retry a parked change, resume a run, perform an owner step, restart into a new install). Picking it SHALL perform the action with no further step for the owner.

#### Scenario: Fix offered with the problem
- **WHEN** a run stops because a service program is not on the PATH and the owner picks "Re-read my environment and resume"
- **THEN** Counterpoint reads the login environment again and the run resumes without the owner opening a terminal

### Requirement: Agent cards carry no action
A card raised by an agent SHALL never carry an action. Its answer SHALL only go back to the session that asked.

#### Scenario: Agent cannot attach an action
- **WHEN** an agent posts a card whose option text asks to run a command
- **THEN** answering it only returns the answer to that agent and runs nothing

### Requirement: Decisions the owner already made are not asked
When a question follows from Counterpoint acting as the owner, Counterpoint SHALL decide it without a card and record what it did in a "Done for you" list in Needs You, with how to undo it where that is possible.

#### Scenario: Stale environment
- **WHEN** a run starts and the owner's login PATH has changed since the daemon started
- **THEN** the run uses the new PATH, raises no card, and "Done for you" notes that the environment was refreshed

### Requirement: Unanswered cards
An unanswered reversible card that work depends on SHALL let that work proceed on the recommended option, logged as assumed where the owner reviews it (the pull request and the run report). An answer given later SHALL be recorded and kept for the change's next build, and the card SHALL say that it was recorded and which option the pull request was built on. An unanswered irreversible card SHALL park only the work that depends on it, and the run SHALL continue with the rest.

#### Scenario: Reversible question during a build
- **WHEN** a builder asks a reversible question and the owner is away
- **THEN** the builder continues on the recommended option and the pull request lists it as assumed

#### Scenario: Answer after the pull request was built
- **WHEN** the owner answers a builder's reversible question with another option after the change's pull request was built on the recommended one
- **THEN** the card says the answer was recorded and names the option the pull request was built on, and the change's next build gets the answer

#### Scenario: Irreversible question during a run
- **WHEN** a builder asks whether to change a database schema and nobody answers
- **THEN** only that change parks and the next change on the runway starts
