// The run report (run-report: Report at the end of every run): built from the store and the run
// folder, written as Markdown at run end, printed by `counterpoint run report`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildRunReport,
  reportMarkdown,
  runDirFor,
  writeRunReport,
} from '../../src/build/run-report.ts';
import { runReportCommand } from '../../src/cli/run.ts';
import type { ChangeFacts } from '../../src/core/framework/port.ts';
import { openStore, type Store, upsertHost } from '../../src/core/store/db.ts';
import {
  addRunChangeFlags,
  endRun,
  finishGateResult,
  getRun,
  insertGateResult,
  insertRun,
  insertRunChange,
  parkRunChange,
  updateRunChange,
} from '../../src/core/store/runs.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(removeScratchDirs);

function store(): { home: string; db: Store } {
  const home = makeScratchDir('run-report');
  const db = openStore(home);
  upsertHost(db, {
    id: 'cena',
    root: '/x/cena',
    gitCommonDir: '/x/cena/.git',
    baseBranch: 'master',
    adapter: 'openspec',
  });
  return { home, db };
}

const facts = (id: string, ownerSteps: string[] = []): ChangeFacts =>
  ({ id, title: `The ${id}`, tasks: { total: 3, done: 1, ownerSteps } }) as unknown as ChangeFacts;

/** A mixed night: one green, one green with a planning edit, one parked, one not built. */
function mixedNight(
  home: string,
  db: Store,
  end: { reason: 'finished' | 'error'; detail?: string },
) {
  insertRun(
    db,
    {
      id: 'run-1',
      hostId: 'cena',
      settings: { model: 'opus', effort: 'high', budgetPercent: 40 },
      stopAt: null,
    },
    1_000,
  );
  const green = insertRunChange(db, { runId: 'run-1', change: 'a-thing', position: 0 });
  updateRunChange(db, green, {
    state: 'green',
    baseCommit: 'a'.repeat(40),
    prUrl: 'https://github.com/x/y/pull/1',
    previewUrl: 'https://cena-a.vercel.app/',
  });
  const planning = insertRunChange(db, { runId: 'run-1', change: 'b-thing', position: 1 });
  updateRunChange(db, planning, { state: 'green', prUrl: 'https://github.com/x/y/pull/2' });
  addRunChangeFlags(db, planning, [
    {
      kind: 'protected-path',
      path: 'openspec/changes/b-thing/proposal.md',
      category: 'planning',
      status: 'modified',
    } as never,
  ]);
  const parked = insertRunChange(db, { runId: 'run-1', change: 'c-thing', position: 2 });
  const gate = insertGateResult(db, {
    runChangeId: parked,
    attempt: 3,
    gate: 'unit',
    processTag: 't',
    logPath: '/logs/unit.log',
  });
  finishGateResult(db, gate, {
    verdict: 'fail',
    reason: 'exit-code',
    exitCode: 1,
    signal: null,
    tail: 'FAIL src/menu.test.ts\nExpected 3, got 2',
    survivors: [],
    durationMs: 4000,
  });
  parkRunChange(db, parked, 'Gate "unit" failed 3 times (last: exit code 1).');
  const stopped = insertRunChange(db, { runId: 'run-1', change: 'd-thing', position: 3 });
  updateRunChange(db, stopped, { state: 'stopped', reason: 'Not built: the run ended (error).' });
  endRun(db, 'run-1', end, 9_000);
  const dir = join(runDirFor(home, 'cena', 'run-1'), 'a-thing');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'assumptions.md'),
    '\n<!-- session 1 -->\n- Prices are shown in euros.\n',
  );
}

describe('the run report', () => {
  it('sorts a mixed night into ready, not for merge, parked and not built, with what waits', async () => {
    const { home, db } = store();
    mixedNight(home, db, { reason: 'finished' });
    const report = await buildRunReport({
      home,
      db,
      runId: 'run-1',
      factsAt: async (change) =>
        facts(change, change === 'a-thing' ? ['Owner: check the menu on a phone'] : []),
    });
    expect(report?.ready.map((c) => [c.change, c.title, c.prUrl, c.previewUrl])).toEqual([
      ['a-thing', 'The a-thing', 'https://github.com/x/y/pull/1', 'https://cena-a.vercel.app/'],
    ]);
    expect(report?.notForMerge.map((c) => c.change)).toEqual(['b-thing']);
    expect(report?.parked[0]).toMatchObject({
      change: 'c-thing',
      reason: 'Gate "unit" failed 3 times (last: exit code 1).',
      lastFailure: { gate: 'unit', attempt: 3, exitCode: 1, logPath: '/logs/unit.log' },
    });
    expect(report?.notBuilt.map((c) => c.change)).toEqual(['d-thing']);
    expect(report?.waiting).toEqual([
      'a-thing: Owner: check the menu on a phone',
      '1 parked change: see Needs You for every gate attempt.',
    ]);
    expect(report?.assumptions).toEqual([
      { change: 'a-thing', text: '- Prices are shown in euros.' },
    ]);
    expect(report?.settings).toEqual({ model: 'opus', effort: 'high', budgetPercent: 40 });

    const md = reportMarkdown(report as NonNullable<typeof report>);
    expect(md).toContain('# Run run-1 on cena');
    expect(md).toContain('the run finished: every chosen change was built or parked.');
    expect(md).toContain('Builder: opus, high effort, 40% context budget.');
    expect(md).toContain(
      '- **The a-thing** (`a-thing`) · PR https://github.com/x/y/pull/1 · preview https://cena-a.vercel.app/',
    );
    expect(md).toContain('## Not for merge (1)');
    expect(md).toContain(
      'Last failing gate: unit, attempt 3 (exit-code, exit 1). Log: /logs/unit.log',
    );
    expect(md).toContain('  Expected 3, got 2');
    expect(md).toContain('> - Prices are shown in euros.');
    expect(md).toContain('- `b-thing`: planning `openspec/changes/b-thing/proposal.md` (modified)');
  });

  it('says why a run stopped on an error and what to do first', async () => {
    const { home, db } = store();
    mixedNight(home, db, { reason: 'error', detail: 'Claude Code reported a credit error.' });
    const report = await buildRunReport({ home, db, runId: 'run-1' });
    expect(report?.endReason).toBe('error');
    expect(report?.waiting[0]).toMatch(/\S/);
    expect(report?.ready.map((c) => c.change)).toEqual(['a-thing']);
    const md = reportMarkdown(report as NonNullable<typeof report>);
    expect(md).toContain('the run stopped on an error.');
    expect(md).toContain('Claude Code reported a credit error.');
  });

  it('writes report.md, records it with the run, and the CLI prints it', async () => {
    const { home, db } = store();
    mixedNight(home, db, { reason: 'finished' });
    const path = await writeRunReport({ home, db, runId: 'run-1' });
    expect(path).toBe(join(runDirFor(home, 'cena', 'run-1'), 'report.md'));
    expect(getRun(db, 'run-1')?.reportPath).toBe(path);
    db.close();
    const out: string[] = [];
    expect(runReportCommand(home, 'cena', { out: (l) => out.push(l) })).toBe(0);
    expect(out.join('\n')).toBe(readFileSync(path as string, 'utf8').trimEnd());
  });

  it('writes a report for a run refused before it built anything', async () => {
    const { home, db } = store();
    insertRun(db, { id: 'run-2', hostId: 'cena', settings: {}, stopAt: null });
    endRun(db, 'run-2', { reason: 'refused', detail: 'Doctor no longer passes.' });
    const path = await writeRunReport({ home, db, runId: 'run-2' });
    expect(readFileSync(path as string, 'utf8')).toContain('## Ready to merge (0)');
  });

  it('says so when there is no report yet', () => {
    const { home, db } = store();
    db.close();
    const out: string[] = [];
    expect(runReportCommand(home, 'cena', { out: (l) => out.push(l) })).toBe(0);
    expect(out).toEqual(['No run report yet for cena.']);
  });
});
