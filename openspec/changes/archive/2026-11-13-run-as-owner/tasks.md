# Tasks

Decisions D-1 to D-11 are in design.md. Tests follow this change's own policy: they go where a mistake would stop a run or lose the owner's work, not on wording or layout.

## 1. Record the new direction

- [x] 1.1 Archive `first-unattended-run`, ticking its two overtaken owner steps with a note saying why (design.md, Migration Plan); verify `openspec validate --all --strict` passes with no INFO line left for `run-as-owner`
- [x] 1.2 Rewrite the direction in `docs/decisions.md` (run as owner, the D-11 roadmap, superseded decisions marked), `VISION.md`, `.claude/CLAUDE.md` and the `openspec/config.yaml` context; verify a search for "threat model", "signing key" and "passkey" finds only history notes
- [x] 1.3 Re-scope the open changes to D-11: delete `passkey-approvals`, `morning-review-signed-merge` and `council-meetings-backlog`; take `owner-identity` and the `agent-sandbox` delta out of `owner-inbox`; rename and trim `design-drafts-visual-gate` to `design-drafts` and `council-cards-decisions` to `council-lite`; fix every `x-depends-on`; add D-11's backlog items to `docs/backlog.md`; verify `openspec validate --all --strict` passes

## 2. Sessions, gates and services run as the owner

- [x] 2.1 Read the owner's login-shell environment at each run start and use it for the run's sessions, gates and services (D-2); tests cover a tool added to PATH after the daemon started, a hanging shell falling back with a Needs You item, and `COUNTERPOINT_*` left out
- [x] 2.2 Launch sessions with no sandbox profile, in auto mode with prompts denied and the worktree as working folder (D-1, D-3); a test asserts the launch arguments, and one live session in a scratch worktree installs a package and reaches a local port
- [x] 2.3 Run gates as plain child processes in their own process group and remove the `@anthropic-ai/sandbox-runtime` dependency; the gate-runner tests pass, including a gate that binds a port

## 3. One-click approvals

- [x] 3.1 Add the approvals table with a store migration, including the one-time carry-over of approval files at the base tip (D-4); tests cover approve, withdraw, restart and carry-over
- [x] 3.2 Derive the runway and change statuses from the store, with no Changed since signed status, and start builds from the base-branch tip (D-5); status and orchestrator tests pass, including a withdrawal mid-run that stops at the next handoff
- [x] 3.3 Add Approve, Approve all and Withdraw to the console and its API, and remove the approval dialog and the covered-files list; verify in the running console that approving takes one click and the Mission headline moves without a reload

## 4. Remove the trust layer

- [x] 4.1 Delete the code, tests and CLI commands listed in D-6, and the doctor gate in the governor and orchestrator; verify `pnpm lint && pnpm typecheck && pnpm test` pass and `counterpoint --help` lists none of the removed commands
- [x] 4.2 Remove the Trust page, the drift view and the approved-version-changed items from the console and its API; verify an old Trust link lands on Mission and the UI tests pass
- [x] 4.3 Check `claude`, `git`, `gh` and the gate service programs before a run's first session; a test shows the run ending before any session with the program named in Needs You
- [x] 4.4 Keep the host config keys `protected` and gate `ports` accepted and ignored; a test loads Cena's current config unchanged

## 5. Never stop

- [x] 5.1 Rewrite the builder prompt: it may install, use the network and start services; it decides and logs; it asks first only for the four classes, in the question format (D-7); the prompt tests cover each rule
- [x] 5.2 Park only for tasks waiting on the owner, no progress or used-up sessions, and show a question-parked change in Needs You with its options and recommendation; orchestrator and Needs You tests pass
- [x] 5.3 End a run only for the reasons in the `build-runs` spec, and skip a change that depends on a parked one with that reason; tests cover a park followed by two more builds, and a skipped dependent

## 6. Fast gates

- [x] 6.1 Add `when: every | final` to gates and run final gates only after the every-attempt gates pass (D-8); tests cover the short-circuit, a clean build and a failing final gate
- [x] 6.2 Expand `{changed}` with the gate's optional `paths` patterns and record an empty list as skipped (D-9); tests cover expansion, narrowing and the skip, and the console and run report show skipped and not-run gates as such

## 7. Test policy and budget

- [x] 7.1 Add the test policy, the budget and the gate tiers to the builder prompt; the prompt test asserts all three
- [x] 7.2 Measure each built change's test share and the existing tests it edited or deleted, with `tests.budget` in the host config (D-10); put both in the pull request body and mark an over-budget change on its row; tests cover the measure and the pull request body

## 8. Prove it on Cena

- [x] 8.1 Open a pull request on Cena that sets gate tiers in `.counterpoint/config.yaml` (types, lint and related tests on every attempt; build and the full suite as final gates), removes the sandbox workarounds, and rewords the planning rule "every task says how it is verified" to "by the cheapest check that fits"; verify Counterpoint loads the new config
- [x] 8.2 Owner: merge the Cena config pull request
- [x] 8.3 Reinstall and restart Counterpoint, approve one Cena change with one click and run it from the console; verify a green pull request with a preview and no terminal step, and record session time, gate time and test share in `docs/decisions.md` next to the 2026-11-11 figures

## Workflow follow-up

- Archive this change.
- Delete the four spec folders the archive leaves without requirements: `agent-sandbox`, `doctor`, `key-trust`, `signed-approvals`.
- Update the Purpose lines of `runway` and `needs-you` in `openspec/specs/`, which still mention signing.
