# Tasks

## 1. Port, ids and status

- [x] 1.1 Replace phase/plan types in `src/core/framework/port.ts` with `ChangeFacts`, `ChangeSnapshot`, `ChangeNotFoundError` and the new `ApprovalInputKind` set (design decisions 3 and 6); delete phase-number helpers; verify `pnpm typecheck` reaches only the expected downstream errors
- [x] 1.2 Replace `PHASE_ID_RE`/`assertPhaseId`/`approvalItemId` in `src/core/ids.ts` with change-id equivalents (decision 1); verify with unit tests for valid, invalid, overlong and `archive` ids
- [x] 1.3 Rewrite `src/core/runway/status.ts` as `deriveChangeStatus` + `ownerSteps` (decisions 3, 5); verify with table tests covering every precedence branch

## 2. OpenSpec adapter

- [x] 2.1 Create `src/adapters/openspec/` (layout, metadata parsing with `yaml` + zod, proposal/tasks parsing, ordering, `detect`, `snapshot`, `approvalInputs`, `cp-openspec-tasks/v1` normalizer); verify with adapter tests against synthetic fixtures (dependency order, cycle fallback, bad YAML isolates one change, archived listing, symlink/oversize refusal, normalizer rules)
- [x] 2.2 Snapshot Cena's committed `openspec/` into `tests/fixtures/openspec/cena/` with `PROVENANCE.md`; verify a parse test asserts Cena's real change list, order and task counts
- [x] 2.3 Point `src/compose.ts` at the new adapter, delete the old adapter directory and its fixtures/tests, update the Biome boundary rule to `adapters/openspec`; verify `tests/boundary` passes and `pnpm lint` fails if core imports the adapter

## 3. Approvals and runway

- [x] 3.1 Move the statement to `counterpoint/approval/v2` (decision 7) across `statement.ts`, `prepare.ts`, `commit.ts`, `verify.ts`, `integrity.ts`; delete v1 and the old normalizer; verify the approval, statement, commit and verify test suites pass with change ids
- [x] 3.2 Rename runway and Needs You logic to changes (`runway.ts`, `needs-you.ts`); verify runway and needs-you tests, including "tick a task box keeps the approval" and "edit proposal drops it"

## 4. Server, CLI and scripts

- [x] 4.1 Rename API routes to `/api/hosts/:hostId/changes[/:changeId]` and payloads to change vocabulary; verify server tests
- [x] 4.2 Update `counterpoint approve <host> <change>`, refusal copy (decision 8), doctor/daemon/main copy; verify CLI tests
- [x] 4.3 Rename `scripts/host-phases.ts` to `scripts/host-changes.ts`, update `scripts/backstop.ts` and `tests/helpers/large-host.ts` to OpenSpec hosts; verify `node scripts/host-changes.ts <Cena-fixture-repo> master` prints the expected lines

## 5. Console

- [x] 5.1 Rename UI pages, routes, API client and copy to changes (Changes, change detail with artifacts, task progress, owner steps, depends on; `ChangeViewPage` → `DriftViewPage`); verify `pnpm build` and the e2e suite

## 6. Integration

- [x] 6.1 Run the full gate set (`pnpm typecheck`, `pnpm lint`, `pnpm test`, e2e, `pnpm build`) and verify all green
- [x] 6.2 Verify that a case-insensitive search of `src`, `tests`, `ui`, `scripts` and `biome.json` finds no name of the previous planning framework, no path into the old planning folder and no `phase` vocabulary (record any intentional survivors)

## Workflow follow-up

- Archive this change after the owner reviews the branch.
