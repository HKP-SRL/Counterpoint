# Phase 1: Trusted Shell & Signed Runway - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-09
**Phase:** 1-Trusted Shell & Signed Runway
**Areas discussed:** What an approval locks, Starting & logging in
**Areas offered but not selected:** Approval command & commit, If the sandbox probe fails (left to Claude's discretion with stated defaults)

---

## What an approval locks

**At what point can you sign a phase into the runway?**

| Option | Description | Selected |
|--------|-------------|----------|
| After plan-phase | Only phases with CONTEXT + PLANs; you sign the exact plans; builder never plans itself | ✓ |
| After discuss-phase | CONTEXT is enough; builder runs plan-phase first | |
| Either, marked | Both allowed; approval records which | |

**Which content does the approval's spec hash cover?**

| Option | Description | Selected |
|--------|-------------|----------|
| Phase inputs only | CONTEXT, PLANs, RESEARCH/UI-SPEC/SPEC, this phase's ROADMAP section; not STATE or other phases | ✓ |
| Whole phase dir + ROADMAP | Stricter; any roadmap edit invalidates every approval | |
| PLANs only | Loosest; CONTEXT edits wouldn't invalidate | |

**Which copy of the phase files is hashed on recompute?**

| Option | Description | Selected |
|--------|-------------|----------|
| Base branch tip | Committed master content (what the builder checks out); soft hint for uncommitted edits | ✓ |
| Your working tree | Drops off on save; may differ from what's built | |

**What does the 'approved version changed' item give you?**

| Option | Description | Selected |
|--------|-------------|----------|
| Diff + re-approve | Changed inputs, diff since signing, one-line re-sign command | ✓ |
| File list + re-approve | Changed files and re-sign command | |
| Just flag it | Marked changed; re-approve via normal flow | |

---

## Starting & logging in

**What happens when you run `npx @hkp/counterpoint`?**

| Option | Description | Selected |
|--------|-------------|----------|
| Background daemon | Starts/attaches, prints URL, returns terminal; stop/status commands | ✓ |
| Foreground server | Ctrl-C stops; closing terminal kills runs | |
| Foreground now, daemon later | Daemon added in Phase 2 | |

**One Counterpoint for all host repos, or one per repo?**

| Option | Description | Selected |
|--------|-------------|----------|
| One per machine | Single daemon/console, hosts registered; one quota governor | ✓ |
| One per repo | Separate daemons; can't coordinate usage limits | |

**How does the console get the owner credential?**

| Option | Description | Selected |
|--------|-------------|----------|
| One-time URL | Single-use code → HttpOnly SameSite=Strict cookie; token in 0600 file | ✓ |
| One-time URL, long session | Same, weeks-long cookie | |
| Paste a token | Copy token from terminal | |

**Where does Counterpoint keep its home?**

| Option | Description | Selected |
|--------|-------------|----------|
| Platform default + env | `~/Library/Application Support/Counterpoint` / XDG, `COUNTERPOINT_HOME` override, refuse to start if missing | ✓ |
| Always ~/.counterpoint | Dotfolder plus symlink to Dock | |

---

## Claude's Discretion

- Signing key: new dedicated passphrase-only ed25519 key
- Approval command shape and commit landing (no checkout, not auto-pushed)
- Gate-config digest slot before gates exist
- Sandbox probe failure: blocks agent spawns, not the console; fallback chosen with the owner before Phase 2
- Fixed default port; prerequisite display; listing all phases

## Deferred Ideas

None.
