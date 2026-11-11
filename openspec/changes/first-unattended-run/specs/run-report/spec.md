# run-report Spec Delta

## Purpose
At the end of every run the owner gets one report of what happened overnight: what is ready to merge, what parked, what waits on them, and what the builder assumed.

## ADDED Requirements

### Requirement: Report at the end of every run
When a run ends (finished, stopped, stop time reached or stopped by an error) Counterpoint SHALL produce a run report listing merge-ready PRs with preview links, parked changes with their reason, items waiting on the owner, and decisions the builder assumed.

#### Scenario: Mixed night
- **WHEN** a run ends with one green PR and one parked change
- **THEN** the report lists the PR with its preview link and the parked change with its last failing gate

#### Scenario: Run stopped by an error
- **WHEN** a credit error stops the run
- **THEN** the report says so and lists what finished before it
