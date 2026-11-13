# Decisions

This file records the project-level decisions behind Counterpoint, why they were made, and how they turned out so far. Per-change technical decisions live in each OpenSpec change's `design.md` (shipped ones under `openspec/changes/archive/`). Product vision: `VISION.md`. Deferred work: `docs/backlog.md`.

## Core value

The owner can approve work and walk away, and come back to green, reviewable per-change PRs with preview links, plus only the questions that genuinely need them. Runway (approved, ready-to-build work ahead of the builder) is the headline metric. The system succeeds as it needs the owner less.

The owner's main goal (2026-11-11): **the AI builds the right thing.** The owner leads (plans, decides, reviews) and writes no code beyond configs. Builds run during the day as well as overnight. Two halves serve the goal, and they matter equally: the runway gets the right work started, and revision rounds (`pr-revisions`) get each change right before it merges.

## Direction (2026-11-12): run as the owner

Counterpoint acts as the owner. `run-as-owner` removes the trust layer the first slices built: the sandbox, doctor, signed approvals, key pinning, the integrity baseline and protected paths.

- **Why.** On 2026-11-11, 4 of 7 Cena runs died on Counterpoint's own walls: a stripped environment, a stale PATH, a sandbox that could not reach Supabase or install a package. No run stopped on a real product question. The CV repo's unattended runs worked in auto mode as the owner, with no sandbox.
- **The three pains to solve:** slow builds, unusable UIs, interruptions.
- **Sessions** are headless Claude Code sessions in auto mode, in the change's worktree, with the owner's login environment, tools and network. Gates are plain commands.
- **Approving** is one click in the console. Nothing is signed.
- **Runs never stop** for what the builder can do itself. It decides and logs. It asks first only before spending money, changing data that is not local, touching production or a live credential, or publishing.
- **Fast gates and a test budget.** A gate runs on every attempt or once at the end. The test share is shown, never enforced.

Baseline before the change (Cena, 2026-11-11): builder sessions 24 to 49 minutes per change, a full gate round about 1 minute, the Astryx change 44% tests.

After the change (Cena, 2026-11-13, the same Astryx change rebuilt from scratch, PR #16 green with a preview on the first gate attempt): builder sessions 44 minutes in all (29 + 9 in the green run, plus 6 in an earlier run a sign-in outage stopped). Gates 77 seconds: types, lint and related tests 18 seconds on every attempt, build and the full suite 59 seconds once at the end. 36% tests against a 30% budget, 10 existing test files edited.

### Roadmap

| Order | Change | What the owner gets |
|---|---|---|
| 1 | `run-as-owner` | Runs that do not stop on walls, one-click approval, fast gates |
| 2 | `owner-inbox` (trimmed) | Questions as cards, one at a time, Enter accepts the recommended answer, a notification |
| 3 | `quiet-console` (new) | A one-line home, merge in one click, far less text |
| 4 | `one-screen-plans` (new) | A one-screen brief per change; large changes are split |
| 5 | `design-drafts` (was `design-drafts-visual-gate`) | 2–3 variants with real data, pinned comments, sign-off, a design-rules file per host |
| 6 | `pr-revisions` | Send a pull request back with pinned notes |
| 7 | `council-lite` (replaces both council changes) | The top three findings at plan time and after the build |

Dropped: `passkey-approvals`, `morning-review-signed-merge`, `council-meetings-backlog`. Moved to `docs/backlog.md`: the visual gate, a scheduled full run, parallel builds with rebase, the owner's MCP servers in sessions.

2026-11-13: `design-drafts` moves ahead of `quiet-console` and `one-screen-plans`, and Counterpoint builds it on itself (`.counterpoint/config.yaml`). Its first real use drafts `quiet-console`. Drafts hold the build: a change with drafts builds only after every screen is signed off.

### Standing risk

An unattended session has the owner's full rights. It could edit files outside its worktree, use the owner's `gh` login, reach the console, or act on text it read on the web. The owner accepts this, as in daily Claude Code use. What limits it: auto mode's classifier reviews each action, sessions start in the worktree and are told to stay there, and work reaches the base branch only through a pull request the owner merges. Branch protection on GitHub is the optional hard stop.

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
| Merge only after the owner's signed approval | "The owner approves, agents satisfy" | Changed 2026-11-12 (`run-as-owner`): only the owner merges; nothing is signed |
| Signing via a prepared command the owner runs in a terminal | Simplest path that keeps the key out of agents' reach. Touch ID or FIDO2 could come later | Good at first: the owner signed Cena approvals from the printed command. Superseded 2026-11-11 by passkey approvals: switching between console and terminal was too much friction. Passkey approvals were dropped too on 2026-11-12: approving is one click |
| Conflicts: the builder rebases, re-gates, and parks on failure | Keeps day runs moving while other changes merge into the base branch. The owner rarely commits there by hand | Pending |
| Drafts are standalone local mocks; the signed-off draft drives a visual gate | Easy to comment on individual elements, and binding on the builder | Changed 2026-11-12: drafts stay (`design-drafts`); the visual gate moved to the backlog |
| Drafts are rendered in the host's own design system | The visual gate compares like with like | Pending |
| Explore in low-fi "wire", sign off a hi-fi "full" render | Only a hi-fi render with the host's tokens and fixtures can drive a visual gate | Pending |
| Council planning cards ship in v1 with full rounds, breadcrumbs and reframe | The signature interaction | Superseded 2026-11-12 by `council-lite`: the top three findings at plan time and after the build |
| The council never blocks; unanswered cards proceed on the recommended option | The owner must not wait on meetings for an "ok" | Pending |
| Cards carry a reversibility class; irreversible ones park only the dependent change | Prevents silent wrong decisions on schema, auth, data, privacy and pricing | Pending |
| The council files backlog items straight into the host backlog | Catches root issues, even in work merged long ago, without owner triage | Pending |
| Seats live in per-host config; per activity, the relevant few or all seats (owner's choice) | Controls cost and noise | Pending |
| Council decisions are written back into the change's `design.md` (Decisions section) via the adapter | Planning truth stays in the host's own files | Pending |
| Builds never write planning files; one serialized planning-write path | Parallel PRs would all conflict on shared bookkeeping | Pending |
| Defer the public npm release and the no-framework adapter | Prove it on Cena first | Pending |
| Package name `@hkp/counterpoint` | The owner's npm org | Good. Until the public release, the start command is the installed `counterpoint` (npm 12's `npx` does not resolve an unpublished scoped package) |
| Console UI on Astryx; no shadcn, no Tailwind | The owner's design-system choice. Cena is migrating to Astryx too | Good. Console in light and dark, reviewed by the owner on Cena |
| Approvals live in the host repo's history: a signed commit adds `.counterpoint/approvals/<change>.json`; merge approval is the owner's signed merge commit | No extra repository, and visible in normal history. Signing with `ssh-keygen` directly avoids repo hooks and config | Good for the runway half: Cena approval commits add only the approval file and verify with `ssh-keygen -Y`. Superseded 2026-11-12 (`run-as-owner`): approvals live in Counterpoint's store, one click each. Open changes approved by the old files carried over once |
| No separate approvals repository | An early research proposal (a separate `approvals.git`) was rejected once the "why" was clear | Final |
| Spawn the `claude` CLI with stream-json behind an AgentRunner port; the Agent SDK only as a later second implementation | Typed limit and usage fields are available from the stream. The SDK is 0.x and churns. Spawning the CLI avoids the third-party-login terms issue | Good. The live sandbox probe runs headless `claude -p` through the runner |
| v1 keeps variants and "More like B"; defers live watch and interjection, post-build persona review, and full gamification | Prove an overnight run before widening | Pending |
| Approval statement format: sorted keys, no "prepared" block | The owner picked the minimal format. A hand-edited statement is invalid, not misleading | Superseded 2026-11-12: nothing is signed |
| Agent sessions run in Claude Code's auto permission mode, not dontAsk. No deterministic guarantee rests on the classifier | The owner runs auto daily. Headless default mode denies every unlisted call, so builders would stall | Good. Proven live in auto mode; the probe evaluator counts only deterministic refusals (deny rule, OS sandbox, outside-write block), read from their protocol fields since matcher revision 5. Since 2026-11-12: still auto mode, with prompts denied and no sandbox |
| Opt out of the subprocess environment scrub (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0`), with three Counterpoint-owned replacements | On claude 2.1.321 the scrub forced auto mode down to default mode. The replacements: 1. `autoAllowBashIfSandboxed: false`. 2. Doctor fails if any settings source turns isolation off. 3. A credential-environment probe row | Good. Replacement 1 is not inert (WR-01, verified live on claude 2.1.322: bare `Bash` in `--allowedTools` makes no Bash call accepted by rule in auto mode, with or without it the decision is the same, while flipping `autoAllowBashIfSandboxed` changes the decision path). Superseded 2026-11-12: the three replacements went with the sandbox |
| Worktrees get dependencies as copy-on-write clones of folders from the owner's checkout (`worktree.clone`, e.g. `node_modules`), not by installing and not by symlink (decided 2026-11-11) | Nothing in a run may install: no internet for gates or builders, and an install outside the sandbox would run package scripts the builder could change. A symlink broke `next build` (Turbopack refuses a `node_modules` outside the project) and could lead writes into the owner's checkout | Adopted. About 5 s for Cena's `node_modules` on APFS; git-ignored folders only, and every link must stay inside the clone. Since 2026-11-12 a builder may install; the clone stays because it is the fastest way to get `node_modules` |
| The integrity baseline pins the whole committed `.claude/` folder, not only the execution-capable keys of `.claude/settings.json` (decided 2026-11-11, task 7.6) | Builders load the host's skills, agents, commands and `CLAUDE.md` (`--setting-sources user,project`). Skill and agent front matter can define hooks that run as the owner outside the sandbox, and `CLAUDE.md` steers every session. Pinning the folder is simpler than parsing each format and also catches a changed prompt | Adopted. Every entry by git mode and object id, checked at the base tip and at each build's base commit; a change needs the owner's `y` at `counterpoint trust`. Superseded 2026-11-12: removed with the trust layer |
| Doctor judges probe refusals by protocol fields and outcomes, never by claude's wording; the version-distrust rule is dropped (decided 2026-11-11, task 7.5) | Claude Code updates almost daily, and a new version must never stop a run unless it really breaks the sandbox. Until then a refusal counted only when its sentence matched the one recorded on 2.1.322, so any reworded message turned rows Not checked and failed doctor | Good. Matcher revision 5 (`matcherVersion: r5`): the permission decision's reason type, the `permission_denied` event and `result.permission_denials` decide who refused; macOS's own `Operation not permitted` is the one text still read; outcomes (canary absent, probe files untouched, control reached) need none. A refusal of an unknown reason type stays Not checked; a canary reaching the treatment stays Reachable and still fails doctor. Superseded 2026-11-12: doctor and its probe are removed |
| Agent Write and Edit are confined to the session folder (an allow-only-workdir grant plus `blockWritesOutsideWorkingDirectories`) | `allowWrite: []` confines only Bash | Good. The probe's outside row also runs a Bash `touch` outside the folder; on claude 2.1.322 the OS sandbox refused it (CR-01, closed 2026-11-11). Superseded 2026-11-12: no confinement |
| gh's Keychain reachability is a recorded per-machine accepted risk (`counterpoint accept-risk gh-keychain`), printed on every doctor run | Sandboxed Bash can read the macOS Keychain, while every gh config-file step is blocked | Superseded 2026-11-12: sessions use the owner's `gh` login on purpose |
| Credential-environment row: deny `CLAUDE_CODE_MESSAGING_TOKEN`. The sandbox's own loopback proxy login is the named exception `sandbox-proxy-login` | None of these is a protected target. Claude Code sets the proxy login after deny entries apply. A non-loopback host is a real finding | Superseded 2026-11-12: sessions get the owner's whole environment |
| `GIT_CONFIG_KEY_<n>` is not a credential name. Claude Code 2.1.322 passes git config to sandboxed shells through `GIT_CONFIG_COUNT`/`KEY_<n>`/`VALUE_<n>`; the KEY holds a setting name. Only that exact name shape is exempt; `GIT_CONFIG_VALUE_<n>` is still judged by its value shape | Found by the CR-01 live probe run (2026-11-11): the KEY segment made the credential-environment row fail doctor on the owner's machine | Superseded 2026-11-12: the row is gone |
| The one-time sign-in code may appear in the browser opener's argv (IN-03). `xdg-open` is resolved by absolute path | One-time, short-lived code; a stolen code fails the owner's own sign-in visibly; a console session cannot sign approvals. Keeping it out of argv would break the SameSite=Strict sign-in | Accepted. Since 2026-11-12 a console session can approve, which unlocks no more than a pull request |
| Doctor also fails on `sandbox.network.allowLocalBinding`, `sandbox.enableWeakerNestedSandbox` and `sandbox.enableWeakerNetworkIsolation` | The docs name them as weakening the sandbox; on macOS `allowLocalBinding` reaches every localhost service, the console included | Superseded 2026-11-12: doctor is removed |
| Live-check stop rules narrowed: only a protected-target failure stops work; other live surprises become recorded findings | Three sandbox re-plans in one change ("going in circles") | Superseded 2026-11-12: no sandbox and no live checks left |
| The trusted shell closed with its code review open. CR-01, WR-02, WR-04, WR-05 and WR-06 (plus verifying WR-01) are the first work of `first-unattended-run` | Trust fixes belong before the first overnight run, not after it | Done 2026-11-11 (WR-01 corrected in the record). Live doctor on the owner's machine: boxed in, with the one accepted gh-keychain risk |
| Build in eight vertical slices, each usable on Cena: trusted shell, first unattended run, PR revisions, passkey approvals, morning review, drafts and visual gate, council cards, council meetings | The core value lives in the build lane. The first run's PRs will need revisions straight away. Passkey approvals come before morning review so merge signing is built once. The council carries the most scope-creep risk, so it comes last | Superseded 2026-11-12 by the roadmap under Direction |
| Approvals and merges are signed with a passkey in the console (Touch ID, WebAuthn), never in a terminal (decided 2026-11-11) | The owner controls Counterpoint from the web. A passkey needs a physical touch on every use and never leaves the device, so agents cannot use it and nothing is cached. The challenge is the statement's hash, so the touch signs exactly what the console showed. One touch can approve a batch. Chosen over a security key via SSH, a Touch ID SSH agent (Secretive, 1Password) and a passphrase typed in the console | Superseded 2026-11-12: approving is one click, with no signature |
| SSH approval signing is removed; the current runway is re-approved with the passkey in one batch | Two signing paths would double the trust surface | Superseded 2026-11-12: SSH signing is removed with no replacement; the runway carries over once |
| Passkey registration is confirmed at a terminal, once; pinned credentials change only there | An agent driving a headless browser can create a virtual authenticator, so registration must never be web-only. Daily use needs no terminal | Superseded 2026-11-12: dropped with `passkey-approvals` |
| The console is served at `http://localhost:{port}` (the server still binds only `127.0.0.1`); previews and drafts stay on `127.0.0.1`; the session needs a cookie plus a token held in the console origin's own storage | Passkeys need a domain, not an IP. Cookies ignore ports, so the owner's own dev servers on `localhost` would otherwise receive the console's cookie. Agent-written code on an IP origin cannot ask for the passkey at all | Superseded 2026-11-12: dropped with `passkey-approvals`; the console stays on `127.0.0.1` |
| The owner leads and does not hand-code; builds run during the day as well as overnight (decided 2026-11-11) | The owner's job is to plan, decide and review. Any fix the owner would have to make by hand is a missing feature, not a fallback | Adopted |
| Revision rounds on open PRs are as important as the runway (`pr-revisions`) | A change will rarely be right in one shot. Without a way to send a PR back with notes, the owner would re-plan the change or fix it by hand | Adopted |
| Revision notes are written in Counterpoint only: pinned on the change's preview or as general notes in the console. A round starts only when the owner sends the batch from the console. The pin overlay is built in `pr-revisions` and reused by drafts | The owner stays in one place. The preview runs agent-written code, so its pins are proposals until sent from the console. PR comments never count: agents can reach gh's credential (accepted risk `gh-keychain`). The signed merge stays the final check | Pending. Since 2026-11-12 sessions use the owner's `gh` login on purpose, and the owner's merge is the final check |
| The governor serves work the owner is waiting on first, then builds, then the council's capped share | During the day the scarce thing is the owner's attention, not build time | Pending |
| The variants and "More like B" round model is built once for drafts and reused by council cards | One interaction, one implementation | Pending |
| A single quota governor sits in front of every agent spawn. Usage-limit pauses cover all lanes from the first run; revision rounds jump the build queue from `pr-revisions`; full ordering (owner-waiting work, builds, the council's capped share) arrives with council cards | The council must never starve a build, and the owner must not wait behind the queue | Pending |

## Earlier accepted risks (history)

Until 2026-11-12, doctor recorded two per-machine risks: `gh-keychain` (sandboxed Bash could read gh's Keychain credential) and `sandbox-proxy-login` (the sandbox proxy's own login in the session environment). Both went with the sandbox. The one standing risk is under Direction.

## Superseded guidance

`.claude/CLAUDE.md`'s technology tables predate several of these decisions. Where they conflict, this file wins:
- Spawn `claude -p` with stream-json, not the Agent SDK.
- Astryx, not Tailwind or shadcn.
- Read OpenSpec content natively from git, not through a framework CLI's JSON output.
- The package is `@hkp/counterpoint`.
- Agents run as the owner, with no sandbox, and approving is one click in the console with nothing signed (from `run-as-owner` on). Ignore its sandbox, signature-check and key-caching guidance.

## Out of scope

| Not doing | Why |
|---|---|
| Multi-vendor agent runtimes | Claude Code only, by principle |
| Cloud-hosted execution | Local worktrees are the product. Cloud orchestrators are a shrinking, vendor-dominated market |
| Becoming a second spec system (a kanban board as source of truth) | Counterpoint reads the host's plan and never owns it |
| UI as routes inside the host app | Counterpoint is its own local server, so it works with any stack |
| Auto-merge when gates are green, or without the owner | Only the owner merges |
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
