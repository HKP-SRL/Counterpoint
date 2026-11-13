# pull-requests Spec Delta

## ADDED Requirements

### Requirement: Merge from the console
A change whose PR is green SHALL offer Merge in the console, next to its preview link. One click SHALL merge the PR on GitHub with a merge method the repository allows, using the owner's `gh` login and never bypassing branch protection. The change SHALL then show Built within about a minute. When GitHub refuses the merge, the row SHALL say why in one line (checks failing, a review needed, a conflict) and link to the PR on GitHub. Merging SHALL require the console session or the control token.

#### Scenario: Merge a green PR
- **WHEN** the owner clicks Merge on a green PR's row
- **THEN** the PR is merged on GitHub and the change shows Built within about a minute

#### Scenario: Review required
- **WHEN** the owner clicks Merge and GitHub requires an approving review first
- **THEN** nothing is merged, and the row says a review is needed and links to the PR

#### Scenario: Agent tries to merge
- **WHEN** an agent session sends a merge request without the console session or the control token
- **THEN** the request is refused and nothing is merged
