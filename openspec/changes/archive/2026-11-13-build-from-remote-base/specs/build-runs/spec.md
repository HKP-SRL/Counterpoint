# Spec Delta

## MODIFIED Requirements

### Requirement: One worktree and branch per change
Each change SHALL build in its own git worktree and branch created from the base-branch tip on the remote, fetched at the moment its build starts, outside the owner's checkout. The builder SHALL never run git commands in the owner's checkout. Builder sessions SHALL leave git state alone: Counterpoint commits each session's work in the worktree itself.

#### Scenario: Owner works during a day run
- **WHEN** the owner edits files in their checkout while a change builds
- **THEN** the build is unaffected and the owner's checkout is untouched

#### Scenario: Local base branch behind the remote
- **WHEN** the owner's local base branch is behind the remote when a change's build starts
- **THEN** the change's branch starts from the remote's tip, its gates come from the host config there, and the owner's local base branch is unchanged
