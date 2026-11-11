# council-cards Spec Delta

## Purpose
Question cards turn the council's findings into decisions the owner can make quickly, and define how the build lane behaves while a card is still unanswered.

## ADDED Requirements

### Requirement: Card contents
A card SHALL show the question, the seats that raised it, 2-4 options with trade-offs, the recommended option, dissenting seats' positions as a minority report, and a reversibility class (reversible or irreversible).

#### Scenario: Card with dissent
- **WHEN** the QA seat disagrees with the recommended option
- **THEN** the card shows QA's position in its minority report

### Requirement: Pick
The owner SHALL be able to pick an option; the pick SHALL become a decision written back through the adapter and committed.

#### Scenario: Pick option A
- **WHEN** the owner picks option A on a card about a change
- **THEN** the decision is committed into that change's design and the card closes

### Requirement: More like B
The owner SHALL be able to say "More like B →", optionally with a steering note, to get a new round of options anchored on B, with a breadcrumb trail they can back up through.

#### Scenario: Steered round
- **WHEN** the owner says "More like B" with the note "don't block the waiter"
- **THEN** a new round of options anchored on B appears and the trail shows A/B/C then B

### Requirement: None fit, reframe
The owner SHALL be able to choose "None fit, reframe", and the council SHALL reframe the question.

#### Scenario: Reframe
- **WHEN** the owner chooses "None fit, reframe"
- **THEN** a reframed question replaces the card

### Requirement: Later
The owner SHALL be able to choose Later, and the card SHALL stay in the inbox.

#### Scenario: Defer
- **WHEN** the owner chooses Later
- **THEN** the card stays in Needs You

### Requirement: Unanswered reversible card proceeds as assumed
When the builder reaches work depending on an unanswered reversible card, it SHALL proceed on the recommended option and log it as "assumed" in an assumptions ledger shown in the PR and merge summary. If the owner later answers differently, the answer SHALL join the open change's batch of revision notes (`pr-revisions`), or become a backlog item if already merged.

#### Scenario: Owner overturns after merge
- **WHEN** the owner picks a different option after the dependent change merged
- **THEN** a backlog item describing the rework is committed

### Requirement: Unanswered irreversible card parks only its change
When the builder reaches work depending on an unanswered irreversible card (DB schema, auth, data model, public routes, privacy, pricing), only that change SHALL park, and the run SHALL continue with the rest of the runway.

#### Scenario: Schema question open
- **WHEN** a change depends on an unanswered schema card
- **THEN** that change parks and the next runway change starts
