# Decisions

This file records the project-level decisions behind Counterpoint, why they were made, and how they turned out so far. Per-change technical decisions live in each OpenSpec change's `design.md` (shipped ones under `openspec/changes/archive/`). Product vision: `VISION.md`. Deferred work: `docs/backlog.md`.

## Core value

The owner can approve work and walk away, and come back to green, reviewable per-change PRs with preview links, plus only the questions that genuinely need them. Runway (approved, ready-to-build work ahead of the builder) is the headline metric. The system succeeds as it needs the owner less.

The owner's main goal (2026-11-11): **the AI builds the right thing.** The owner leads (plans, decides, reviews) and writes no code beyond configs. Builds run during the day as well as overnight. Two halves serve the goal, and they matter equally: the runway gets the right work started, and revision rounds (`pr-revisions`) get each change right before it merges.

## Context

- **First host: Cena** (`/Volumes/Dock/Projects/HKP/Cena`). It is a tiered restaurant OS, QR menu first, built on Next.js 16, React 19, Supabase and shadcn, with pnpm and vitest. Its default branch is `master`. It plans with OpenSpec. Counterpoint's first real run targets Cena's QR-menu work. Cena is moving to Astryx, so its drafts and Counterpoint's console will share one design system. That migration is Cena work.
- **Prior art reused for ideas, not copied:**
  - The CV repo's `tools/speckit-auto`: the run, gates and checks scripts, the 40% context-budget hook, retry and resume helpers, worktree locks, the SQLite test lock, and subagent model pinning. Everything Spec-Kit-specific is dropped.
  - A Cena prototype branch (`ccr-61ff69b1-hgtpdm`): the mission console, the loopback and origin guard, signature parsing, run-settings forms and the light/dark theme. It was built by a cloud session without the owner's acknowledgement. Its spec and its `factory/*.yaml` file contract are not reused.
- **The morning after, in the owner's words (distilled):** approved changes are built. Some carry questions or need refinement. Gates are green, or a gate carries a council question (for example, the Cook found the approved UI hard to use). Each feature has its own PR and an easy preview link.

## Key decisions

| Decision | Rationale | Outcome |
|---|---|---|
| Build lane first; design sign-off is part of it | The owner wants to approve and walk away. Reviewing mocks before the build is where changes are cheapest | Pending |
| One host change = one feature = one branch, worktree and PR | Matches how the owner thinks about features. Tasks stay internal steps | Pending |
| The host adapter reads OpenSpec (decided 2026-11-11) | Counterpoint and Cena both plan with OpenSpec now. The unit of work is a change, identified by its name. Approvals cover the whole change directory | Adopted. The adapter is being rebuilt to match the main specs |
| The adapter parses the host's planning natively from committed git blobs | A framework CLI's JSON output is not a published contract, and it reads the working tree | Good. Trusted shell: read from the base-branch tip against frozen fixtures |
| Persona findings are advisory cards, never gate failures | Taste and usability opinions should not stall merges | Pending |
| Personas test by seat: some drive the app, some review artifacts (post-v1) | Customer personas need hands-on use. Tech and compliance seats read artifacts | Pending |
| Preview: the host's deploy preview when available, a local fallback otherwise | Works with Vercel-style hosts and with any stack | Pending |
| Merge only after the owner's signed approval | "The owner approves, agents satisfy" | Pending |
| Signing via a prepared command the owner runs in a terminal | Simplest path that keeps the key out of agents' reach. Touch ID or FIDO2 could come later | Good. The owner signed Cena approvals from the printed command |
| Conflicts: the builder rebases, re-gates, and parks on failure | Keeps day runs moving while other changes merge into the base branch. The owner rarely commits there by hand | Pending |
| Drafts are standalone local mocks; the signed-off draft drives a visual gate | Easy to comment on individual elements, and binding on the builder | Pending |
| Drafts are rendered in the host's own design system | The visual gate compares like with like | Pending |
| Explore in low-fi "wire", sign off a hi-fi "full" render | Only a hi-fi render with the host's tokens and fixtures can drive a visual gate | Pending |
| Council planning cards ship in v1 with full rounds, breadcrumbs and reframe | The signature interaction | Pending |
| The council never blocks; unanswered cards proceed on the recommended option | The owner must not wait on meetings for an "ok" | Pending |
| Cards carry a reversibility class; irreversible ones park only the dependent change | Prevents silent wrong decisions on schema, auth, data, privacy and pricing | Pending |
| The council files backlog items straight into the host backlog | Catches root issues, even in work merged long ago, without owner triage | Pending |
| Seats live in per-host config; per activity, the relevant few or all seats (owner's choice) | Controls cost and noise | Pending |
| Council decisions are written back into the change's `design.md` (Decisions section) via the adapter | Planning truth stays in the host's own files | Pending |
| Builds never write planning files; one serialized planning-write path | Parallel PRs would all conflict on shared bookkeeping | Pending |
| Defer the public npm release and the no-framework adapter | Prove it on Cena first | Pending |
| Package name `@hkp/counterpoint` | The owner's npm org | Good. Until the public release, the start command is the installed `counterpoint` (npm 12's `npx` does not resolve an unpublished scoped package) |
| Console UI on Astryx; no shadcn, no Tailwind | The owner's design-system choice. Cena is migrating to Astryx too | Good. Console in light and dark, reviewed by the owner on Cena |
| Approvals live in the host repo's history: a signed commit adds `.counterpoint/approvals/<change>.json`; merge approval is the owner's signed merge commit | No extra repository, and visible in normal history. Signing with `ssh-keygen` directly avoids repo hooks and config | Good for the runway half: Cena approval commits add only the approval file and verify with `ssh-keygen -Y`. Merge approval comes with `morning-review-signed-merge` |
| No separate approvals repository | An early research proposal (a separate `approvals.git`) was rejected once the "why" was clear | Final |
| Spawn the `claude` CLI with stream-json behind an AgentRunner port; the Agent SDK only as a later second implementation | Typed limit and usage fields are available from the stream. The SDK is 0.x and churns. Spawning the CLI avoids the third-party-login terms issue | Good. The live sandbox probe runs headless `claude -p` through the runner |
| v1 keeps variants and "More like B"; defers live watch and interjection, post-build persona review, and full gamification | Prove an overnight run before widening | Pending |
| Approval statement format: sorted keys, no "prepared" block | The owner picked the minimal format. A hand-edited statement is invalid, not misleading | Good. `counterpoint/approval/v1` shipped; the OpenSpec move bumps it to `v2` (item type `change`) |
| Agent sessions run in Claude Code's auto permission mode, not dontAsk. No deterministic guarantee rests on the classifier | The owner runs auto daily. Headless default mode denies every unlisted call, so builders would stall | Good. Proven live in auto mode; the probe evaluator counts only deterministic refusals |
| Opt out of the subprocess environment scrub (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0`), with three Counterpoint-owned replacements | On claude 2.1.321 the scrub forced auto mode down to default mode. The replacements: 1. `autoAllowBashIfSandboxed: false`. 2. Doctor fails if any settings source turns isolation off. 3. A credential-environment probe row | Good. Replacement 1 is not inert (WR-01, verified live on claude 2.1.322: bare `Bash` in `--allowedTools` makes no Bash call accepted by rule in auto mode, with or without it the decision is the same, while flipping `autoAllowBashIfSandboxed` changes the decision path). The settings check now also fails on `allowWrite`, `allowRead`, `additionalDirectories` and unix-socket widenings (CR-01, closed 2026-11-11) |
| Agent Write and Edit are confined to the session folder (an allow-only-workdir grant plus `blockWritesOutsideWorkingDirectories`) | `allowWrite: []` confines only Bash | Good. The probe's outside row also runs a Bash `touch` outside the folder; on claude 2.1.322 the OS sandbox refused it (CR-01, closed 2026-11-11) |
| gh's Keychain reachability is a recorded per-machine accepted risk (`counterpoint accept-risk gh-keychain`), printed on every doctor run | Sandboxed Bash can read the macOS Keychain, while every gh config-file step is blocked | Accepted. The verdict reads "boxed in, with one accepted risk", never a plain pass |
| Credential-environment row: deny `CLAUDE_CODE_MESSAGING_TOKEN`. The sandbox's own loopback proxy login is the named exception `sandbox-proxy-login` | None of these is a protected target. Claude Code sets the proxy login after deny entries apply. A non-loopback host is a real finding | Good |
| `GIT_CONFIG_KEY_<n>` is not a credential name. Claude Code 2.1.322 passes git config to sandboxed shells through `GIT_CONFIG_COUNT`/`KEY_<n>`/`VALUE_<n>`; the KEY holds a setting name. Only that exact name shape is exempt; `GIT_CONFIG_VALUE_<n>` is still judged by its value shape | Found by the CR-01 live probe run (2026-11-11): the KEY segment made the credential-environment row fail doctor on the owner's machine | Good |
| The one-time sign-in code may appear in the browser opener's argv (IN-03). `xdg-open` is resolved by absolute path | One-time, short-lived code; a stolen code fails the owner's own sign-in visibly; a console session cannot sign approvals. Keeping it out of argv would break the SameSite=Strict sign-in | Accepted |
| Doctor also fails on `sandbox.network.allowLocalBinding`, `sandbox.enableWeakerNestedSandbox` and `sandbox.enableWeakerNetworkIsolation` | The docs name them as weakening the sandbox; on macOS `allowLocalBinding` reaches every localhost service, the console included | Good |
| Live-check stop rules narrowed: only a protected-target failure stops work; other live surprises become recorded findings | Three sandbox re-plans in one change ("going in circles") | Adopted |
| The trusted shell closed with its code review open. CR-01, WR-02, WR-04, WR-05 and WR-06 (plus verifying WR-01) are the first work of `first-unattended-run` | Trust fixes belong before the first overnight run, not after it | Done 2026-11-11 (WR-01 corrected in the record). Live doctor on the owner's machine: boxed in, with the one accepted gh-keychain risk |
| Build in seven vertical slices, each usable on Cena: trusted shell, first unattended run, PR revisions, morning review, drafts and visual gate, council cards, council meetings | The core value lives in the build lane. The first run's PRs will need revisions straight away. The council carries the most scope-creep risk, so it comes last | Adopted (PR revisions added 2026-11-11) |
| The owner leads and does not hand-code; builds run during the day as well as overnight (decided 2026-11-11) | The owner's job is to plan, decide and review. Any fix the owner would have to make by hand is a missing feature, not a fallback | Adopted |
| Revision rounds on open PRs are as important as the runway (`pr-revisions`) | A change will rarely be right in one shot. Without a way to send a PR back with notes, the owner would re-plan the change or fix it by hand | Adopted |
| Revision notes are written in Counterpoint only: pinned on the change's preview or as general notes in the console. A round starts only when the owner sends the batch from the console. The pin overlay is built in `pr-revisions` and reused by drafts | The owner stays in one place. The preview runs agent-written code, so its pins are proposals until sent from the console. PR comments never count: agents can reach gh's credential (accepted risk `gh-keychain`). The signed merge stays the final check | Pending |
| The governor serves work the owner is waiting on first, then builds, then the council's capped share | During the day the scarce thing is the owner's attention, not build time | Pending |
| The variants and "More like B" round model is built once for drafts and reused by council cards | One interaction, one implementation | Pending |
| A single quota governor sits in front of every agent spawn. Usage-limit pauses cover all lanes from the first run; revision rounds jump the build queue from `pr-revisions`; full ordering (owner-waiting work, builds, the council's capped share) arrives with council cards | The council must never starve a build, and the owner must not wait behind the queue | Pending |

## Known accepted risks

These are recorded per machine and printed on every `counterpoint doctor` run.

- **`gh-keychain`.** A live probe (claude 2.1.319, macOS) showed that sandboxed agent Bash can read macOS Keychain items, so gh's keyring credential is reachable by agents. Every gh config-file step is blocked. The owner recorded the risk with `counterpoint accept-risk gh-keychain` (terminal only, revocable). Doctor applies it only when the Keychain lookup is the only gh step that reached.
- **`sandbox-proxy-login`.** Sandboxed Bash sees 12 proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and others) carrying a user:password login for a loopback host. It also sees the gcloud proxy password `CLOUDSDK_PROXY_PASSWORD` next to a loopback `CLOUDSDK_PROXY_ADDRESS`. This is the sandbox network proxy's own per-session login, which Claude Code sets after the launch profile's deny entries apply. The exception applies only to those names with a loopback host. A non-loopback host or address fails the row.

## Superseded guidance

`.claude/CLAUDE.md`'s technology tables predate several of these decisions. Where they conflict, this file wins:
- Spawn `claude -p` with stream-json, not the Agent SDK.
- Astryx, not Tailwind or shadcn.
- Read OpenSpec content natively from git, not through a framework CLI's JSON output.
- The package is `@hkp/counterpoint`.

## Out of scope

| Not doing | Why |
|---|---|
| Multi-vendor agent runtimes | Claude Code only, by principle |
| Cloud-hosted execution | Local worktrees are the product. Cloud orchestrators are a shrinking, vendor-dominated market |
| Becoming a second spec system (a kanban board as source of truth) | Counterpoint reads the host's plan and never owns it |
| UI as routes inside the host app | Counterpoint is its own local server, so it works with any stack |
| Auto-merge when gates are green, or without the owner | Merges only follow the owner's signed merge commit |
| An agent's self-reported "done" as a gate | Gates are judged by exit code only |
| The council blocking work or failing items on persona opinion | The council is advisory. Persona findings never fail gates |
| Free-flow debate as the default, an LLM-chosen next speaker, majority votes | They drift to conformity, add nondeterminism and give false precision. A structured protocol is used instead |
| Numeric persona usability scores | The validity of synthetic users is weak. Findings stay qualitative, with evidence |
| The council reordering the roadmap or editing specs | The council would become a second planner. It files backlog items and cards only |
| A visual design editor or drag-and-drop canvas | The owner reviews and steers; the owner does not draw |
| Figma round-trip | It would be a second source of design truth. Revisit after v1 |
| Multi-user accounts, roles, real-time collaboration | Single owner, loopback only |
| Chat with the agent as the primary UI | Pulls the owner into babysitting |
| A built-in code editor or diff viewer | Deep-link to GitHub and the owner's editor instead |
| Cross-provider cost and billing dashboards | One provider. Per-run tokens and budget % only |
| shadcn/ui or Tailwind for Counterpoint's UI | The console uses Astryx |
| A pixel-exact, zero-tolerance visual gate | Constant false failures from fonts, anti-aliasing and data |
| Reusing the Cena prototype's spec or `factory/*.yaml` contract | It was built without the owner's acknowledgement. Only components and ideas are reused |
| Spec-Kit-specific parts of `speckit-auto` | Not relevant to OpenSpec hosts |
