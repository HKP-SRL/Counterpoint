## Context

The framework port (`src/core/framework/port.ts`) is shaped around numbered phases that contain plans. OpenSpec has no phases. Its unit is a change folder with `proposal.md`, optional `design.md`, `tasks.md` and delta specs under `specs/`, plus `.openspec.yaml` metadata. Finished changes move to `openspec/changes/archive/<YYYY-MM-DD>-<name>/`. The adapter still reads only committed content through `GitFileReader` at the base-branch tip, never the working tree, so the `openspec` CLI (which reads the working tree) is not used at runtime.

## Goals / Non-Goals

**Goals:**
- Counterpoint lists, shows and approves Cena's OpenSpec changes, and the runway recomputes from git as before.
- Core stays framework-neutral. Only `src/compose.ts` names the adapter, and Biome enforces that.
- No trace of the old adapter or its vocabulary remains in code, tests, fixtures, scripts or UI copy.

**Non-Goals:**
- Writing back into the host (council decisions into `design.md`). That arrives with the council changes.
- Building or archiving changes. That arrives with `first-unattended-run`.
- Reading v1 approval statements.

## Decisions

1. **Unit and id.** A work item is a change. Its id is the directory name under `openspec/changes/`, which must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` and be at most 64 characters. Anything else is ignored, like the `archive` folder itself. The approval item id is the change id, and the file is `.counterpoint/approvals/<id>.json`. *Alternative:* keep a `change-` prefix for future item kinds. Rejected because the statement's `item.type` already disambiguates, and the converted specs name `<change-name>.json`.
2. **Detection.** A committed blob `openspec/config.yaml` at the base tip. Adapter id: `openspec`.
3. **Facts per change** (replace `PhaseFacts`/`PlanFacts` with `ChangeFacts`):
   - `id`, `dir`, `archived` (boolean) and `archivedOn` (date from the archive prefix, or null).
   - `title`: the first `# ` heading of `proposal.md`, else the id.
   - `why`: the text of the `## Why` section, trimmed and capped.
   - `created`: from `.openspec.yaml`, null if absent or invalid.
   - `dependsOn`: string ids from `x-depends-on`.
   - `artifacts`: `{ proposal, design, tasks }` booleans and `specs`, the capability paths under `specs/`.
   - `tasks`: `{ total, done, ownerSteps: string[] }`, where owner steps are the unchecked tasks whose text starts with `Owner:`.
   - `unreadable`.
   
   YAML is parsed with `yaml` (already a dependency) and validated with zod. A parse failure marks only that change unreadable.
4. **Order.** Active changes come in dependency order (Kahn's algorithm). Ties break on `created` ascending (null last), then on the id. A dependency on an unknown or archived change counts as satisfied for ordering, and the detail view shows it as is. A cycle falls back to `created`, then id, for the changes involved. Archived changes are listed after the active ones, newest first.
5. **Status** (`deriveChangeStatus`), in this precedence:
   1. `unreadable`
   2. `built`: archived, or `tasks.total > 0` and every task done
   3. overlay (`on-runway` or `changed`)
   4. `ready`: proposal present and at least one task
   5. `not-planned`, with reason `no-proposal` or `no-tasks`
   
   A built change is never offered for approval.
6. **Approval inputs.**
   - The inputs are every blob under the change directory, recursively, sorted by path bytes.
   - Kinds: `proposal`, `design`, `tasks`, `spec` (any `specs/**.md`), `metadata` (`.openspec.yaml`) and `other`.
   - `tasks.md` is digested after normalizer `cp-openspec-tasks/v1`:
     - CRLF and lone CR become LF.
     - Trailing whitespace is stripped from every line.
     - A task checkbox `- [x]`, `- [X]` or `- [ x]` (any spacing inside the brackets that OpenSpec counts as done) reads `- [ ]`.
     - Leading and trailing blank lines are trimmed, and the file ends with exactly one LF.
   - Any other edit to `tasks.md` still changes the digest. Unsafe entries (symlinks, oversized blobs) are refused, as today.
   - *Alternative:* raw `tasks.md`. Rejected because the builder ticks boxes as it works, and that would knock every approved change off the runway.
7. **Statement v2.** `schema: counterpoint/approval/v2`, `item: { type: 'change', id }`, and the input kinds from decision 6. Everything else (sorting, combined digest, the gates slot, the draft slot, pretty canonical JSON) is unchanged. The commit message becomes `counterpoint: approve change <id>`. v1 support and the old normalizer are deleted.
8. **Vocabulary everywhere.**
   - Core and the store: phase becomes change, `PhaseStatus` becomes `ChangeStatus`, and so on.
   - API: `/api/hosts/:hostId/changes[/:changeId]`.
   - CLI: `counterpoint approve <host> <change>`.
   - Console: the "Changes" page, the change detail page, and "N changes on the runway".
   - The approval-drift page (`ChangeViewPage`, "approved version changed") is renamed `DriftViewPage`, so "change" means one thing.
   - `scripts/host-phases.ts` becomes `scripts/host-changes.ts`.
   - Refusal copy points at OpenSpec: for example, "Not ready to approve. `<id>` has no tasks.md yet. Run /opsx:propose or add tasks, commit, then come back."
9. **Fixtures.**
   - `tests/fixtures/openspec/cena/` is a byte-exact copy of Cena's committed `openspec/` at migration, with a `PROVENANCE.md`.
   - Synthetic edge cases are built in `tests/helpers/fixture-repo.ts`: dependency chains and cycles, bad YAML, missing proposal, all tasks done, an archived change, a symlink, and an oversized file.
   - `tests/helpers/large-host.ts` generates 50 OpenSpec changes.

## Risks / Trade-offs

- [The owner re-signs Cena's in-flight change] → This is unavoidable. The v1 statement named a phase id that no longer exists. Say so in the migration summary.
- [`x-depends-on` is a Counterpoint convention, not OpenSpec core] → OpenSpec explicitly reserves `x-` keys for tool metadata and ignores them. Document the key in each host's `openspec/config.yaml` rules.
- [The `Owner:` prefix is a convention, too] → Same mitigation: document it under `rules.tasks` in config.yaml.
- [A huge archive slows snapshots] → Archived changes need only a listing and the metadata of their `proposal.md`. Read lazily and cap the console's done list.

## Migration Plan

1. Land this change on the `openspec-migration` branch together with the planning conversion.
2. Commit Cena's conversion. Then run `counterpoint init` in Cena to re-detect the host as `openspec`.
3. The owner signs `owner-ui-on-astryx` again with `counterpoint approve cena owner-ui-on-astryx`.

Rollback: revert the branch. Cena's old planning remains in its git history.
