# pull-requests Spec Delta

## ADDED Requirements

### Requirement: Merge from the console
A green PR (Counterpoint's gates passed on the change's latest build, and the PR is open) SHALL offer Merge in the console, next to its preview link. One click SHALL merge it on GitHub with a merge method the repository allows, using the owner's `gh` login, never bypassing branch protection, and the change SHALL show Built within about a minute. When GitHub refuses, the row SHALL say why in one line and link to the PR. Merging SHALL require the console session or the control token.

#### Scenario: Merge a green PR
- **WHEN** the owner clicks Merge on a green PR's row
- **THEN** the PR is merged on GitHub and the change shows Built within about a minute

#### Scenario: Review required
- **WHEN** the owner clicks Merge and GitHub requires an approving review first
- **THEN** nothing is merged, and the row says a review is needed and links to the PR

#### Scenario: Request without a session
- **WHEN** a merge request comes without the console session or the control token
- **THEN** the request is refused and nothing is merged

### Requirement: Only the gated commit merges
A merge from the console SHALL merge only the commit Counterpoint's gates passed. If the PR's head is any other commit, nothing SHALL be merged, and the row SHALL say that the PR changed on GitHub since Counterpoint built it.

#### Scenario: Only the gated commit merges
- **WHEN** a commit was pushed to a green PR's branch after Counterpoint's gates passed, by anyone, an agent session included, and the owner clicks Merge
- **THEN** nothing is merged, and the row says the PR changed on GitHub since Counterpoint built it, with a link to the PR
