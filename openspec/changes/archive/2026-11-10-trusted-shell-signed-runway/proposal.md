# Trusted Shell & Signed Runway

## Why

Counterpoint's promise is that the owner can approve work and walk away. That only holds if agents running as the owner's own OS user provably cannot reach the approval key or rewrite what the owner signed. So the trust layer has to come first, before any build or merge path exists: a loopback console, live proof that agents are boxed in, a read-only view of the host's planned changes, and signed approvals that recompute themselves from git.

## What Changes

- A single `counterpoint` command starts one background daemon per machine, registers the current repository as a host and prints a one-time sign-in link; `stop`, `status`, `open` and `init` complete the lifecycle.
- A loopback-only Astryx console (light, dark, system) behind an exact Host allowlist, Origin and content checks on writes, single-use sign-in codes and hashed sessions; live updates over one replayable server-sent event stream.
- One agent launch profile that denies reads of the approval key, `~/.ssh`, gh credentials and Counterpoint's home, denies writes to the host's shared `.git/config`, `hooks` and `info`, confines file edits to the session folder, loads no host-repo settings and passes only an allow-listed environment.
- `counterpoint doctor` with tool and key-hygiene checks, the integrity baseline, the agent's real permission mode, a settings-source isolation check and a nine-row differential live probe that cannot false-pass; an owner-recorded accepted risk for gh's Keychain credential; the read-only Trust page.
- Key and host trust set up only at a terminal: `init-key`, `trust-key`, `trust {host}`.
- Host planning read through a framework adapter behind a lint-enforced port, from committed content at the base-branch tip; Changes list and change detail with status, artifacts and what an approval would cover.
- Signed runway approvals: the console prepares, `counterpoint approve {host} {change}` signs with `ssh-keygen -Y` at a terminal and lands a one-file commit on the base branch by compare-and-swap; verification recomputes everything from git and fails closed.
- The runway as the Mission headline, and a Needs You inbox whose first source is "approved version changed", with a change view that reads like a PR review.

## Capabilities

### New Capabilities
- `daemon-lifecycle`: start/stop/status/init, one daemon per machine, home and port rules, private control channel, crash-only restart.
- `local-console`: loopback bind, Host/Origin guard, one-time sign-in, sessions, CSP, live event stream, themes, host-scoped navigation.
- `agent-sandbox`: the one launch profile every agent session runs under.
- `doctor`: tools, key hygiene, live differential probe, session checks, accepted risks, Trust page.
- `key-trust`: dedicated approval key, pinned trusted signer, host integrity baseline.
- `host-planning`: reading the host's OpenSpec changes from committed git content through the adapter.
- `signed-approvals`: preparing, signing, landing and verifying runway approvals.
- `runway`: the recomputed runway and the Mission headline.
- `needs-you`: the inbox and the approved-version-changed review.

### Modified Capabilities
None (first change).

## Impact

- New package `@hkp/counterpoint` (Node 24+, ESM), installed locally from a packed tarball; the public `npx @hkp/counterpoint` form waits for the public release.
- Writes to the host repository are limited to `.counterpoint/approvals/<change-name>.json` on the base branch, never pushed by Counterpoint.
- State lives in the Counterpoint home (`COUNTERPOINT_HOME`), on the owner's machine under `/Volumes/Dock`.
- Shipped with the code review open; its findings are the first work of `first-unattended-run`.
