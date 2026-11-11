# Read OpenSpec hosts

## Why

Counterpoint and its first host, Cena, now plan their work with OpenSpec. The main specs already describe Counterpoint reading a host's `openspec/` folder: the converted `host-planning`, `signed-approvals`, `runway` and `needs-you` specs. The code still reads the old phase-based layout, so the console shows nothing for Cena, and nothing can be approved, until the code matches the specs.

## What Changes

- **BREAKING** A new framework adapter, `openspec`, replaces the old one. It recognises a host by a committed `openspec/config.yaml` and reports the host's changes: active and archived.
- **BREAKING** The unit of work everywhere (core, store, API, CLI, console) is a **change**, identified by its kebab-case name. Phase numbers, plans, waves and inserted phases are gone.
- **BREAKING** The approval statement moves to `counterpoint/approval/v2`: `item: { type: change, id: <name> }`, stored at `.counterpoint/approvals/<name>.json`. v1 statements are not read any more. The only real one (Cena's Phase 2) is removed when Cena migrates, and the owner signs the change again.
- An approval covers every file in the change's directory. `tasks.md` is normalized, so ticking boxes is not a content change.
- Owner steps (tasks whose text starts with `Owner:`) take the place of the old setup prerequisites on the change detail screen and in `approve`.
- Ordering comes from `x-depends-on` in `.openspec.yaml`, then `created`, then the name.
- Test fixtures move to a snapshot of Cena's `openspec/` plus small synthetic hosts.

## Capabilities

### New Capabilities

None. The converted main specs already describe the target behaviour.

### Modified Capabilities

None. The code catches up to `host-planning`, `signed-approvals`, `runway` and `needs-you` as they stand, so this change carries no spec deltas (`skip_specs: true`).

## Impact

- `src/adapters/` (new adapter, old one deleted), `src/compose.ts`, `biome.json` boundary rule.
- `src/core/framework/port.ts`, `src/core/ids.ts`, `src/core/runway/*`, `src/core/approvals/*`.
- `src/server/routes/*`, `src/cli/*`, `scripts/*`, `ui/src/**`.
- `tests/**` and `tests/fixtures/`.
- Hosts registered under the old adapter id pick up `openspec` the next time they register (`counterpoint init` in the host).
