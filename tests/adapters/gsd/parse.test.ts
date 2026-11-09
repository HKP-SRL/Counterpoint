import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGsdAdapter } from '../../../src/adapters/gsd/index.ts';
import { parseRoadmap } from '../../../src/adapters/gsd/roadmap.ts';
import type { PhaseFacts, PlanSnapshot } from '../../../src/core/framework/port.ts';
import { PhaseNotFoundError } from '../../../src/core/framework/port.ts';
import { createGitFileReader } from '../../../src/core/git/reader.ts';
import {
  commitChange,
  commitSymlink,
  type FixtureRepo,
  materializeFixtureRepo,
} from '../../helpers/fixture-repo.ts';
import {
  commitAll,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../../helpers/scratch.ts';

const adapter = createGsdAdapter();

let cena: FixtureRepo;
let synthetic: FixtureRepo;
let cenaSnapshot: PlanSnapshot;
let syntheticSnapshot: PlanSnapshot;

function phase(snapshot: PlanSnapshot, id: string): PhaseFacts {
  const found = snapshot.phases.find((p) => p.id === id);
  if (!found) throw new Error(`phase ${id} missing from snapshot`);
  return found;
}

beforeAll(async () => {
  cena = await materializeFixtureRepo('cena-master');
  synthetic = await materializeFixtureRepo('synthetic');
  cenaSnapshot = await adapter.snapshot(createGitFileReader(cena.root), cena.commit);
  syntheticSnapshot = await adapter.snapshot(createGitFileReader(synthetic.root), synthetic.commit);
});

afterAll(() => {
  removeScratchDirs();
});

describe('Cena master fixture', () => {
  it('lists every roadmap phase in order: 1, 1.1, 2, 3, 4, 5, 6, 7', () => {
    expect(cenaSnapshot.framework).toBe('gsd');
    expect(cenaSnapshot.commit).toBe(cena.commit);
    expect(cenaSnapshot.unreadable).toBeNull();
    expect(cenaSnapshot.phases.map((p) => p.id)).toEqual([
      '01',
      '01.1',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
    ]);
  });

  it('reads Phase 1 with 17 plans, every one built', () => {
    const p1 = phase(cenaSnapshot, '01');
    expect(p1.name).toBe('Multi-Tenant Foundation');
    expect(p1.number).toEqual([1]);
    expect(p1.inserted).toBe(false);
    expect(p1.dir).toBe('.planning/phases/01-multi-tenant-foundation');
    expect(p1.hasContext).toBe(true);
    expect(p1.unreadable).toBeNull();
    expect(p1.plans).toHaveLength(17);
    expect(p1.plans.every((plan) => plan.hasSummary)).toBe(true);
    expect(p1.goal).toMatch(/^As a restaurant owner, I want to create my account/);
    expect(p1.dependsOn).toBe('Nothing (first phase)');
    expect(p1.requirements).toBe(
      'ACCT-01, ACCT-02, ACCT-03, ACCT-04, ACCT-05, ACCT-06, ACCT-07, ACCT-08',
    );
  });

  it('reads Phase 1.1 (heading `Phase 01.1`, directory `01.1-…`) with 14 built plans', () => {
    const p11 = phase(cenaSnapshot, '01.1');
    expect(p11.number).toEqual([1, 1]);
    expect(p11.name).toBe('Design System Migration');
    expect(p11.inserted).toBe(true);
    expect(p11.dir).toBe('.planning/phases/01.1-design-system-migration');
    expect(p11.hasContext).toBe(true);
    expect(p11.plans).toHaveLength(14);
    expect(p11.plans.every((plan) => plan.hasSummary)).toBe(true);
    expect(p11.plans.map((plan) => plan.id).slice(0, 3)).toEqual(['01.1-01', '01.1-02', '01.1-03']);
  });

  it('reads plan 01-01: not autonomous, user_setup docker + supabase-cli, its objective', () => {
    const plan = phase(cenaSnapshot, '01').plans.find((p) => p.id === '01-01');
    expect(plan).toBeDefined();
    expect(plan?.file).toBe('.planning/phases/01-multi-tenant-foundation/01-01-PLAN.md');
    expect(plan?.wave).toBe(1);
    expect(plan?.autonomous).toBe(false);
    expect(plan?.dependsOn).toEqual([]);
    expect(plan?.filesModified).toHaveLength(21);
    expect(plan?.userSetup).toEqual([
      {
        service: 'docker + supabase-cli',
        why: 'Local Supabase stack (Postgres + GoTrue + Inbucket/Mailpit) is where migrations apply and the RLS suite runs',
        envVars: [
          'NEXT_PUBLIC_SUPABASE_URL',
          'NEXT_PUBLIC_SUPABASE_ANON_KEY',
          'SUPABASE_SECRET_KEY',
        ],
      },
    ]);
    expect(plan?.objective).toMatch(/^Stand up the Walking Skeleton: the thinnest/);
    expect(plan?.objective?.length).toBeLessThanOrEqual(300);
  });

  it('reads the other non-autonomous plan (01-09) and an empty user_setup (01-03)', () => {
    const plans = phase(cenaSnapshot, '01').plans;
    expect(plans.filter((p) => !p.autonomous).map((p) => p.id)).toEqual(['01-01', '01-09']);
    expect(plans.find((p) => p.id === '01-03')?.userSetup).toEqual([]);
  });

  it('gives Phases 2-7 no directory and no context', () => {
    for (const id of ['02', '03', '04', '05', '06', '07']) {
      const p = phase(cenaSnapshot, id);
      expect(p.dir).toBeNull();
      expect(p.hasContext).toBe(false);
      expect(p.plans).toEqual([]);
      expect(p.unreadable).toBeNull();
    }
    expect(phase(cenaSnapshot, '02').name).toBe('A Live Menu Diners Can Read');
    expect(phase(cenaSnapshot, '07').name).toBe('AI Menu Ingestion (Photo + PDF)');
  });
});

describe('synthetic fixture', () => {
  it('sorts phases as integer tuples (1.9 before 1.10) and skips the fenced heading', () => {
    expect(syntheticSnapshot.phases.map((p) => p.id)).toEqual([
      '01',
      '01.9',
      '01.10',
      '02',
      '02.1',
      '03',
      '04',
    ]);
    expect(syntheticSnapshot.phases.some((p) => p.name === 'In A Fence')).toBe(false);
  });

  it('reads the zero-padded `Phase 02` heading as Phase 2 with context and two plans', () => {
    const p2 = phase(syntheticSnapshot, '02');
    expect(p2.number).toEqual([2]);
    expect(p2.name).toBe('Ready Thing');
    expect(p2.dir).toBe('.planning/phases/02-ready-thing');
    expect(p2.hasContext).toBe(true);
    expect(p2.goal).toBe('A phase that has its context and two plans, ready to approve.');
    expect(p2.plans.map((p) => p.id)).toEqual(['02-01', '02-02']);
    expect(p2.plans.every((p) => !p.hasSummary)).toBe(true);
    expect(p2.unreadable).toBeNull();
  });

  it('reads plan 02-01: not autonomous, two user_setup items, objective outside fences', () => {
    const plan = phase(syntheticSnapshot, '02').plans[0];
    expect(plan?.autonomous).toBe(false);
    expect(plan?.wave).toBe(1);
    expect(plan?.userSetup).toEqual([
      {
        service: 'docker + supabase-cli',
        why: 'Local stack where the migrations apply',
        envVars: ['SYN_DATABASE_URL', 'SYN_SECRET_KEY'],
      },
      {
        service: 'google-oauth',
        why: 'Sign-in needs an OAuth client',
        envVars: ['SYN_GOOGLE_CLIENT_ID'],
      },
    ]);
    expect(plan?.objective).toBe('Set up the ready thing end to end, including its local stack.');
  });

  it('reads plan 02-02 with defaults: autonomous, no user_setup, roadmap row as objective', () => {
    const plan = phase(syntheticSnapshot, '02').plans[1];
    expect(plan?.autonomous).toBe(true);
    expect(plan?.userSetup).toEqual([]);
    expect(plan?.dependsOn).toEqual(['02-01']);
    expect(plan?.wave).toBe(2);
    expect(plan?.objective).toBe('Finish the ready thing without objective block');
  });

  it('marks Phase 2.1 inserted with context and no plans', () => {
    const p = phase(syntheticSnapshot, '02.1');
    expect(p.inserted).toBe(true);
    expect(p.name).toBe('Inserted Thing');
    expect(p.hasContext).toBe(true);
    expect(p.plans).toEqual([]);
    expect(p.goal).toBe('An inserted phase that has been discussed but not planned.');
  });

  it('gives Phase 3 no directory', () => {
    const p = phase(syntheticSnapshot, '03');
    expect(p.dir).toBeNull();
    expect(p.hasContext).toBe(false);
  });

  it('marks only Phase 4 unreadable for malformed YAML; Phase 02 still parses', () => {
    const p4 = phase(syntheticSnapshot, '04');
    expect(p4.unreadable).toEqual({
      file: '.planning/phases/04-broken-yaml/04-01-PLAN.md',
      reason: expect.any(String),
    });
    expect(p4.unreadable?.reason.length).toBeGreaterThan(0);
    expect(p4.unreadable?.reason.length).toBeLessThanOrEqual(200);
    expect(p4.unreadable?.reason).not.toMatch(/\n/);
    expect(p4.unreadable?.reason).not.toContain(synthetic.root);
    for (const id of ['01', '02', '02.1']) {
      expect(phase(syntheticSnapshot, id).unreadable).toBeNull();
    }
  });

  it('reads the built phase: its plan has a summary', () => {
    const p1 = phase(syntheticSnapshot, '01');
    expect(p1.plans).toHaveLength(1);
    expect(p1.plans[0]?.hasSummary).toBe(true);
  });

  it('does not count non-plan documents (PERMISSION-MATRIX, PATTERNS) as plans', () => {
    const files = phase(syntheticSnapshot, '02').plans.map((p) => p.file);
    expect(files.some((file) => file.includes('PERMISSION-MATRIX'))).toBe(false);
  });
});

describe('robustness', () => {
  it('yields phases [] when the roadmap is missing (no throw)', async () => {
    const commit = await commitChange(synthetic.root, '.planning/ROADMAP.md', null);
    const snapshot = await adapter.snapshot(createGitFileReader(synthetic.root), commit);
    expect(snapshot.phases).toEqual([]);
    expect(snapshot.unreadable).toBeNull();
    // restore for later tests
    await commitChange(
      synthetic.root,
      '.planning/ROADMAP.md',
      new TextDecoder().decode(
        (await createGitFileReader(synthetic.root).read(
          synthetic.commit,
          '.planning/ROADMAP.md',
        )) as Uint8Array,
      ),
    );
  });

  it('marks the phase unreadable when a plan file is a symlink', async () => {
    const commit = await commitSymlink(
      synthetic.root,
      '.planning/phases/02-ready-thing/02-03-PLAN.md',
      '02-01-PLAN.md',
    );
    const snapshot = await adapter.snapshot(createGitFileReader(synthetic.root), commit);
    expect(phase(snapshot, '02').unreadable?.file).toBe(
      '.planning/phases/02-ready-thing/02-03-PLAN.md',
    );
    expect(phase(snapshot, '02.1').unreadable).toBeNull();
    await commitChange(synthetic.root, '.planning/phases/02-ready-thing/02-03-PLAN.md', null);
  });

  it('marks the phase unreadable when frontmatter fails validation (wave is text)', async () => {
    const commit = await commitChange(
      synthetic.root,
      '.planning/phases/02.1-inserted-thing/02.1-01-PLAN.md',
      '---\nwave: soon\n---\n\n<objective>\nx\n</objective>\n',
    );
    const snapshot = await adapter.snapshot(createGitFileReader(synthetic.root), commit);
    expect(phase(snapshot, '02.1').unreadable?.file).toBe(
      '.planning/phases/02.1-inserted-thing/02.1-01-PLAN.md',
    );
    expect(phase(snapshot, '02').unreadable).toBeNull();
    await commitChange(
      synthetic.root,
      '.planning/phases/02.1-inserted-thing/02.1-01-PLAN.md',
      null,
    );
  });
});

describe('parseRoadmap', () => {
  it('returns each phase section text as an exact slice ending at the next heading', () => {
    const text = [
      '# Roadmap',
      '',
      '### Phase 1: One',
      '',
      '**Goal**: First.',
      '',
      '### Phase 01.1: One Point One (INSERTED)',
      '',
      '**Goal:** Second.',
      '',
      '## Progress',
      '',
      'table',
      '',
    ].join('\n');
    const phases = parseRoadmap(text);
    expect(phases.map((p) => [p.number, p.name, p.inserted])).toEqual([
      [[1], 'One', false],
      [[1, 1], 'One Point One', true],
    ]);
    expect(phases[0]?.sectionText).toBe('### Phase 1: One\n\n**Goal**: First.\n\n');
    expect(phases[1]?.sectionText).toBe(
      '### Phase 01.1: One Point One (INSERTED)\n\n**Goal:** Second.\n\n',
    );
    expect(phases[1]?.goal).toBe('Second.');
  });

  it('ignores a phase heading inside a code fence', () => {
    const phases = parseRoadmap('```\n### Phase 9: Fenced\n```\n\n### Phase 2: Real\n');
    expect(phases.map((p) => p.name)).toEqual(['Real']);
  });

  it('reads plan rows, checked or not, with their text', () => {
    const phases = parseRoadmap(
      '### Phase 1: One\n\n- [x] 01-01-PLAN.md — Done thing\n- [ ] 01-02-PLAN.md — Open thing *(wave 2)*\n',
    );
    expect(phases[0]?.planRows).toEqual([
      { file: '01-01-PLAN.md', text: 'Done thing' },
      { file: '01-02-PLAN.md', text: 'Open thing *(wave 2)*' },
    ]);
  });
});

describe('detect', () => {
  it('is true at the Cena master and synthetic fixture commits', async () => {
    expect(await adapter.detect(createGitFileReader(cena.root), cena.commit)).toBe(true);
    expect(await adapter.detect(createGitFileReader(synthetic.root), synthetic.commit)).toBe(true);
  });

  it('is false for a repository whose commit has no roadmap', async () => {
    const dir = makeScratchDir('nogsd');
    await initScratchRepo(dir, { branch: 'master' });
    writeFileIn(dir, 'README.md', '# Not a planned repo\n');
    const commit = await commitAll(dir);
    expect(await adapter.detect(createGitFileReader(dir), commit)).toBe(false);
  });
});

describe('approvalInputs', () => {
  it('throws PhaseNotFoundError until the inputs rule lands (01-07)', async () => {
    await expect(
      adapter.approvalInputs(createGitFileReader(synthetic.root), synthetic.commit, '02'),
    ).rejects.toBeInstanceOf(PhaseNotFoundError);
  });
});
