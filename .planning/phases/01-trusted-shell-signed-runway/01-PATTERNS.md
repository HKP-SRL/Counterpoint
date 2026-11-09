# Phase 1: Trusted Shell & Signed Runway - Pattern Map

**Mapped:** 2026-11-09
**Files analyzed:** 27 planned files (module paths from RESEARCH.md "Recommended Project Structure")
**Analogs found:** 9 with a real code analog / 27. The remaining 18 have no code analog and are specified by RESEARCH.md recipes instead. Counterpoint has no tracked source yet (greenfield).

**Reconciled with the plans (revision 2026-11-09):** the paths below are the files the plans create; names planned earlier and since superseded are noted as "superseded name".

All analog paths are git-tracked. The Cena ones are read with `git -C /Volumes/Dock/Projects/HKP/Cena show ccr-61ff69b1-hgtpdm:<path>` (read-only). The CV ones were checked with `git ls-files`. In zsh, write `${B}:path` when `B` holds the branch name, because `$B:t` is a history modifier and breaks the lookup.

## File Classification

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/core/security/guard.ts` | middleware | request-response | Cena `lib/factory/guard.ts` | role-match, port with 3 tightenings |
| `tests/server/guard.test.ts` (superseded name: `tests/core/security/guard.test.ts`) | test | request-response | Cena `tests/factory/guard.test.ts` | role-match |
| `src/core/security/sandbox-settings.ts` | config builder | transform | none (RESEARCH Item 1 JSON) | no analog |
| `src/agent/probe.ts` (+ evaluator) | service | event-driven (stream-json) | none | no analog |
| `src/core/security/login.ts` (code, session, token file) | service | request-response | none | no analog |
| `src/core/store/*` (schema, repos) | model | CRUD | CV `test-lock.ts` (only `node:sqlite` usage) | partial |
| `src/server/daemon.ts` single-instance lock (superseded name: `src/server/daemon-lock.ts`) | utility | file-I/O | CV `tools/speckit-auto/test-lock.ts` | exact technique |
| `src/core/approvals/verify.ts` | service | request-response | Cena `lib/factory/signature.ts` | role-match, redesign |
| `src/core/approvals/commit.ts` + `ssh.ts` (sign and land; superseded name: `sign.ts`), `prepare.ts` (re-derives the statement only, 01-12) | service | batch | none (RESEARCH Item 2 recipe) | no analog |
| `src/core/approvals/statement.ts`, `canonical.ts` | model/utility | transform | none (zod schema, RESEARCH Item 4) | no analog |
| `src/core/approvals/integrity.ts` | utility | file-I/O | none | no analog |
| `tests/core/approvals/*.test.ts` | test | integration (scratch git repos) | Cena `tests/factory/signature.test.ts` | role-match |
| `src/core/git/run.ts` (clean-env runner) | utility | request-response | Cena `signature.ts` `git()` helper | partial |
| `src/core/git/reader.ts` (ls-tree, cat-file) | service | file-I/O | Cena `lib/factory/safe-fs.ts` (safe-read idea only) | partial |
| `src/core/host/*` (registry, `COUNTERPOINT_HOME`) | service | CRUD | none | no analog |
| `src/core/runway/*` | service | transform | none | no analog |
| `src/core/framework/port.ts` (superseded name: `src/adapters/api.ts`; core may not import anything under `adapters/`) | interface | n/a | none | no analog |
| `src/adapters/gsd/*` (parser, input rule, roadmap normalizer) | service | transform | none (RESEARCH Item 8 recipe) | no analog |
| `tests/adapters/gsd/*.test.ts` + `tests/fixtures/gsd/` | test | transform | Cena `tests/factory/helpers.ts` + `tests/fixtures/factory/` | role-match |
| `src/compose.ts` | config | n/a | none | no analog |
| `src/server/app.ts` (static serving included; superseded name: `static.ts`), `sse.ts`, `control.ts` | controller | request-response, streaming | none (RESEARCH Item 6 snippets) | no analog |
| `src/cli/*` (commander) | controller | request-response | none | no analog |
| `ui/src/theme.ts` (logic and hook; superseded names: `ui/theme/theme.ts`, `ui/use-theme.ts`) + `ui/public/theme-init.js` | utility/hook | event-driven | Cena `mission-theme.ts` + `use-mission-theme.ts` | exact idea, rewrite for Astryx |
| `ui/*` Astryx pages | component | request-response | Cena `app/%5F%5Fmission/*` (layout idea only; Tailwind/shadcn) | do not copy markup |
| `src/worktree/*` | utility | batch | CV `worktree.sh` | not needed in Phase 1 |
| `biome.json` boundary override | config | n/a | none (RESEARCH Item 8 JSON) | no analog |

## Pattern Assignments

### `src/core/security/guard.ts` (middleware, request-response)

**Analog:** Cena `lib/factory/guard.ts` (78 lines).

**Copy as-is (pure, dependency-free)** from lines 28-56:
```ts
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);   // CHANGE: allow only 127.0.0.1:<port>, per RESEARCH Item 6
function hostnameOf(host: string): string | null {
  try { return new URL(`http://${host}`).hostname.toLowerCase(); } catch { return null; }
}
function sameLoopbackOrigin(origin: string, host: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && isLoopbackHost(url.host) && url.host === host.toLowerCase();
  } catch { return false; }
}
```
The header comment at lines 14-24 (WR-01: the Host check stops browsers, not LAN clients, so only the `127.0.0.1` bind enforces it) should move into the new file verbatim.

**Do NOT copy these (deliberate tightenings, RESEARCH Item 6):**
- Lines 70-71, `if (origin !== null && !sameLoopbackOrigin(...))`, let a missing Origin through on non-GET. Reject a missing Origin: `origin !== \`http://127.0.0.1:${port}\``.
- Line 28 and `missionAccess`: accepting `localhost` and `[::1]`, and the `NODE_ENV` production switch, do not apply. Use an exact Host allowlist, `host === \`127.0.0.1:${port}\``.
- It returns Next-style `Response.json(404)`. In Hono, return `c.json({ error: 'blocked' }, 403)`, plus a 415 for non-JSON content type.
- It has no auth layer. Add session-cookie auth after Origin and content-type, as in RESEARCH Item 6.

**Hono shape to write instead** (RESEARCH lines 448-466): `serve({ hostname: '127.0.0.1' })`, then a Host middleware, then an `/api/*` Origin + `sec-fetch-site` + content-type middleware, then cookie auth. Do not rely on `hono/csrf` (it does not cover JSON).

---

### `tests/server/guard.test.ts` (test; superseded name: `tests/core/security/guard.test.ts`)

**Analog:** Cena `tests/factory/guard.test.ts` lines 32-45. Reuse the table-driven `it.each([[env, host, expected]])` style. Extend the rows to cover `localhost:PORT` blocked, `evil.example`, `localhost.evil.example`, `localhost@evil.example`, and a null host. Do not copy the `walk(MISSION_DIR)` "every route calls the guard" idea literally. Port it as a test that every `/api/*` route is mounted under the guard. The guard test must run over a real socket on port 0 (RESEARCH Item 9).

---

### `src/server/daemon.ts` single-instance lock (utility, file-I/O; superseded name: `daemon-lock.ts`) and `src/core/store/*`

**Analog:** `/Volumes/Dock/Projects/HKP/CV/tools/speckit-auto/test-lock.ts` (85 lines).

**Core technique to copy** (lines 9-31, 53, 69):
```ts
import { DatabaseSync } from 'node:sqlite';
const SQLITE_BUSY = 5;
let connection: DatabaseSync | undefined;   // keep a reference: the lock ends if the connection is garbage collected
function tryLock(db: DatabaseSync): boolean {
  try { db.exec('BEGIN EXCLUSIVE'); return true; }
  catch (error) {
    if ((error as { errcode?: number }).errcode === SQLITE_BUSY) return false;
    throw error;
  }
}
const db = new DatabaseSync(file, { timeout: 0 });
connection = db;
```
**Adapt:** the daemon uses `run/daemon.lock.db` under `COUNTERPOINT_HOME`. On `SQLITE_BUSY` it exits "already running" instead of polling every 1000 ms (lines 58-66, wait-and-poll, are the opposite of single-instance). Do not copy the `HELD` env marker, the holder file or the 180-minute wait, which are test-lock specifics. Liveness comes from the control socket answering, not a pid file. Store schema (WAL, STRICT) has no analog; follow STACK/RESEARCH.

---

### `src/core/approvals/verify.ts` (service, request-response)

**Analog:** Cena `lib/factory/signature.ts` (83 lines). This is a partial reuse: keep the hygiene, replace the trust model.

**Copy:**
- `execFile` with an argument array and a timeout, no shell (lines 24-28):
```ts
function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: root, timeout: 5000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}
```
  In Counterpoint use `execa` with an absolute git path, a clean env and `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, plus `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null` (RESEARCH Pitfall 2).
- `-c log.showSignature=false` and `--no-show-signature` (line 36), and the "parse only the last line" rule (lines 46-47).
- The status union and plain-words describer (lines 20, 67-82) as the model for the `ApprovalState` type and its UI copy.
- The slug guard before any path use (`SLUG.test(screenId)`, line 57). New regexes are `^[a-z0-9][a-z0-9-]{0,31}$` for hosts and `^\d{2}(\.\d+)?$` for phases.
- Fail closed: every catch returns `"unknown"` (line 63).

**Do NOT copy:**
- Authorizing on `%G? %GF` (lines 49-53, `code === "G" && fingerprint === ownerKey`). Counterpoint verifies with `ssh-keygen -Y verify -f <allowed_signers outside repo> -I owner@counterpoint -n git`, requiring exit 0 and a pinned fingerprint, on a payload reconstructed from the `gpgsig` header (RESEARCH "Verification algorithm" and `verifyApproval` skeleton, lines 576-592). Never use `check-novalidate`.
- Relying on git's own signature config (`gpg.format`, `user.signingkey` in repo config). This is the config-driven signing that CONTEXT forbids.
- The working-tree `git status --porcelain` "uncommitted" check as the approval verdict (lines 40-42, 60). Per D-03 the verdict is the content at the base tip. Use `git status` only for the soft hint, with `GIT_OPTIONAL_LOCKS=0`.
- The `git log -1 -- file` last-toucher idea is kept, but add `--first-parent`, a single-parent check and a `diff-tree` "only this file" check (steps 1-2 of the algorithm).

---

### `tests/core/approvals/*.test.ts` (test, integration)

**Analog:** Cena `tests/factory/signature.test.ts` (lines 1-35) and its `helpers.ts` (`tempRoot`, `removeTempRoots`, `writeFileIn`).

**Copy the harness shape:**
```ts
afterAll(removeTempRoots);
function git(root: string, ...args: string[]) {
  return execFileSync("git",
    ["-c","user.name=Test","-c","user.email=test@example.invalid","-c","commit.gpgsign=false","-c","core.hooksPath=/dev/null", ...args],
    { cwd: root, encoding: "utf8" });
}
```
Real scratch git repos in a temp dir, `commit.gpgsign=false` pinned so the machine's signing setup cannot change results, then the repo is built per case. **Adapt:** use throwaway ed25519 keys through `ssh-keygen`, not gpg (the prototype skips its signed case where gpg is absent). Add the adversarial matrix from RESEARCH Item 9 (wrong key, namespace, tamper, unsigned later edit or delete, extra file, merge or two parents, garbled `gpgsig`, hook or fsmonitor in repo config not executed, CAS race).

---

### `src/core/git/reader.ts` (service, file-I/O)

**Analog (idea only):** Cena `lib/factory/safe-fs.ts` lines 5-29. Never follow symlinks, require a regular file, keep the resolved directory under the root, and make errors carry no absolute path or content (`UnsafeFileError`, lines 31-36). In Counterpoint most reads are `git cat-file blob <tip>:<path>` and `ls-tree`, which cannot follow a working-tree symlink. Apply the same discipline to mode `120000` entries: refuse symlink tree entries as inputs. Any real filesystem read (the trust files in `COUNTERPOINT_HOME`, key header parse for doctor) should use `O_NOFOLLOW` plus a regular-file check as in safe-fs. I read only the first 45 lines of this file, so pull the `open(..., O_NOFOLLOW|O_NONBLOCK)` body from the file before copying.

---

### `src/core/approvals/commit.ts` and `ssh.ts` (approval commit recipe; superseded names: `prepare.ts` and `sign.ts`)

No code analog. Implement the verified plumbing recipe in RESEARCH Item 2 (lines 352-366): `hash-object -w`, `mktree` chain, `commit-tree`, `ssh-keygen -Y sign -n git` over the commit payload on stdin, embed as `gpgsig`, `hash-object -t commit -w`, then `update-ref <ref> <new> <old>` (CAS). Also apply the index fix only when `git worktree list --porcelain` shows the base branch checked out (`update-index --add --cacheinfo`, then `checkout-index -f`). Scrub `SSH_ASKPASS` and `SSH_AUTH_SOCK`, and require a TTY.

---

### `ui/` theme: `ui/src/theme.ts` and `ui/public/theme-init.js` (superseded names: `ui/theme/theme.ts`, `ui/use-theme.ts`)

**Analog:** Cena `lib/factory/mission-theme.ts` (132 lines) and `use-mission-theme.ts` (88 lines).

**Copy the pure logic** (mission-theme.ts lines 34-47, 72-93): `["light","dark","system"]` preferences, the allowlist parser with the light default, `isMissionDark(preference, systemDark)`, and the radio-group keyboard function `missionThemeOptionAfter` (arrows wrap, Home and End jump). Rename `Mission*` to `Console*` or `Theme*`.

**Copy the hook structure** (use-mission-theme.ts lines 48-78): `useLayoutEffect` that reconciles from storage on mount and on `pageshow`, then a second effect that applies the class from live `matchMedia`, with a `change` listener only in system mode, and `choose()` persisting.

**Do NOT copy as-is:**
- The `mission` / `mission-dark` class application (`applyMissionTheme`, lines 108-115). Astryx drives the theme through `<Theme theme={neutralTheme} mode={'system'|'light'|'dark'}>`, so the hook should return the `mode` prop instead of toggling classes.
- Cookie persistence (`Path=/__mission; SameSite=Lax`, lines 102-104). The UI-SPEC and RESEARCH use `localStorage` with an external `/theme-init.js`.
- The inline boot script `MISSION_THEME_SCRIPT` (lines 125-132). The CSP forbids inline script (`script-src 'self'`), so ship the same ES2017 string as the static file `/theme-init.js`. Keep its safe properties: it reads storage itself, interpolates no server data, and swallows throws.
- Mission's `"use client"` Next directive and the Next layout assumptions.

---

### `ui/*` pages and components

**Analog:** Cena `app/%5F%5Fmission/*` is not listed by `ls-tree` under that path (the directory is URL-encoded as `app/%5F%5Fmission`; I did not read it). Use only for information architecture (phases list, inbox). Do NOT copy markup or classes: it uses Tailwind and shadcn, which Counterpoint forbids. Use Astryx components, with the prop spellings from RESEARCH Item 7 (`Banner status`, `Button label`/`onClick`, `CodeBlock code`/`isDiff`, `Dialog isOpen`/`onOpenChange`, `AppShell topNav`/`sideNav`). Gate on `tsc --noEmit`.

---

### `src/adapters/gsd/*`, `src/core/framework/port.ts` (superseded name: `src/adapters/api.ts`), `src/compose.ts`, `biome.json`

No analog. Follow RESEARCH Item 8 (remark/yaml/zod parsing recipe; tuple phase numbers, never `parseFloat`) and Pattern 2 (adapter receives a git file-reader port from core, returns labelled input byte-ranges, core owns hashing). Boundary: copy the verified `noRestrictedImports` override JSON at RESEARCH lines 515-517, and add the meta-test that lints a violating fixture.

Fixture/test harness analog: Cena `tests/fixtures/factory/*` plus `tests/factory/helpers.ts` for the "materialize fixtures into scratch git repos" helper. Freeze `.planning` from Cena `master` with `git archive` (RESEARCH line 511; the plans use `tests/fixtures/gsd/cena-master`, not `test/fixtures/...`) and add a synthetic planned-phase fixture.

## Shared Patterns

### Subprocess hygiene (all git, ssh-keygen, claude calls)
**Source:** Cena `lib/factory/signature.ts` lines 16-28. Argument arrays only, a timeout on every call, IDs validated against a regex before any path interpolation, and fail closed on error. **Strengthen:** absolute binaries (`/usr/bin/ssh-keygen`), env allow-list (`PATH`, `HOME`, `LANG`, `TMPDIR`), no `SSH_AUTH_SOCK`, `GH_TOKEN` or `COUNTERPOINT_*`, and `-c core.hooksPath=/dev/null -c core.fsmonitor=false` on every host-repo git call. `claude -p` runs with `stdin: 'ignore'`.

### Loopback guard order
**Source:** Cena `guard.ts` lines 62-77, tightened per RESEARCH Item 6. Order is bind, Host, Origin/Fetch-Metadata, content type, session cookie, route. The bind to `127.0.0.1` is the real boundary (WR-01).

### Test harness
**Source:** Cena `tests/factory/signature.test.ts` lines 19-35. Scratch repos, pinned `commit.gpgsign=false`, `afterAll(removeTempRoots)`. Table-driven cases from `guard.test.ts`.

### Single-instance and store locking
**Source:** CV `test-lock.ts` lines 9-31. `node:sqlite` `BEGIN EXCLUSIVE` with `timeout: 0`. Keep the connection referenced.

### Do-not-copy list (summary)
- Tailwind or shadcn classes from `app/%5F%5Fmission/*`.
- `%G?`/`%GF`-based authorization and git config-driven signing.
- Missing-Origin passthrough, `localhost` and `[::1]` acceptance, `NODE_ENV` gating in `guard.ts`.
- Cookie-based theme preference and the inline boot script (CSP).
- Working-tree-based approval verdicts.
- The test-lock wait loop, `HELD` env marker and holder file.
- The `.claude/CLAUDE.md` stack tables (Agent SDK, Tailwind, `gsd-tools` first, `@alex-profir`) are stale; PROJECT.md wins.

## No Analog Found

Use the RESEARCH.md recipe named in the right column.

| File | Role | Data flow | Recipe |
|---|---|---|---|
| `core/security/sandbox-settings.ts`, `agent/probe.ts` | config/service | transform, event-driven | RESEARCH Item 1 (settings JSON, differential probe, evidence rules) |
| `core/security/login.ts` | service | request-response | Item 5 (one-time code, hashed storage, 5 min, cookie attributes) |
| `server/control.ts` + CLI daemon spawn | controller | request-response | Item 5 and the control-socket example (lines 595-602) |
| `server/sse.ts` | controller | streaming | `streamSSE`, a 25 s heartbeat, `Last-Event-ID` replay against `events.seq` |
| `core/approvals/statement.ts`, `canonical.ts` | model | transform | Item 4 (sorted-key canonical JSON, test vectors, `sha256:` digests) |
| `core/approvals/integrity.ts` | utility | file-I/O | Item 2 "Integrity snapshot" |
| `core/host/*`, `core/runway/*`, `cli/*`, `compose.ts`, `core/framework/port.ts` (was `adapters/api.ts`) | various | various | Architecture section of RESEARCH |

## Metadata

**Analog search scope:** Cena branch `ccr-61ff69b1-hgtpdm` (`lib/factory`, `tests/factory`, `tests/fixtures/factory`), CV `tools/speckit-auto`.
**Files read:** `guard.ts`, `signature.ts`, `mission-theme.ts`, `use-mission-theme.ts`, `guard.test.ts` (top), `signature.test.ts` (top), `safe-fs.ts` (top 45 lines), `test-lock.ts`, `worktree.sh` (top). Not read: `app/%5F%5Fmission/*`, `helpers.ts`, `derive.ts`, `api.ts`, `runner.ts`.
**Pattern extraction date:** 2026-11-09
