# build-runs Specification

## Purpose
Unattended builds of approved changes: how a run starts and stops, where each change is built, how sessions hand off at the context budget, and how the run survives usage limits, errors and crashes.

## Requirements

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

### Requirement: One run at a time on this computer
Only one run SHALL go at a time on this computer, across projects. While a run goes in one project, every other project's run view SHALL say which project's run is going, and a start there SHALL be refused with a reason that names that project.

#### Scenario: Two projects
- **WHEN** a run is going in Cena and the owner opens another project's console
- **THEN** its run view says a run is going in Cena, and starting a run there is refused, naming Cena

### Requirement: Run settings page
Each project SHALL have a Settings page in the console holding its run settings: model, effort, context budget and per-session limits. Saving SHALL be a guarded POST to the daemon. Until the owner saves, defaults apply. A run SHALL use the settings saved when it starts and keep them until it ends. The Run card SHALL show the settings a new run will use. The CLI MAY override model, effort and budget for one run.

#### Scenario: Effort set in Settings
- **WHEN** the owner sets the effort to high on the Settings page and starts a run
- **THEN** every builder session of that run launches with effort high, and the run shows it

#### Scenario: Settings changed during a run
- **WHEN** the owner changes the model while a run is going
- **THEN** the running run keeps its model and the next run uses the new one

#### Scenario: Per-session limits
- **WHEN** the owner sets 300 turns, $30 and 6 sessions per attempt
- **THEN** each builder session stops at 300 turns or $30 estimated cost, and a change with build tasks still open after 6 sessions of one attempt parks with the reason instead of going to its gates

### Requirement: Only runway changes are built
A run SHALL build only changes that are approved at the moment their build starts. A change whose approval is withdrawn during a run SHALL NOT start; one already building SHALL stop at its next handoff, before its gates or before its delivery, whichever comes first, and keep its branch.

#### Scenario: Approval withdrawn mid-run
- **WHEN** the owner withdraws a queued change's approval during a run
- **THEN** that change is not built, and the run goes on with the rest

#### Scenario: Approval withdrawn during the last session
- **WHEN** the owner withdraws a change's approval while its last builder session runs
- **THEN** its gates do not run, no pull request is opened or updated, and its branch keeps the work

#### Scenario: Approval drifts mid-run
- **WHEN** a queued change's proposal is edited on the base branch during a run
- **THEN** that change is still built, from the edited version at the base-branch tip

### Requirement: One worktree and branch per change
Each change SHALL build in its own git worktree and branch created from the base-branch tip on the remote, fetched at the moment its build starts, outside the owner's checkout. The builder SHALL never run git commands in the owner's checkout. Builder sessions SHALL leave git state alone: Counterpoint commits each session's work in the worktree itself. An existing branch SHALL be built on again, and a deleted worktree folder SHALL be made again.

#### Scenario: Owner works during a day run
- **WHEN** the owner edits files in their checkout while a change builds
- **THEN** the build is unaffected and the owner's checkout is untouched

#### Scenario: Local base branch behind the remote
- **WHEN** the owner's local base branch is behind the remote when a change's build starts
- **THEN** the change's branch starts from the remote's tip, its gates come from the host config there, and the owner's local base branch is unchanged

### Requirement: A branch built again takes the moved base
When the base has moved past a change's existing branch, Counterpoint SHALL merge the base into it as the owner, planning files taking the base's version. A conflict in any other file SHALL go to one builder session told to resolve only that conflict. When the change's latest pull request was closed or merged and nothing was built since, the change SHALL start again from the base, keeping the old branch as `cp-backup/<change>-<yyyymmdd-hhmm>`.

#### Scenario: Base moved since the last build
- **WHEN** a parked change is built again after other pull requests merged into the base
- **THEN** the base is merged into its branch, the next session gets the last handoff and the last failing gate's output, and the change does not park because its branch is behind

#### Scenario: Conflict with the base
- **WHEN** merging the moved base into a change's branch conflicts in a source file
- **THEN** one session resolves that conflict only, Counterpoint commits the merge, and the gates run as usual

#### Scenario: Pull request closed
- **WHEN** a change whose pull request the owner closed is built again
- **THEN** it starts from the base, its old branch is kept as `cp-backup/<change>-<stamp>`, and the push replaces the closed pull request's branch

### Requirement: A change built again continues where it stopped
A build on a change's existing branch SHALL continue from the change's previous build: its handoff, its last failing gate's output and its ticked tasks reach the next session. When no build task is open and no gate failure is waiting, the change SHALL go straight to its gates without a builder session.

#### Scenario: Nothing left to build
- **WHEN** a change whose every build task is done is built again with no gate failure waiting
- **THEN** no builder session starts and its gates run

#### Scenario: Gate failure carried over
- **WHEN** a change parked after its gate failed is built again in a new run
- **THEN** its first session is given that gate's last output lines

### Requirement: The remote branch is checked before building
Before any session, Counterpoint SHALL check the change's branch on the remote. A remote branch the build would replace SHALL be replaced at delivery only while it is still at the commit Counterpoint saw there: its own last push, or the branch of a closed pull request. When the remote branch of an open pull request holds commits Counterpoint did not push, the change SHALL park before any session, with the reason.

#### Scenario: Branch deleted by hand
- **WHEN** the owner deleted a change's local branch and its pull request is open with Counterpoint's last push
- **THEN** the branch is made again from the base and its push replaces exactly that last push, after the gates pass

#### Scenario: Someone else pushed to the branch
- **WHEN** the remote branch of a change's open pull request has a commit Counterpoint did not push and the local branch lacks it
- **THEN** the change parks before any session and says so

### Requirement: Fresh sessions with context-budget handoff
Each build SHALL run in fresh `claude -p` sessions. When a session's context passes the run's budget, measured against the model's real window (never a hard-coded size), Counterpoint SHALL have it finish the current task, write a handoff and stop, SHALL commit the session's work with the handoff, and SHALL start the next fresh session from that handoff.

#### Scenario: Budget reached
- **WHEN** a session's context passes 40% of the model's window mid-task
- **THEN** it finishes that task, writes a handoff and stops, Counterpoint commits the work with the handoff, and a new session continues from it

### Requirement: The budget measures the main thread
A session's context fill SHALL be its main thread's. A subagent the session starts has its own context: its usage SHALL count toward cost, never toward the budget or the fill the console shows.

#### Scenario: A subagent's context is larger
- **WHEN** a subagent's context passes the budget while the session's main thread is under it
- **THEN** the session goes on, and the console shows the main thread's fill

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

### Requirement: Failing sessions park the change with claude's error
Counterpoint SHALL keep the error each session ended on. When two sessions of a change in a row end on an error from claude (an unknown model, a turn or budget cap, a refused request) without committing or ticking anything, the change SHALL park with that error in its reason instead of using up the attempt's sessions.

#### Scenario: Unknown model name
- **WHEN** every session fails because claude does not know the run's model
- **THEN** the change parks after its second session, and Needs You shows claude's error

### Requirement: Builders work through everything they can do
The builder SHALL keep working until no task it can do is left, and SHALL never stop early to leave work for a later session: the context budget is Counterpoint's to call. It SHALL install the packages, use the network and start the local services a task needs. Only a task that waits on the owner (an `Owner:` step or an ask-first question) SHALL be skipped and named with exactly what it needs, and the work SHALL go on with every task that does not wait on it.

#### Scenario: One task waits on the owner
- **WHEN** a task waits on an `Owner:` step and later groups do not wait on it
- **THEN** the builder names that task with what it needs and builds the later groups in the same session

#### Scenario: One task group needs the local stack
- **WHEN** a task needs a new dependency and a running local database
- **THEN** the builder installs the dependency, starts the database and does the task

### Requirement: Usage limits pause every lane
On a usage limit every agent lane SHALL pause until the reported reset time plus 2 minutes and then resume on its own. Transient API errors SHALL back off and retry. Auth, credit and spend-limit errors SHALL stop the run and land in Needs You. Only claude's own error decides how a session ended: a session that succeeds is never read as a limit or an error because of what its summary says.

#### Scenario: Five-hour limit hit at 02:00
- **WHEN** a usage limit resets at 03:10
- **THEN** the run holds and resumes at 03:12 without the owner

#### Scenario: Summary mentions a limit
- **WHEN** a session succeeds and its summary says it fixed the "spend limit" message
- **THEN** the run goes on as after any successful session

#### Scenario: Expired login
- **WHEN** a session fails with an authentication error and claude holds no login
- **THEN** the run stops and Needs You says why

### Requirement: A failed sign-in is checked before the run stops
When a session's sign-in fails, Counterpoint SHALL ask claude whether it holds a login. Without one, the run SHALL stop and Needs You SHALL say to sign in. With one, or when claude cannot tell, the session SHALL be tried again after a backoff of 1, 2 and 4 minutes. If it still fails, the run SHALL stop, and Needs You SHALL say it may be an outage and offer to resume the run.

#### Scenario: Sign-in fails during an outage
- **WHEN** a session's sign-in fails with an error page from the API's proxy after server errors, while claude holds a login
- **THEN** the session runs again a minute later, and the run goes on once it passes

#### Scenario: The outage outlasts the retries
- **WHEN** the sign-in fails four times in a row while claude holds a login
- **THEN** the run stops, and Needs You asks "Sign-in failed, maybe an outage. Resume?" with resuming the run recommended

### Requirement: Passing errors in calibration and version checks never end a run
The session that learns a model's context window SHALL end like any session: a usage limit SHALL wait for the reset, and transient API errors and failed sign-ins SHALL be tried again after a backoff, up to three times. A `claude --version` that fails SHALL be tried again up to three times. Only an error no retry fixes SHALL end the run.

#### Scenario: Overloaded API after a claude update
- **WHEN** the run learns the window of a new claude version and the API answers overloaded
- **THEN** it tries again a minute later and the run builds

### Requirement: A long usage hold is told
When agent work starts waiting on a usage hold of 3 hours or more, Needs You SHALL show one card that blocks nothing, naming the limit window that holds work and when it resets. The card SHALL close itself when nothing waits on the hold any more.

#### Scenario: Weekly window near its limit
- **WHEN** the weekly window is at its ceiling two days before it resets and the next session would start
- **THEN** Needs You says the weekly usage limit holds agent work until the reset time, and the card closes once work resumes

### Requirement: Single governor in front of every spawn
Every agent spawn on the machine, across hosts, SHALL go through one governor that applies usage-limit pauses to all lanes together.

#### Scenario: Two hosts
- **WHEN** a usage limit is hit while building on one host
- **THEN** agent work on every host pauses until the reset

### Requirement: Crash and reboot recovery
If Counterpoint is killed or the machine reboots mid-run, the next start SHALL reconcile in-progress runs and resume each from its last handoff, leaving no orphaned agent, gate or server processes.

#### Scenario: Reboot during a build
- **WHEN** the machine reboots while a change builds
- **THEN** after `counterpoint` starts again the run resumes from the last committed handoff

### Requirement: Stop time honoured
A run SHALL start no new session after its stop time and SHALL stop at a clean point, recording what remains.

#### Scenario: Stop time reached
- **WHEN** the stop time passes during a session
- **THEN** the session ends at its next handoff and no new session starts

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
A run SHALL end only when every chosen change is built, parked or skipped; when the owner stops it; at its stop time; or when no session or gate can run at all (an authentication, credit or spend-limit error, a missing program, a host config that cannot be read, or a host service that will not start). A parked change SHALL never end the run. A change that depends on a change that is not built SHALL be skipped with that reason.

#### Scenario: One change parks
- **WHEN** the first of three chosen changes parks and the other two do not depend on it
- **THEN** the run builds the other two

#### Scenario: Dependent of a parked change
- **WHEN** a chosen change depends on a change that parked in the same run
- **THEN** it is skipped, and the run report says which change it waits on

### Requirement: Dependencies are built first
A change SHALL build only once each change it depends on (`x-depends-on`) that is not archived is built: its build PR merged, or every task checked. Until then Run SHALL leave it out, and a run the owner picks it for SHALL skip it with "Waits on" and the change it waits on, so its branch never starts from a base without its dependency's code.

#### Scenario: Dependency green but not merged
- **WHEN** change B depends on change A, and A's build is green with its PR open
- **THEN** Run does not build B, and B shows Waits on A

#### Scenario: Dependency merged
- **WHEN** A's PR merges
- **THEN** B can build, and its branch starts from the base with A's code

### Requirement: Tools checked before the first session
Before its first session a run SHALL check that `claude`, `git` and `gh` can be run from the run's environment. If one cannot, the run SHALL end before any session and Needs You SHALL name the program.

#### Scenario: gh missing
- **WHEN** the owner starts a run and `gh` is not on the owner's login PATH
- **THEN** the run ends before any session, no change is parked, and Needs You names `gh`
