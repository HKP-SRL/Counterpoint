# council-findings Spec Delta

## Purpose
The council brings the owner only its top findings on a change, at plan time and after the build, as cards the owner can answer quickly, and defines how the build lane behaves while one is unanswered.

## ADDED Requirements

### Requirement: Top three findings at plan time
When a change becomes Ready to approve, the seats SHALL review its plan, and the council SHALL raise at most three findings on it as cards.

#### Scenario: Many concerns
- **WHEN** the seats find six concerns on a change's plan
- **THEN** Needs You shows the three the council ranks highest, and no others

### Requirement: Top three findings after the build
When a change's pull request opens, the seats SHALL review the build, and the council SHALL raise at most three findings on it as cards.

#### Scenario: Cook finds the screen hard to use
- **WHEN** the Cook seat finds the built order screen hard to use
- **THEN** a card on that change names the problem, the seats that raised it and the options

### Requirement: Card contents
A card SHALL show the question, the seats that raised it, 2-4 options with trade-offs, the recommended option, and whether it is reversible.

#### Scenario: Irreversible finding
- **WHEN** a finding concerns the database schema
- **THEN** its card is marked irreversible

### Requirement: Pick
The owner SHALL be able to pick an option; the pick SHALL become a decision written back through the adapter and committed.

#### Scenario: Pick option A
- **WHEN** the owner picks option A on a card about a change
- **THEN** the decision is committed into that change's design and the card closes

### Requirement: Later
The owner SHALL be able to choose Later, and the card SHALL stay in the inbox.

#### Scenario: Defer
- **WHEN** the owner chooses Later
- **THEN** the card stays in Needs You

### Requirement: Unanswered reversible card proceeds as assumed
When the builder reaches work depending on an unanswered reversible card, it SHALL proceed on the recommended option and log it as assumed in the pull request. If the owner later answers differently, the answer SHALL join the open change's batch of revision notes (`pr-revisions`), or become a backlog item if already merged.

#### Scenario: Owner overturns after merge
- **WHEN** the owner picks a different option after the dependent change merged
- **THEN** a backlog item describing the rework is committed

### Requirement: Unanswered irreversible card parks only its change
When the builder reaches work depending on an unanswered irreversible card (DB schema, auth, data model, public routes, privacy, pricing), only that change SHALL park, and the run SHALL continue with the rest of the runway.

#### Scenario: Schema question open
- **WHEN** a change depends on an unanswered schema card
- **THEN** that change parks and the next runway change starts
