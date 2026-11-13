# owner-steps Spec Delta

## ADDED Requirements

### Requirement: Owner steps of built changes stay cards
Every unchecked `Owner:` step of a change that is built and not archived SHALL stay a card in Needs You until it is ticked on the base branch, with the same options as any owner-step card. The card SHALL say in one line that the change is merged, with a link to its build PR when there is one. An archived change SHALL have no owner-step cards.

#### Scenario: Build PR merges with two owner steps open
- **WHEN** the build PR of a change with open owner steps 13.3 and 13.4 merges
- **THEN** both steps stay cards in Needs You, each saying the change is merged and linking the PR

#### Scenario: One step done
- **WHEN** the owner marks 13.3 Done
- **THEN** its tick lands as a small PR, 13.3 shows Done, and the card for 13.4 stays

#### Scenario: Do it for me after the merge
- **WHEN** the owner picks Do it for me on the UI audit step of a built change
- **THEN** it runs in a fresh worktree of the base branch, which holds the merged build, and its result comes back on a Land it card

#### Scenario: Last step ticked
- **WHEN** the last open owner step of a built change is ticked on the base branch
- **THEN** no card is left for the change, and it still shows Built and is not archived

#### Scenario: Archived change
- **WHEN** a change with an unchecked owner step is archived
- **THEN** it has no owner-step card
