# needs-you Specification

## Purpose
Needs You is the owner's single inbox for things only the owner can resolve: changes that parked after failed attempts, builder questions that wait on the owner, and errors that stopped a run.

## Requirements

### Requirement: One inbox
The console SHALL have one Needs You inbox listing items newest first, each with an icon, a title and a detail line, shown with a count in the navigation and the browser tab title. Items SHALL resolve themselves when their cause goes away; there is no manual dismiss for recomputed items.

#### Scenario: Count badge
- **WHEN** two items are in Needs You
- **THEN** the navigation shows 2 and the tab title starts with `(2)`

### Requirement: Parked changes in Needs You
A change that parks after N failed attempts SHALL appear in Needs You with its last failing gate output and its attempt history. Its item SHALL stay until the change builds again, is retried or leaves the runway, whatever later runs build.

#### Scenario: Parked change
- **WHEN** a change parks during a run
- **THEN** Needs You shows it with the failing gate's last lines and every attempt

#### Scenario: A later run without it
- **WHEN** a later run builds other changes and not the parked one
- **THEN** the parked change's item is still in Needs You

### Requirement: Run-stopping errors in Needs You
An error that stops a run (authentication, credit or spend limit) SHALL appear in Needs You with what the owner needs to do.

#### Scenario: Spend limit reached
- **WHEN** a run stops on a spend-limit error
- **THEN** Needs You shows the error and that the run is stopped

### Requirement: Builder questions in Needs You
A change that parks because its remaining tasks wait on an ask-first question SHALL appear in Needs You with the builder's question, its options and the option the builder recommends.

#### Scenario: Ask-first question
- **WHEN** a change parks because a task would delete data on a hosted database
- **THEN** Needs You shows the question, its options and the recommended one, and names the tasks that wait on it
