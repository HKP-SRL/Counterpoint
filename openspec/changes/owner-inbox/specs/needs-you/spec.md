# needs-you Spec Delta

## MODIFIED Requirements

### Requirement: One inbox
The console SHALL have one Needs You inbox listing items as question cards, cards that block work first and the rest newest first, each with an icon, a title and a detail line, shown with a count in the navigation and the browser tab title. Items SHALL resolve themselves when their cause goes away; there is no manual dismiss for recomputed items.

#### Scenario: Count badge
- **WHEN** two items are in Needs You
- **THEN** the navigation shows 2 and the tab title starts with `(2)`

#### Scenario: Blocking card first
- **WHEN** a parked change's card and a newer reversible question are both open
- **THEN** the parked change's card is listed first

## ADDED Requirements

### Requirement: Every item can be answered
Every item Counterpoint puts in Needs You SHALL offer options the owner can pick in one step, with a recommended option. A run-stopping problem SHALL offer Counterpoint's fix where the action catalog has one, otherwise the exact step only the owner can take, and Later. A note a run left that no answer would act on SHALL be a line in "Done for you", not a card.

#### Scenario: A note nothing can act on
- **WHEN** a run leaves a note that changes nothing whatever the owner answers
- **THEN** it shows once as a "Done for you" line and no card asks about it

#### Scenario: Run stopped for a missing program
- **WHEN** a run stops because a service program cannot be found
- **THEN** its card recommends re-reading the owner's environment and resuming, and picking it resumes the run

#### Scenario: Not logged in
- **WHEN** a run stops because agent sessions report they are not logged in
- **THEN** its card names the cause, and the one step only the owner can take, instead of a downstream symptom

#### Scenario: Sign-in may be an outage
- **WHEN** a run stops because the sign-in kept failing while claude holds a login
- **THEN** its card says the sign-in failed and may be an outage, and recommends resuming the run instead of asking the owner to log in

### Requirement: Options for a parked change
A parked change SHALL offer to retry with the failure as a note to the builder, to open the change for re-planning, or to leave it parked.

#### Scenario: Retry a parked change
- **WHEN** the owner picks "Retry with this note" on a parked change and types a hint
- **THEN** the change is queued for the next run and its first session receives the hint

### Requirement: Notified when a card blocks work
When a card that blocks work arrives, Counterpoint SHALL notify the owner on this machine; a question from the owner's own interactive session counts as blocking, since that session is waiting in the chat. The notification is a macOS notification naming the question, the count in the tab title, and a browser notification when the console is open and the owner has allowed it. Notifications SHALL carry no secret and no host file content beyond the card's question.

#### Scenario: Owner in another app
- **WHEN** a run parks a change while the owner works in another app
- **THEN** a macOS notification says a change needs a decision
