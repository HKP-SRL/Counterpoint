# build-runs Spec Delta

## ADDED Requirements

### Requirement: Builders decide and keep going
When the plan leaves a decision open, the builder SHALL choose the reasonable option, keep working, and record the decision as assumed with what it chose, why, and the alternatives. It SHALL never wait for an answer.

#### Scenario: Open product decision
- **WHEN** the plan does not say how an empty list should look
- **THEN** the builder picks an option, builds it, and the pull request lists the decision as assumed

### Requirement: Ask first before what cannot be undone
The builder SHALL NOT take an action that cannot be undone outside its worktree: spending money, deleting or changing data that is not local, changing a production system or a live credential, or publishing something publicly. It SHALL leave that task, write the question with 2 to 4 options and the one it recommends, and go on with every task that does not wait on it.

#### Scenario: Task would change hosted data
- **WHEN** a task would run a migration against the hosted database
- **THEN** the builder does not run it, writes the question with its options and a recommendation, and builds the tasks that do not wait on it

#### Scenario: Local data is not asked about
- **WHEN** a task resets the local development database
- **THEN** the builder does it without asking

### Requirement: A run ends only when it cannot go on
A run SHALL end only when every chosen change is built, parked or skipped; when the owner stops it; at its stop time; or when no session can run at all (an authentication, credit or spend-limit error, a missing program, or a host config that cannot be read). A parked change SHALL never end the run. A change that depends on a parked change SHALL be skipped with that reason.

#### Scenario: One change parks
- **WHEN** the first of three chosen changes parks and the other two do not depend on it
- **THEN** the run builds the other two

#### Scenario: Dependent of a parked change
- **WHEN** a chosen change depends on a change that parked in the same run
- **THEN** it is skipped, and the run report says which change it waits on

### Requirement: Tools checked before the first session
Before its first session a run SHALL check that `claude`, `git` and `gh` can be run from the run's environment. If one cannot, the run SHALL end before any session and Needs You SHALL name the program.

#### Scenario: gh missing
- **WHEN** the owner starts a run and `gh` is not on the owner's login PATH
- **THEN** the run ends before any session, no change is parked, and Needs You names `gh`

## MODIFIED Requirements

### Requirement: Start and stop a run from the console
The owner SHALL start a run from the console choosing which changes on the runway to build and a stop time, SHALL see the run's progress there, and SHALL be able to stop it there. The run SHALL use the project's run settings at the moment it starts and SHALL record them with the run. The CLI SHALL offer the same start and stop. Starting and stopping SHALL require the console session or the control token.

#### Scenario: Budget shown as tokens
- **WHEN** the owner sets the budget to 40% on a model with a 1M-token window
- **THEN** the run settings show "40% of 1M = 400k tokens"

#### Scenario: Start from the console
- **WHEN** the owner picks two runway changes and a stop time in the console and presses Start
- **THEN** the run starts and the console shows each change's progress

#### Scenario: Agent tries to start a run
- **WHEN** an agent session sends a start request without the console session or the control token
- **THEN** the request is refused

### Requirement: Only runway changes are built
A run SHALL build only changes that are approved at the moment their build starts. A change whose approval is withdrawn during a run SHALL NOT start; one already building SHALL stop at its next handoff and keep its branch.

#### Scenario: Approval withdrawn mid-run
- **WHEN** the owner withdraws a queued change's approval during a run
- **THEN** that change is not built, and the run goes on with the rest

#### Scenario: Approval drifts mid-run
- **WHEN** a queued change's proposal is edited on the base branch during a run
- **THEN** that change is still built, from the edited version at the base-branch tip

### Requirement: One worktree and branch per change
Each change SHALL build in its own git worktree and branch created from the base-branch tip at the moment its build starts, outside the owner's checkout. The builder SHALL never run git commands in the owner's checkout. Builder sessions SHALL leave git state alone: Counterpoint commits each session's work in the worktree itself.

#### Scenario: Owner works during a day run
- **WHEN** the owner edits files in their checkout while a change builds
- **THEN** the build is unaffected and the owner's checkout is untouched

### Requirement: A change is built only when its task list is done
A change SHALL go to its gates only after a session ends by itself with no task left open except owner steps. When a session ends by itself with build tasks open, Counterpoint SHALL start a fresh session from its handoff. It SHALL instead park the change, without gates or delivery and with the reason in Needs You, when the session names the tasks left as waiting on the owner, when it made no progress, or when the attempt's sessions are used up.

#### Scenario: Builder stops early with work left
- **WHEN** a session ends by itself with build tasks open after committing work or ticking tasks
- **THEN** Counterpoint starts a fresh session from its handoff, and the gates run only once no build task is open

#### Scenario: Tasks left wait on the owner
- **WHEN** the builder has done every task it can and the rest wait on an ask-first question
- **THEN** the change parks with no gates and no pull request, Needs You shows the question, and the branch keeps the work

#### Scenario: Tasks left need what a build session cannot have
- **WHEN** the tasks left need a package install and a running local stack
- **THEN** the builder installs the package, starts the stack and does them, and the change does not park for them

#### Scenario: A session makes no progress
- **WHEN** a session ends by itself with build tasks open, having committed nothing and ticked nothing
- **THEN** the change parks with the reason instead of spending another session

### Requirement: Builders work through everything they can do
The builder SHALL keep working until no task it can do is left, and SHALL never stop early to leave work for a later session: the context budget is Counterpoint's to call. It SHALL install the packages, use the network and start the local services a task needs. Only a task that waits on the owner (an `Owner:` step or an ask-first question) SHALL be skipped and named with exactly what it needs, and the work SHALL go on with every task that does not wait on it.

#### Scenario: One task waits on the owner
- **WHEN** a task waits on an `Owner:` step and later groups do not wait on it
- **THEN** the builder names that task with what it needs and builds the later groups in the same session

#### Scenario: One task group needs the local stack
- **WHEN** a task needs a new dependency and a running local database
- **THEN** the builder installs the dependency, starts the database and does the task

## REMOVED Requirements

### Requirement: No agent spawns while doctor fails
**Reason**: Doctor is removed. A new Claude Code version or a settings change must never hold a run back.
**Migration**: "Tools checked before the first session" keeps the one useful check.
