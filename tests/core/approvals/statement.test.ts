// The approval statement format the owner chose at the 01-12 checkpoint ("item4", RESEARCH Item 4):
// canonical JSON, the strict statement schema, the builder and serializer, the gate-config digest
// and preparation at the base tip. Fixture repos are scratch git repositories; nothing is signed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGsdAdapter } from '../../../src/adapters/gsd/index.ts';
import { canonicalJson } from '../../../src/core/approvals/canonical.ts';
import { sha256Digest } from '../../../src/core/approvals/digest.ts';
import {
  COUNTERPOINT_CONFIG_PATH,
  GatesConfigError,
  gatesDigest,
} from '../../../src/core/approvals/gates.ts';
import { prepareApproval } from '../../../src/core/approvals/prepare.ts';
import {
  APPROVAL_SCHEMA,
  ApprovalStatement,
  buildStatement,
  serializeStatement,
  statementFingerprint,
} from '../../../src/core/approvals/statement.ts';
import type { ApprovalInput } from '../../../src/core/framework/port.ts';
import { createGitFileReader } from '../../../src/core/git/reader.ts';
import {
  commitChange,
  type FixtureRepo,
  materializeFixtureRepo,
} from '../../helpers/fixture-repo.ts';
import { removeScratchDirs } from '../../helpers/scratch.ts';

const adapter = createGsdAdapter();
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const TIP = 'a'.repeat(40);

let synthetic: FixtureRepo;
let gatesRepo: FixtureRepo;

beforeAll(async () => {
  synthetic = await materializeFixtureRepo('synthetic');
  gatesRepo = await materializeFixtureRepo('synthetic');
});

afterAll(() => removeScratchDirs());

function input(path: string, text: string, extra: Partial<ApprovalInput> = {}): ApprovalInput {
  return {
    path,
    sourcePath: path,
    label: path.slice(path.lastIndexOf('/') + 1),
    kind: 'plan',
    normalization: null,
    bytes: new TextEncoder().encode(text),
    ...extra,
  };
}

describe('canonicalJson', () => {
  it('sorts object keys and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
  });

  it('sorts keys by UTF-16 code unit', () => {
    expect(canonicalJson({ a: 1, Z: 2 })).toBe('{"Z":2,"a":1}');
    expect(canonicalJson({ é: 1, z: 2 })).toBe('{"z":2,"é":1}');
    // U+1F600 is the surrogate pair D83D DE00, which sorts before U+FF61 by code unit
    // (by code point it would sort after).
    expect(canonicalJson({ '｡': 1, '\u{1F600}': 2 })).toBe('{"\u{1F600}":2,"｡":1}');
  });

  it('escapes strings exactly as JSON.stringify and adds no whitespace', () => {
    const text = 'quote " backslash \\ newline \n tab \t control \u0001 line-sep  ';
    expect(canonicalJson({ k: text, n: [], o: {} })).toBe(
      `{"k":${JSON.stringify(text)},"n":[],"o":{}}`,
    );
  });

  it('accepts safe integers, booleans, null and nested values', () => {
    expect(canonicalJson([0, -7, Number.MAX_SAFE_INTEGER, false, null, { x: { y: [1] } }])).toBe(
      `[0,-7,${Number.MAX_SAFE_INTEGER},false,null,{"x":{"y":[1]}}]`,
    );
  });

  it.each([
    ['a float', { a: 1.5 }],
    ['NaN', { a: Number.NaN }],
    ['Infinity', [Number.POSITIVE_INFINITY]],
    ['an unsafe integer', { a: 2 ** 60 }],
    ['undefined', { a: undefined }],
    ['a function', { a: () => 1 }],
    ['a bigint', { a: 1n }],
  ])('throws on %s', (_name, value) => {
    expect(() => canonicalJson(value)).toThrow();
  });

  it('names the key path of a rejected value', () => {
    expect(() => canonicalJson({ lint: { timeout: 2.5 } }, 'gates')).toThrow('gates.lint.timeout');
  });
});

describe('buildStatement', () => {
  it('builds the item4 format for synthetic phase 02 at a fixed tip', async () => {
    const reader = createGitFileReader(synthetic.root);
    const inputs = await adapter.approvalInputs(reader, synthetic.commit, '02');
    const statement = buildStatement({
      hostId: 'synthetic',
      phaseId: '02',
      baseBranch: 'master',
      tip: synthetic.commit,
      inputs,
      gates: { state: 'absent', digest: null },
    });

    expect(statement.schema).toBe(APPROVAL_SCHEMA);
    expect(statement.schema).toBe('counterpoint/approval/v1');
    expect(statement.kind).toBe('runway');
    expect(statement.host).toBe('synthetic');
    expect(statement.item).toEqual({ type: 'phase', id: '02' });
    expect(statement.base).toEqual({ branch: 'master', commit: synthetic.commit });
    expect(statement.inputs.algorithm).toBe('sha256');
    expect(statement.draft).toEqual({ state: 'none', digest: null });
    expect(statement.gates).toEqual({ state: 'absent', digest: null });

    const paths = statement.inputs.files.map((f) => f.path);
    expect(paths).toEqual([
      '.planning/ROADMAP.md#phase-02',
      '.planning/phases/02-ready-thing/02-01-PLAN.md',
      '.planning/phases/02-ready-thing/02-02-PLAN.md',
      '.planning/phases/02-ready-thing/02-CONTEXT.md',
      '.planning/phases/02-ready-thing/02-RESEARCH.md',
      '.planning/phases/02-ready-thing/02-UI-SPEC.md',
    ]);
    for (const file of statement.inputs.files) {
      const source = inputs.find((i) => i.path === file.path) as ApprovalInput;
      expect(file.digest).toBe(sha256Digest(source.bytes));
      expect(file.kind).toBe(source.kind);
    }
    const section = statement.inputs.files[0];
    expect(section?.normalization).toBe('cp-gsd-roadmap-section/v1');
    expect(section?.kind).toBe('roadmap-section');
    expect('normalization' in (statement.inputs.files[1] as object)).toBe(false);
    expect(statement.inputs.combined).toBe(sha256Digest(canonicalJson(statement.inputs.files)));
    expect(ApprovalStatement.parse(statement)).toEqual(statement);
  });

  it('sorts files by path bytes, not by locale', () => {
    const statement = buildStatement({
      hostId: 'h',
      phaseId: '02',
      baseBranch: 'master',
      tip: TIP,
      inputs: [
        input('b/x.md', '1'),
        input('B/x.md', '2'),
        input('a/é.md', '3'),
        input('a/z.md', '4'),
      ],
      gates: { state: 'absent', digest: null },
    });
    expect(statement.inputs.files.map((f) => f.path)).toEqual([
      'B/x.md',
      'a/z.md',
      'a/é.md',
      'b/x.md',
    ]);
  });

  it('serializes identical bytes and fingerprint whatever the input order', () => {
    const inputs = [input('p/1.md', 'one'), input('p/2.md', 'two'), input('p/3.md', 'three')];
    const build = (list: ApprovalInput[]) =>
      buildStatement({
        hostId: 'h',
        phaseId: '02',
        baseBranch: 'master',
        tip: TIP,
        inputs: list,
        gates: { state: 'present', digest: sha256Digest('{}') },
      });
    const a = build(inputs);
    const b = build([inputs[2], inputs[0], inputs[1]] as ApprovalInput[]);
    expect(serializeStatement(b)).toBe(serializeStatement(a));
    expect(statementFingerprint(b)).toBe(statementFingerprint(a));
    expect(statementFingerprint(a)).toMatch(/^[0-9a-f]{12}$/);
    expect(statementFingerprint(a)).toBe(sha256Digest(canonicalJson(a)).slice(7, 19));
  });

  it('serializes pretty JSON with sorted keys, two-space indent and a trailing LF', () => {
    const statement = buildStatement({
      hostId: 'h',
      phaseId: '02',
      baseBranch: 'master',
      tip: TIP,
      inputs: [input('p/1.md', 'one')],
      gates: { state: 'absent', digest: null },
    });
    const text = serializeStatement(statement);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.startsWith('{\n  "base": {\n    "branch": "master",\n')).toBe(true);
    const keys = Object.keys(JSON.parse(text));
    expect(keys).toEqual(['base', 'draft', 'gates', 'host', 'inputs', 'item', 'kind', 'schema']);
    expect(ApprovalStatement.parse(JSON.parse(text))).toEqual(statement);
  });

  it('refuses two inputs with the same path', () => {
    expect(() =>
      buildStatement({
        hostId: 'h',
        phaseId: '02',
        baseBranch: 'master',
        tip: TIP,
        inputs: [input('p/1.md', 'one'), input('p/1.md', 'two')],
        gates: { state: 'absent', digest: null },
      }),
    ).toThrow();
  });
});

describe('ApprovalStatement schema', () => {
  function valid(): Record<string, unknown> {
    return JSON.parse(
      serializeStatement(
        buildStatement({
          hostId: 'h',
          phaseId: '02',
          baseBranch: 'master',
          tip: TIP,
          inputs: [input('p/1.md', 'one')],
          gates: { state: 'absent', digest: null },
        }),
      ),
    );
  }

  it('accepts a built statement', () => {
    expect(ApprovalStatement.safeParse(valid()).success).toBe(true);
  });

  it('rejects an unknown top-level key', () => {
    expect(ApprovalStatement.safeParse({ ...valid(), prepared: { at: 'now' } }).success).toBe(
      false,
    );
  });

  it('rejects a wrong schema string', () => {
    expect(
      ApprovalStatement.safeParse({ ...valid(), schema: 'counterpoint/approval/v2' }).success,
    ).toBe(false);
  });

  it('rejects a malformed digest', () => {
    const statement = valid() as { inputs: { files: { digest: string }[] } };
    (statement.inputs.files[0] as { digest: string }).digest = 'sha256:ABC';
    expect(ApprovalStatement.safeParse(statement).success).toBe(false);
  });

  it('rejects a combined digest that does not match the files', () => {
    const statement = valid() as { inputs: { combined: string } };
    statement.inputs.combined = sha256Digest('something else');
    expect(ApprovalStatement.safeParse(statement).success).toBe(false);
  });

  it('rejects a present gates slot without a digest and a draft that is not none', () => {
    expect(
      ApprovalStatement.safeParse({ ...valid(), gates: { state: 'present', digest: null } })
        .success,
    ).toBe(false);
    expect(
      ApprovalStatement.safeParse({ ...valid(), draft: { state: 'some', digest: null } }).success,
    ).toBe(false);
  });

  it('rejects a host or phase id that fails the regex', () => {
    expect(ApprovalStatement.safeParse({ ...valid(), host: '-bad' }).success).toBe(false);
    expect(
      ApprovalStatement.safeParse({ ...valid(), item: { type: 'phase', id: '2' } }).success,
    ).toBe(false);
  });
});

describe('gatesDigest', () => {
  it('uses the .counterpoint/config.yaml path', () => {
    expect(COUNTERPOINT_CONFIG_PATH).toBe('.counterpoint/config.yaml');
  });

  it('is the absent sentinel when there is no config file', async () => {
    const reader = createGitFileReader(gatesRepo.root);
    expect(await gatesDigest(reader, gatesRepo.commit)).toEqual({ state: 'absent', digest: null });
  });

  it('is the absent sentinel when the config has no gates key', async () => {
    const commit = await commitChange(gatesRepo.root, COUNTERPOINT_CONFIG_PATH, 'port: 4170\n');
    const reader = createGitFileReader(gatesRepo.root);
    expect(await gatesDigest(reader, commit)).toEqual({ state: 'absent', digest: null });
  });

  it('is present with the sha256 of the canonical JSON of the gates section', async () => {
    const commit = await commitChange(
      gatesRepo.root,
      COUNTERPOINT_CONFIG_PATH,
      'port: 4170\ngates:\n  test:\n    command: pnpm test\n    timeout: 600\n  lint: { command: pnpm lint }\n',
    );
    const reader = createGitFileReader(gatesRepo.root);
    expect(await gatesDigest(reader, commit)).toEqual({
      state: 'present',
      digest: sha256Digest(
        canonicalJson({
          lint: { command: 'pnpm lint' },
          test: { command: 'pnpm test', timeout: 600 },
        }),
      ),
    });
  });

  it('ignores edits outside the gates section', async () => {
    const reader = createGitFileReader(gatesRepo.root);
    const before = await commitChange(
      gatesRepo.root,
      COUNTERPOINT_CONFIG_PATH,
      'port: 4170\ngates:\n  test: { command: pnpm test }\n',
    );
    const after = await commitChange(
      gatesRepo.root,
      COUNTERPOINT_CONFIG_PATH,
      '# a comment\nport: 4171\ngates:\n  test:   { command: pnpm test }\n',
    );
    expect(await gatesDigest(reader, after)).toEqual(await gatesDigest(reader, before));
  });

  it('throws naming the key path when gates hold a float', async () => {
    const commit = await commitChange(
      gatesRepo.root,
      COUNTERPOINT_CONFIG_PATH,
      'gates:\n  lint:\n    timeout: 2.5\n',
    );
    const reader = createGitFileReader(gatesRepo.root);
    await expect(gatesDigest(reader, commit)).rejects.toThrow(GatesConfigError);
    await expect(gatesDigest(reader, commit)).rejects.toThrow('gates.lint.timeout');
  });

  it('throws when the config is not valid YAML', async () => {
    const commit = await commitChange(gatesRepo.root, COUNTERPOINT_CONFIG_PATH, 'gates: [\n');
    const reader = createGitFileReader(gatesRepo.root);
    await expect(gatesDigest(reader, commit)).rejects.toThrow(GatesConfigError);
  });
});

describe('prepareApproval', () => {
  async function prepare(phaseId: string) {
    return prepareApproval({
      hostId: 'synthetic',
      baseBranch: 'master',
      phaseId,
      reader: createGitFileReader(synthetic.root),
      adapter,
    });
  }

  it('prepares phase 02 at the local base tip', async () => {
    const prepared = await prepare('02');
    if (!prepared.ok) throw new Error(`refused: ${prepared.reason}`);
    expect(prepared.tip).toBe(synthetic.commit);
    expect(prepared.itemId).toBe('phase-02');
    expect(prepared.itemPath).toBe('.counterpoint/approvals/phase-02.json');
    expect(prepared.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(prepared.fingerprint).toBe(statementFingerprint(prepared.statement));
    expect(new TextDecoder().decode(prepared.bytes)).toBe(serializeStatement(prepared.statement));
    expect(prepared.statement.base).toEqual({ branch: 'master', commit: synthetic.commit });
    expect(prepared.phase).toEqual({ id: '02', name: 'Ready Thing', planCount: 2 });
    expect(prepared.prerequisites.total).toBe(2);
    expect(prepared.prerequisites.nonAutonomous).toBe(1);
    expect(prepared.prerequisites.userSetup.map((s) => s.service)).toContain('google-oauth');
    expect(prepared.inputs.map((i) => i.path)).toEqual(
      prepared.statement.inputs.files.map((f) => f.path),
    );
    const section = prepared.inputs[0];
    expect(section?.label).toBe('ROADMAP.md · Phase 02 section');
    expect(section?.normalization).toBe('cp-gsd-roadmap-section/v1');
    for (const entry of prepared.inputs) expect(entry.digest).toMatch(DIGEST_RE);
    expect(prepared.inputs[1]?.normalization).toBeNull();
  });

  it('prepares byte-identical statements for the same tip', async () => {
    const a = await prepare('02');
    const b = await prepare('02');
    if (!a.ok || !b.ok) throw new Error('refused');
    expect(Buffer.from(b.bytes).equals(Buffer.from(a.bytes))).toBe(true);
  });

  it('refuses a phase without context as not-ready (no-context)', async () => {
    expect(await prepare('03')).toMatchObject({
      ok: false,
      reason: 'not-ready',
      notReadyReason: 'no-context',
    });
  });

  it('refuses a phase with context but no plans as not-ready (no-plans)', async () => {
    expect(await prepare('02.1')).toMatchObject({
      ok: false,
      reason: 'not-ready',
      notReadyReason: 'no-plans',
    });
  });

  it('refuses a built phase', async () => {
    expect(await prepare('01')).toMatchObject({ ok: false, reason: 'built' });
  });

  it('refuses an unreadable phase naming the file and reason', async () => {
    const result = await prepare('04');
    expect(result).toMatchObject({ ok: false, reason: 'unreadable' });
    if (result.ok || result.reason !== 'unreadable') throw new Error('expected unreadable');
    expect(result.file).toContain('04-01-PLAN.md');
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it('refuses an unknown phase as not-found', async () => {
    expect(await prepare('09')).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('refuses when the base branch does not resolve', async () => {
    const result = await prepareApproval({
      hostId: 'synthetic',
      baseBranch: 'no-such-branch',
      phaseId: '02',
      reader: createGitFileReader(synthetic.root),
      adapter,
    });
    expect(result).toMatchObject({ ok: false, reason: 'no-base' });
  });

  it('refuses invalid ids before reading anything', async () => {
    await expect(prepare('2')).rejects.toThrow('Invalid phase id');
    await expect(
      prepareApproval({
        hostId: '-x',
        baseBranch: 'master',
        phaseId: '02',
        reader: createGitFileReader(synthetic.root),
        adapter,
      }),
    ).rejects.toThrow('Invalid host id');
  });
});
