import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGsdAdapter } from '../../../src/adapters/gsd/index.ts';
import { approvalInputs } from '../../../src/adapters/gsd/inputs.ts';
import {
  normalizeRoadmapSection,
  ROADMAP_SECTION_NORMALIZER,
} from '../../../src/adapters/gsd/normalize.ts';
import { parseRoadmap } from '../../../src/adapters/gsd/roadmap.ts';
import { type ApprovalInput, PhaseNotFoundError } from '../../../src/core/framework/port.ts';
import { createGitFileReader, UnsafeTreeEntryError } from '../../../src/core/git/reader.ts';
import { InvalidIdError } from '../../../src/core/ids.ts';
import {
  commitChange,
  commitSymlink,
  type FixtureRepo,
  materializeFixtureRepo,
} from '../../helpers/fixture-repo.ts';
import { removeScratchDirs } from '../../helpers/scratch.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'gsd');
const SYN_DIR = '.planning/phases/02-ready-thing';
const ROADMAP = '.planning/ROADMAP.md';

const adapter = createGsdAdapter();
const decoder = new TextDecoder();

let synthetic: FixtureRepo;
let cena: FixtureRepo;
let syntheticCache: Promise<ApprovalInput[]> | undefined;

/** Phase 02 inputs of the unmodified synthetic fixture, computed once (inside a test). */
function syntheticPhase02(): Promise<ApprovalInput[]> {
  syntheticCache ??= adapter.approvalInputs(
    createGitFileReader(synthetic.root),
    synthetic.commit,
    '02',
  );
  return syntheticCache;
}

function byPath(inputs: ApprovalInput[], path: string): ApprovalInput {
  const found = inputs.find((input) => input.path === path);
  if (!found) throw new Error(`input ${path} missing`);
  return found;
}

function fixtureBytes(name: string, relPath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name, relPath)));
}

beforeAll(async () => {
  synthetic = await materializeFixtureRepo('synthetic');
  cena = await materializeFixtureRepo('cena-master');
});

afterAll(() => {
  removeScratchDirs();
});

describe('approval inputs (D-02) on the synthetic fixture', () => {
  it('returns exactly the D-02 inputs for phase 02, sorted by path bytes', async () => {
    const syntheticInputs = await syntheticPhase02();
    expect(syntheticInputs.map((input) => input.path)).toEqual([
      '.planning/ROADMAP.md#phase-02',
      `${SYN_DIR}/02-01-PLAN.md`,
      `${SYN_DIR}/02-02-PLAN.md`,
      `${SYN_DIR}/02-CONTEXT.md`,
      `${SYN_DIR}/02-RESEARCH.md`,
      `${SYN_DIR}/02-UI-SPEC.md`,
    ]);
    const sorted = [...syntheticInputs].sort((a, b) =>
      Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
    );
    expect(sorted.map((input) => input.path)).toEqual(syntheticInputs.map((input) => input.path));
  });

  it('never includes DISCUSSION-LOG, PATTERNS or PERMISSION-MATRIX', async () => {
    const syntheticInputs = await syntheticPhase02();
    const names = syntheticInputs.map((input) => input.path);
    expect(names.some((path) => path.endsWith('-DISCUSSION-LOG.md'))).toBe(false);
    expect(names.some((path) => path.endsWith('-PATTERNS.md'))).toBe(false);
    expect(names.some((path) => path.endsWith('-PERMISSION-MATRIX.md'))).toBe(false);
  });

  it('gives every file input its kind, basename label, raw bytes and sourcePath = path', async () => {
    const syntheticInputs = await syntheticPhase02();
    const kinds = Object.fromEntries(syntheticInputs.map((input) => [input.path, input.kind]));
    expect(kinds).toEqual({
      '.planning/ROADMAP.md#phase-02': 'roadmap-section',
      [`${SYN_DIR}/02-01-PLAN.md`]: 'plan',
      [`${SYN_DIR}/02-02-PLAN.md`]: 'plan',
      [`${SYN_DIR}/02-CONTEXT.md`]: 'context',
      [`${SYN_DIR}/02-RESEARCH.md`]: 'research',
      [`${SYN_DIR}/02-UI-SPEC.md`]: 'ui-spec',
    });
    for (const input of syntheticInputs.filter((i) => i.kind !== 'roadmap-section')) {
      expect(input.sourcePath).toBe(input.path);
      expect(input.label).toBe(input.path.slice(input.path.lastIndexOf('/') + 1));
      expect(input.normalization).toBeNull();
      expect(new Uint8Array(input.bytes)).toEqual(fixtureBytes('synthetic', input.path));
    }
  });

  it('adds the ROADMAP section as a normalized virtual input naming .planning/ROADMAP.md', async () => {
    const syntheticInputs = await syntheticPhase02();
    const section = byPath(syntheticInputs, '.planning/ROADMAP.md#phase-02');
    expect(section.sourcePath).toBe(ROADMAP);
    expect(section.label).toBe('ROADMAP.md · Phase 02 section');
    expect(section.kind).toBe('roadmap-section');
    expect(section.normalization).toBe(ROADMAP_SECTION_NORMALIZER);
    expect(ROADMAP_SECTION_NORMALIZER).toBe('cp-gsd-roadmap-section/v1');

    const roadmapText = decoder.decode(fixtureBytes('synthetic', ROADMAP));
    const phase = parseRoadmap(roadmapText).find((p) => p.number.join('.') === '2');
    if (!phase) throw new Error('phase 2 missing from fixture roadmap');
    expect(decoder.decode(section.bytes)).toBe(normalizeRoadmapSection(phase.sectionText));

    const text = decoder.decode(section.bytes);
    expect(text.startsWith('### Phase 02: Ready Thing\n')).toBe(true);
    expect(text).toContain('**Goal**: A phase that has its context and two plans');
    expect(text).not.toContain('**Plans**:');
    expect(text).toContain('- [ ] 02-01-PLAN.md — Set up the ready thing with a checkpoint');
  });

  it('returns only the ROADMAP section for a roadmap phase with no directory', async () => {
    const inputs = await approvalInputs(
      createGitFileReader(synthetic.root),
      synthetic.commit,
      '03',
    );
    expect(inputs.map((input) => input.path)).toEqual(['.planning/ROADMAP.md#phase-03']);
  });

  it('throws PhaseNotFoundError for a phase id the roadmap does not have', async () => {
    await expect(
      adapter.approvalInputs(createGitFileReader(synthetic.root), synthetic.commit, '09'),
    ).rejects.toBeInstanceOf(PhaseNotFoundError);
  });

  it('rejects a malformed phase id before reading anything', async () => {
    await expect(
      adapter.approvalInputs(createGitFileReader(synthetic.root), synthetic.commit, '2/../x'),
    ).rejects.toBeInstanceOf(InvalidIdError);
  });
});

describe('approval inputs (D-02) on the Cena master fixture', () => {
  it('phase 01: CONTEXT, every PLAN, RESEARCH, UI-SPEC and the section, nothing else', async () => {
    const inputs = await approvalInputs(createGitFileReader(cena.root), cena.commit, '01');
    const names = inputs.map((input) => input.path.slice(input.path.lastIndexOf('/') + 1));
    const plans = Array.from(
      { length: 17 },
      (_, i) => `01-${String(i + 1).padStart(2, '0')}-PLAN.md`,
    );
    expect(names).toEqual([
      'ROADMAP.md#phase-01',
      ...plans,
      '01-CONTEXT.md',
      '01-RESEARCH.md',
      '01-UI-SPEC.md',
    ]);
  });

  it('never includes SUMMARY, VALIDATION, PATTERNS, COVERAGE or PERMISSION-MATRIX files', async () => {
    for (const id of ['01', '01.1']) {
      const inputs = await approvalInputs(createGitFileReader(cena.root), cena.commit, id);
      for (const input of inputs) {
        expect(input.path).not.toMatch(
          /(SUMMARY|VALIDATION|PATTERNS|COVERAGE|PERMISSION-MATRIX|VERIFICATION|UAT)\.md$/,
        );
      }
      expect(inputs.some((input) => input.kind === 'plan')).toBe(true);
    }
  });
});

describe('approval inputs refuse unsafe tree entries', () => {
  it('throws UnsafeTreeEntryError for a symlinked PLAN in the phase directory', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    const commit = await commitSymlink(repo.root, `${SYN_DIR}/02-03-PLAN.md`, '../../ROADMAP.md');
    await expect(
      approvalInputs(createGitFileReader(repo.root), commit, '02'),
    ).rejects.toBeInstanceOf(UnsafeTreeEntryError);
  });

  it('throws UnsafeTreeEntryError for an input blob over 5 MiB', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    const commit = await commitChange(
      repo.root,
      `${SYN_DIR}/02-SPEC.md`,
      new Uint8Array(5 * 1024 * 1024 + 1).fill(0x61),
    );
    const error = await approvalInputs(createGitFileReader(repo.root), commit, '02').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(UnsafeTreeEntryError);
    expect((error as UnsafeTreeEntryError).reason).toBe('too-large');
  });

  it('recognises SPEC and AI-SPEC inputs and ignores look-alike names', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await commitChange(repo.root, `${SYN_DIR}/02-SPEC.md`, '# spec\n');
    await commitChange(repo.root, `${SYN_DIR}/02-AI-SPEC.md`, '# ai spec\n');
    await commitChange(repo.root, `${SYN_DIR}/02-01-SUMMARY.md`, '# summary\n');
    await commitChange(repo.root, `${SYN_DIR}/02-VERIFICATION.md`, '# verification\n');
    await commitChange(repo.root, `${SYN_DIR}/02-UAT.md`, '# uat\n');
    await commitChange(repo.root, `${SYN_DIR}/02-CONTEXT.md.bak`, '# backup\n');
    await commitChange(repo.root, `${SYN_DIR}/x-02-RESEARCH.md`, '# prefixed\n');
    const commit = await commitChange(repo.root, `${SYN_DIR}/nested/02-03-PLAN.md`, '---\n---\n');
    const inputs = await approvalInputs(createGitFileReader(repo.root), commit, '02');
    const kinds = Object.fromEntries(inputs.map((input) => [input.path, input.kind]));
    expect(kinds[`${SYN_DIR}/02-SPEC.md`]).toBe('spec');
    expect(kinds[`${SYN_DIR}/02-AI-SPEC.md`]).toBe('ai-spec');
    expect(inputs).toHaveLength(8);
  });
});

describe('ROADMAP section through approvalInputs is digest-stable under bookkeeping', () => {
  async function sectionAfter(edit: (text: string) => string): Promise<string> {
    const repo = await materializeFixtureRepo('synthetic');
    const original = decoder.decode(fixtureBytes('synthetic', ROADMAP));
    const commit = await commitChange(repo.root, ROADMAP, edit(original));
    const inputs = await approvalInputs(createGitFileReader(repo.root), commit, '02');
    return decoder.decode(byPath(inputs, '.planning/ROADMAP.md#phase-02').bytes);
  }

  it('is unchanged when a plan row is ticked and the Plans line moves on', async () => {
    const base = decoder.decode(
      byPath(await syntheticPhase02(), '.planning/ROADMAP.md#phase-02').bytes,
    );
    const after = await sectionAfter((text) =>
      text
        .replace('- [ ] 02-01-PLAN.md', '- [x] 02-01-PLAN.md')
        .replace('**Plans**: 0/2 plans executed', '**Plans**: 1/2 plans executed'),
    );
    expect(after).toBe(base);
  });

  it('changes when the Goal is edited', async () => {
    const base = decoder.decode(
      byPath(await syntheticPhase02(), '.planning/ROADMAP.md#phase-02').bytes,
    );
    const after = await sectionAfter((text) =>
      text.replace('ready to approve.', 'ready to approve, now with extra scope.'),
    );
    expect(after).not.toBe(base);
  });
});

describe('normalizeRoadmapSection (cp-gsd-roadmap-section/v1)', () => {
  const section = [
    '### Phase 02: Ready Thing',
    '',
    '**Goal**: Ship the ready thing.',
    '**Depends on**: Phase 1',
    '**Requirements**: SYN-02, SYN-03',
    '**Success Criteria** (what must be TRUE):',
    '  1. It shows as ready to approve',
    '**Plans**: 2 plans',
    '',
    '- [ ] 02-01-PLAN.md — Set up the ready thing',
    '- [ ] 02-02-PLAN.md — Finish the ready thing',
    '',
  ].join('\n');
  const normalized = normalizeRoadmapSection(section);

  it('ignores a ticked plan-row checkbox (x and X)', () => {
    expect(normalizeRoadmapSection(section.replace('- [ ] 02-01', '- [x] 02-01'))).toBe(normalized);
    expect(normalizeRoadmapSection(section.replace('- [ ] 02-02', '- [X] 02-02'))).toBe(normalized);
  });

  it('ignores the Plans bookkeeping line in both spellings', () => {
    expect(
      normalizeRoadmapSection(
        section.replace('**Plans**: 2 plans', '**Plans**: 2/2 plans executed'),
      ),
    ).toBe(normalized);
    expect(
      normalizeRoadmapSection(
        section.replace('**Plans**: 2 plans', '**Plans:** 2/2 plans executed'),
      ),
    ).toBe(normalized);
    expect(normalized).not.toContain('Plans');
  });

  it('ignores CRLF / CR line endings and trailing whitespace', () => {
    expect(normalizeRoadmapSection(section.replace(/\n/g, '\r\n'))).toBe(normalized);
    expect(normalizeRoadmapSection(section.replace(/\n/g, '\r'))).toBe(normalized);
    expect(normalizeRoadmapSection(section.replace(/\n/g, '  \t\n'))).toBe(normalized);
  });

  it('trims leading and trailing blank lines and ends with exactly one LF', () => {
    expect(normalizeRoadmapSection(`\n\n  \n${section}\n\n\n`)).toBe(normalized);
    expect(normalized.startsWith('### Phase 02')).toBe(true);
    expect(normalized.endsWith('ready thing\n')).toBe(true);
    expect(normalized.endsWith('\n\n')).toBe(false);
  });

  it('keeps the rest of a plan row unchanged', () => {
    expect(normalizeRoadmapSection(section.replace('— Set up', '— Set UP'))).not.toBe(normalized);
    expect(normalized).toContain('- [ ] 02-01-PLAN.md — Set up the ready thing');
  });

  it('changes when Goal, Depends on, Requirements or a Success Criteria line changes', () => {
    const edits = [
      section.replace('Ship the ready thing.', 'Ship the ready thing and more.'),
      section.replace('**Depends on**: Phase 1', '**Depends on**: Phase 1.1'),
      section.replace('SYN-02, SYN-03', 'SYN-02'),
      section.replace('It shows as ready to approve', 'It shows as approved'),
    ];
    for (const edited of edits) {
      expect(normalizeRoadmapSection(edited)).not.toBe(normalized);
    }
  });

  it('does not reset checkboxes on rows that are not plan files', () => {
    const other = `${section}- [x] Some other task\n`;
    expect(normalizeRoadmapSection(other)).toContain('- [x] Some other task');
  });
});
