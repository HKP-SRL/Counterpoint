// The accepted-risk record and the verdict matrix it feeds. Scratch homes only: nothing
// here touches the owner's real Counterpoint home.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ACCEPTED_RISK_IDS,
  ACCEPTED_RISKS_SCHEMA,
  type AcceptedRisk,
  readAcceptedRisks,
  revokeAcceptedRisk,
  writeAcceptedRisk,
} from '../../../src/core/security/accepted-risks.ts';
import {
  appliedAcceptedRisks,
  DoctorReport,
  PROBE_TARGET_IDS,
  type ProbeTarget,
  type ProbeTargetId,
  probeTargetMode,
  reachedOnlyByKeychain,
  reportVerdict,
} from '../../../src/core/security/doctor-report.ts';
import { makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

afterAll(() => removeScratchDirs());

const NOW = new Date('2026-11-10T10:00:00.000Z');
const recordFile = (home: string) => join(home, 'trust', 'accepted-risks.json');

const ENTRY: AcceptedRisk = {
  id: 'gh-keychain',
  target: 'gh',
  subStep: 'keychain',
  reason: 'the gh keyring entry; accepted macOS residual',
  recordedAt: NOW.toISOString(),
};

/** Writes raw record content into a scratch home's trust folder (0700 dir, 0600 file). */
function rawHome(content: string, mode = 0o600): string {
  const home = makeScratchDir('arhome');
  mkdirSync(join(home, 'trust'), { recursive: true, mode: 0o700 });
  chmodSync(join(home, 'trust'), 0o700);
  writeFileSync(recordFile(home), content, { mode });
  chmodSync(recordFile(home), mode);
  return home;
}

describe('the accepted-risk record', () => {
  it('reads a fresh home as ok with no risk (nothing ships by default)', () => {
    expect(ACCEPTED_RISK_IDS).toEqual(['gh-keychain']);
    expect(readAcceptedRisks(makeScratchDir('arhome'))).toEqual({ ok: true, risks: [] });
  });

  it('round-trips an entry, with the file 0600 and the trust folder 0700', () => {
    const home = makeScratchDir('arhome');
    const written = writeAcceptedRisk(home, { reason: `  ${ENTRY.reason}  `, now: () => NOW });
    expect(written).toEqual(ENTRY);
    expect(readAcceptedRisks(home)).toEqual({ ok: true, risks: [ENTRY] });
    expect(statSync(recordFile(home)).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, 'trust')).mode & 0o777).toBe(0o700);
  });

  it('revokes an entry, deleting the file, and reports whether one existed', () => {
    const home = makeScratchDir('arhome');
    writeAcceptedRisk(home, { reason: ENTRY.reason, now: () => NOW });
    expect(revokeAcceptedRisk(home, 'gh-keychain')).toBe(true);
    expect(existsSync(recordFile(home))).toBe(false);
    expect(revokeAcceptedRisk(home, 'gh-keychain')).toBe(false);
  });

  it('refuses to write an invalid reason', () => {
    const home = makeScratchDir('arhome');
    for (const reason of ['', '   ', 'a\u0000b', 'a\u009bb', 'x'.repeat(301)]) {
      expect(() => writeAcceptedRisk(home, { reason })).toThrow(/reason/);
    }
    expect(existsSync(recordFile(home))).toBe(false);
  });

  const valid = (risks: unknown[]) => JSON.stringify({ schema: ACCEPTED_RISKS_SCHEMA, risks });

  it.each([
    ['an unknown id', valid([{ ...ENTRY, id: 'ssh' }])],
    ['a second entry', valid([ENTRY, { ...ENTRY, recordedAt: '2026-11-11T10:00:00.000Z' }])],
    ['a control-character reason', valid([{ ...ENTRY, reason: 'bad\u001b[2Jreason' }])],
    ['a widened target', valid([{ ...ENTRY, target: 'ssh' }])],
    ['a widened sub-step', valid([{ ...ENTRY, subStep: 'read' }])],
    ['an extra field', valid([{ ...ENTRY, covers: 'everything' }])],
    ['another schema id', JSON.stringify({ schema: 'counterpoint/accepted-risks/v2', risks: [] })],
    ['a bad recordedAt', valid([{ ...ENTRY, recordedAt: 'yesterday' }])],
    ['invalid JSON', '{ "schema": '],
  ])('refuses %s (ok: false)', (_name, content) => {
    const read = readAcceptedRisks(rawHome(content));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problem).not.toMatch(/[\r\n]/);
  });

  it('refuses a group-writable file', () => {
    const read = readAcceptedRisks(rawHome(valid([ENTRY]), 0o620));
    expect(read).toMatchObject({ ok: false });
    expect(!read.ok && read.problem).toMatch(/writable by group or others/);
  });

  it('refuses an oversize file', () => {
    const read = readAcceptedRisks(rawHome(`${valid([ENTRY])}${' '.repeat(17 * 1024)}`));
    expect(!read.ok && read.problem).toMatch(/too large/);
  });

  it('refuses a symlink in place of the record', () => {
    const elsewhere = join(makeScratchDir('arelse'), 'record.json');
    writeFileSync(elsewhere, valid([ENTRY]), { mode: 0o600 });
    const home = makeScratchDir('arhome');
    mkdirSync(join(home, 'trust'), { recursive: true, mode: 0o700 });
    symlinkSync(elsewhere, recordFile(home));
    const read = readAcceptedRisks(home);
    expect(!read.ok && read.problem).toMatch(/symlink/);
    expect(() => revokeAcceptedRisk(home, 'gh-keychain')).toThrow(/symlink/);
  });

  it('refuses a trust folder writable by group or others', () => {
    const home = rawHome(valid([ENTRY]));
    chmodSync(join(home, 'trust'), 0o770);
    const read = readAcceptedRisks(home);
    expect(!read.ok && read.problem).toMatch(/writable only by its owner/);
    chmodSync(join(home, 'trust'), 0o700);
  });

  it('refuses a directory in place of the record', () => {
    const home = makeScratchDir('arhome');
    mkdirSync(recordFile(home), { recursive: true });
    const read = readAcceptedRisks(home);
    expect(read.ok).toBe(false);
    rmSync(recordFile(home), { recursive: true });
  });
});

// --- The verdict matrix ------------------------------------------------------------------------

type Step = ProbeTarget['steps'][number];

const GH_FILE_STEPS: Step[] = [
  { index: 10, tool: 'Bash', operation: 'cat', treatment: 'denied-rule', control: 'reached' },
  { index: 11, tool: 'Read', operation: 'read', treatment: 'denied-rule', control: 'reached' },
  { index: 12, tool: 'Grep', operation: 'grep', treatment: 'denied-rule', control: 'reached' },
];
const KEYCHAIN_STEP: Step = {
  index: 13,
  tool: 'Bash',
  operation: 'keychain',
  treatment: 'reached',
  control: 'reached',
};

interface MatrixOptions {
  gh?: Partial<ProbeTarget> & { dropEvidence?: boolean };
  reachable?: Partial<Record<ProbeTargetId, ProbeTarget['leaks']>>;
  allBlocked?: boolean;
  isolation?: 'pass' | 'fail';
  agentMode?: 'pass' | 'fail';
  acceptedRisks?: AcceptedRisk[];
}

/** One nine-row report (isolation and agent mode passing) whose gh row is Keychain-only. */
function matrixReport(options: MatrixOptions = {}): DoctorReport {
  const check = (id: string) => ({ id, label: id, result: 'pass', detail: 'ok' });
  const probe = PROBE_TARGET_IDS.map((id) => {
    const base = {
      id,
      label: id,
      mode: probeTargetMode(id),
      result: 'blocked',
      evidence: 'probe',
      steps: [] as Step[],
      leaks: [] as string[],
      trusted: true,
    };
    if (id === 'gh' && options.allBlocked !== true) {
      const { dropEvidence, ...gh } = options.gh ?? {};
      const row = {
        ...base,
        result: 'reachable',
        steps: [...GH_FILE_STEPS, KEYCHAIN_STEP],
        leaks: ['keychain-canary'],
        ...gh,
      };
      if (dropEvidence === true) {
        const { steps: _s, leaks: _l, trusted: _t, ...older } = row;
        return older;
      }
      return row;
    }
    const leaks = options.reachable?.[id];
    return leaks === undefined ? base : { ...base, result: 'reachable', leaks };
  });
  return DoctorReport.parse({
    schema: 'counterpoint/doctor/v1',
    hostId: 'demo',
    checkedAt: NOW.toISOString(),
    claudeVersion: '2.1.321 (Claude Code)',
    matcherVersion: '2.1.321+r4',
    tools: [check('claude'), check('git'), check('gh')],
    signingKey: [check('passphrase')],
    integrity: check('integrity'),
    probe,
    sandboxIsolation: {
      id: 'sandbox-isolation',
      label: 'Sandbox isolation settings',
      result: options.isolation ?? 'pass',
      detail: 'ok',
      sources: [
        { kind: 'launch', label: 'launch settings', path: null, state: 'read', findings: [] },
      ],
    },
    agentMode: {
      id: 'agent-mode',
      label: 'Agent permission mode',
      result: options.agentMode ?? 'pass',
      detail: 'ok',
      expected: 'auto',
      effective: options.agentMode === 'fail' ? 'default' : 'auto',
    },
    acceptedRisks: options.acceptedRisks ?? [ENTRY],
  });
}

const ghRow = (report: DoctorReport) => report.probe.find((row) => row.id === 'gh') as ProbeTarget;

describe('reportVerdict and appliedAcceptedRisks', () => {
  it('reads Keychain-only gh evidence as reachedOnlyByKeychain', () => {
    expect(reachedOnlyByKeychain(ghRow(matrixReport()))).toBe(true);
  });

  it('is accepted-risk with the risk recorded in the report and still recorded now', () => {
    const report = matrixReport();
    expect(appliedAcceptedRisks(report, [ENTRY])).toEqual([ENTRY]);
    expect(reportVerdict(report, [ENTRY])).toBe('accepted-risk');
    // The gh row keeps its measured result.
    expect(ghRow(report).result).toBe('reachable');
  });

  const failing: Array<[string, DoctorReport, AcceptedRisk[]]> = [
    ['not recorded now (revoked)', matrixReport(), []],
    ['only recorded now (after the check)', matrixReport({ acceptedRisks: [] }), [ENTRY]],
    [
      'a different recordedAt now',
      matrixReport(),
      [{ ...ENTRY, recordedAt: '2026-11-10T10:00:01.000Z' }],
    ],
    [
      'gh leaks file-canary and keychain-canary',
      matrixReport({ gh: { leaks: ['file-canary', 'keychain-canary'] } }),
      [ENTRY],
    ],
    ['gh leaks file-canary only', matrixReport({ gh: { leaks: ['file-canary'] } }), [ENTRY]],
    [
      'gh leaks a leftover',
      matrixReport({ gh: { leaks: ['keychain-canary', 'leftover'] } }),
      [ENTRY],
    ],
    [
      'a gh read step reached',
      matrixReport({
        gh: {
          steps: [
            GH_FILE_STEPS[0] as Step,
            { ...(GH_FILE_STEPS[1] as Step), treatment: 'reached' },
            GH_FILE_STEPS[2] as Step,
            KEYCHAIN_STEP,
          ],
        },
      }),
      [ENTRY],
    ],
    [
      'a gh file step refused only by the mode',
      matrixReport({
        gh: {
          steps: [
            { ...(GH_FILE_STEPS[0] as Step), treatment: 'denied-mode' },
            ...GH_FILE_STEPS.slice(1),
            KEYCHAIN_STEP,
          ],
        },
      }),
      [ENTRY],
    ],
    [
      'a gh file step whose control did not reach',
      matrixReport({
        gh: {
          steps: [
            { ...(GH_FILE_STEPS[0] as Step), control: 'unknown' },
            ...GH_FILE_STEPS.slice(1),
            KEYCHAIN_STEP,
          ],
        },
      }),
      [ENTRY],
    ],
    [
      'the Keychain control did not reach',
      matrixReport({ gh: { steps: [...GH_FILE_STEPS, { ...KEYCHAIN_STEP, control: 'unknown' }] } }),
      [ENTRY],
    ],
    [
      'two Keychain steps',
      matrixReport({
        gh: { steps: [...GH_FILE_STEPS, KEYCHAIN_STEP, { ...KEYCHAIN_STEP, index: 14 }] },
      }),
      [ENTRY],
    ],
    ['no gh file step', matrixReport({ gh: { steps: [KEYCHAIN_STEP] } }), [ENTRY]],
    ['gh trusted: false', matrixReport({ gh: { trusted: false } }), [ENTRY]],
    [
      'the gh row without steps (an older report)',
      matrixReport({ gh: { dropEvidence: true } }),
      [ENTRY],
    ],
    ['gh not-checked', matrixReport({ gh: { result: 'not-checked' } }), [ENTRY]],
    ['ssh reachable as well', matrixReport({ reachable: { ssh: ['file-canary'] } }), [ENTRY]],
    [
      'credential-env reachable as well',
      matrixReport({ reachable: { 'credential-env': ['credential-variable'] } }),
      [ENTRY],
    ],
    [
      'outside-workdir reachable as well',
      matrixReport({ reachable: { 'outside-workdir': ['leftover'] } }),
      [ENTRY],
    ],
    ['the sandbox isolation check failing', matrixReport({ isolation: 'fail' }), [ENTRY]],
    ['the agent permission mode check failing', matrixReport({ agentMode: 'fail' }), [ENTRY]],
    ['a fresh home (no record) for the same evidence', matrixReport({ acceptedRisks: [] }), []],
  ];

  it.each(failing)('fails with %s', (_name, report, recorded) => {
    expect(reportVerdict(report, recorded)).toBe('fail');
  });

  it('applies no risk when gh itself does not qualify, while the record is in force', () => {
    expect(appliedAcceptedRisks(matrixReport({ gh: { trusted: false } }), [ENTRY])).toEqual([]);
    expect(appliedAcceptedRisks(matrixReport(), [])).toEqual([]);
  });

  it('marks the older-report gh row as not qualifying, after parsing defaults', () => {
    const older = ghRow(matrixReport({ gh: { dropEvidence: true } }));
    expect(older.steps).toEqual([]);
    expect(older.leaks).toEqual([]);
    expect(older.trusted).toBe(false);
    expect(reachedOnlyByKeychain(older)).toBe(false);
  });

  it('passes with every row Blocked and the risk recorded (not needed)', () => {
    const report = matrixReport({ allBlocked: true });
    expect(appliedAcceptedRisks(report, [ENTRY])).toEqual([]);
    expect(reportVerdict(report, [ENTRY])).toBe('pass');
  });

  it('fails the Keychain-only gh reach by default (no recorded argument)', () => {
    expect(reportVerdict(matrixReport())).toBe('fail');
  });

  it('fails a Keychain-only gh reach in a fresh home read through the record store', () => {
    const fresh = readAcceptedRisks(makeScratchDir('arhome'));
    expect(fresh).toEqual({ ok: true, risks: [] });
    const recorded = fresh.ok ? fresh.risks : [];
    expect(reportVerdict(matrixReport({ acceptedRisks: recorded }), recorded)).toBe('fail');
  });

  it('never qualifies a row other than gh, even with Keychain-only evidence', () => {
    const report = matrixReport();
    const ssh = { ...ghRow(report), id: 'ssh' as const };
    expect(reachedOnlyByKeychain(ssh)).toBe(false);
  });
});
