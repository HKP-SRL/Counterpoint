// The OpenSpec adapter against a byte-exact snapshot of Cena's `openspec/` (see
// tests/fixtures/openspec/cena/PROVENANCE.md): the real change list, its order, task counts,
// owner steps, archived changes and what approving Cena's ready change covers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../../src/adapters/openspec/index.ts';
import { createGitFileReader } from '../../../src/core/git/reader.ts';
import { deriveChangeStatus } from '../../../src/core/runway/status.ts';
import { type FixtureRepo, materializeFixtureRepo } from '../../helpers/fixture-repo.ts';
import { removeScratchDirs } from '../../helpers/scratch.ts';

const adapter = createOpenSpecAdapter();
let cena: FixtureRepo;

beforeAll(async () => {
  cena = await materializeFixtureRepo('cena');
});

afterAll(() => removeScratchDirs());

const snapshot = () => adapter.snapshot(createGitFileReader(cena.root), cena.commit);

describe("Cena's OpenSpec planning", () => {
  it('is detected as an OpenSpec host', async () => {
    expect(await adapter.detect(createGitFileReader(cena.root), cena.commit)).toBe(true);
  });

  it('lists every change in dependency order, then the archive newest first', async () => {
    const { changes, unreadable } = await snapshot();
    expect(unreadable).toBeNull();
    expect(changes.map((c) => [c.id, c.archivedOn])).toEqual([
      ['owner-ui-on-astryx', null],
      ['live-menu-for-diners', null],
      ['cookieless-analytics', null],
      ['menu-theming-and-templates', null],
      ['multilingual-menu', null],
      ['rich-menu-content', null],
      ['ai-menu-ingestion', null],
      ['design-system-migration', '2026-08-05'],
      ['multi-tenant-foundation', '2026-08-04'],
    ]);
  });

  it('reads every change without errors, with its status, tasks and dependencies', async () => {
    const { changes } = await snapshot();
    expect(changes.filter((c) => c.unreadable !== null)).toEqual([]);
    expect(
      changes.map((c) => ({
        id: c.id,
        status: deriveChangeStatus(c).status,
        reason: deriveChangeStatus(c).notReadyReason,
        tasks: [c.tasks.done, c.tasks.total],
        dependsOn: c.dependsOn,
      })),
    ).toEqual([
      { id: 'owner-ui-on-astryx', status: 'ready', reason: null, tasks: [1, 32], dependsOn: [] },
      {
        id: 'live-menu-for-diners',
        status: 'not-planned',
        reason: 'no-tasks',
        tasks: [0, 0],
        dependsOn: ['owner-ui-on-astryx'],
      },
      ...[
        'cookieless-analytics',
        'menu-theming-and-templates',
        'multilingual-menu',
        'rich-menu-content',
      ].map((id) => ({
        id,
        status: 'not-planned',
        reason: 'no-tasks',
        tasks: [0, 0],
        dependsOn: ['live-menu-for-diners'],
      })),
      {
        id: 'ai-menu-ingestion',
        status: 'not-planned',
        reason: 'no-tasks',
        tasks: [0, 0],
        dependsOn: ['live-menu-for-diners', 'rich-menu-content', 'multilingual-menu'],
      },
      {
        id: 'design-system-migration',
        status: 'built',
        reason: null,
        tasks: [0, 0],
        dependsOn: [],
      },
      {
        id: 'multi-tenant-foundation',
        status: 'built',
        reason: null,
        tasks: [0, 0],
        dependsOn: [],
      },
    ]);
  });

  it("reports the ready change's artifacts, why and owner steps", async () => {
    const ready = (await snapshot()).changes.find((c) => c.id === 'owner-ui-on-astryx');
    expect(ready).toMatchObject({
      title: 'owner-ui-on-astryx',
      created: '2026-11-10',
      artifacts: {
        proposal: true,
        design: true,
        tasks: true,
        specs: ['design-system', 'owner-ui', 'shared-tablet', 'venues'],
      },
    });
    expect(ready?.why).toMatch(/^Cena "looks like every AI-generated app"/);
    expect(ready?.tasks.ownerSteps).toHaveLength(3);
    for (const step of ready?.tasks.ownerSteps ?? []) expect(step).toMatch(/^Owner: /);
    expect(ready?.tasks.ownerSteps[0]).toMatch(/^Owner: approve the Astryx supply chain/);
  });

  it('covers every file of the ready change when it is approved', async () => {
    const inputs = await adapter.approvalInputs(
      createGitFileReader(cena.root),
      cena.commit,
      'owner-ui-on-astryx',
    );
    expect(inputs.map((i) => [i.label, i.kind, i.normalization])).toEqual([
      ['.openspec.yaml', 'metadata', null],
      ['design.md', 'design', null],
      ['proposal.md', 'proposal', null],
      ['specs/design-system/spec.md', 'spec', null],
      ['specs/owner-ui/spec.md', 'spec', null],
      ['specs/shared-tablet/spec.md', 'spec', null],
      ['specs/venues/spec.md', 'spec', null],
      ['tasks.md', 'tasks', 'cp-openspec-tasks/v1'],
    ]);
  });
});
