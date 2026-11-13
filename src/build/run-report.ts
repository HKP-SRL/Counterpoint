// The run report (run-report: Report at the end of every run). When a run ends for any reason,
// Counterpoint writes `runs/<run>/report.md` and records its path with the run; the console shows
// the same report (built from the store, so a preview found after the run is in it), and
// `counterpoint run report` prints the file.
//
// It answers the morning questions in order: why the run ended, what is ready to merge (with
// its preview), what must not be merged (planning edits), what parked and why (the last failing
// gate's lines), what was not built, which changes were built from an older base because the
// fetch at their build start failed, what waits on the owner, the decisions the builder assumed,
// and the flags. Builder-written text (assumptions) is shown as quoted plain text, never as HTML.
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ChangeFacts, type ChangeSnapshot, findChange } from '../core/framework/port.ts';
import { hostDir } from '../core/host/home.ts';
import { runNeedsYou } from '../core/runway/run-items.ts';
import { assumedAnswers, listRunChangeAskCards } from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import {
  type GateResultRow,
  getRun,
  listGateResults,
  listRunChanges,
  type RunChangeFlag,
  type RunChangeRow,
  type RunEndReason,
  type StoredTestShare,
  setRunReportPath,
} from '../core/store/runs.ts';
import { blocksMerge } from './branch-diff.ts';
import { defuse, gateWord, readSmallFile } from './deliver.ts';
import type { RunHost } from './orchestrator.ts';

export interface ReportFailure {
  gate: string;
  attempt: number;
  reason: string | null;
  exitCode: number | null;
  tail: string | null;
  logPath: string;
}

export interface ReportChange {
  change: string;
  title: string;
  state: RunChangeRow['state'];
  reason: string | null;
  branch: string | null;
  prUrl: string | null;
  previewUrl: string | null;
  attempts: number;
  /** The last failing gate, for a parked change. */
  lastFailure: ReportFailure | null;
  /** Every gate of the change's last attempt, with its outcome (skipped and not run included). */
  gates: Array<{ gate: string; attempt: number; verdict: string | null }>;
  /** How much of the built change is tests, against the budget. */
  testShare: StoredTestShare | null;
}

export interface RunReport {
  runId: string;
  hostId: string;
  startedAt: number;
  endedAt: number | null;
  endReason: RunEndReason | null;
  endDetail: string | null;
  settings: { model: string | null; effort: string | null; budgetPercent: number | null };
  /** Green, PR open, nothing keeps it from merging. */
  ready: ReportChange[];
  /** Green, but its branch edits planning files: a draft, not for merge. */
  notForMerge: ReportChange[];
  parked: ReportChange[];
  /** Queued, skipped or cut off when the run ended. */
  notBuilt: ReportChange[];
  /**
   * Changes built from the base as last fetched, because the fetch at their build start failed
   * (host-planning: A failed fetch never stops work).
   */
  olderBase: { change: string; base: string; fetchedAt: number | null; error: string }[];
  /** What the owner has to do: the run-stopping error's fix, `Owner:` steps of built changes. */
  waiting: string[];
  assumptions: { change: string; text: string }[];
  flags: { change: string; flags: RunChangeFlag[] }[];
}

/** The change's facts at its approved base (title, owner steps), or null when unreadable. */
export type FactsAt = (change: string, baseCommit: string | null) => Promise<ChangeFacts | null>;

/** Reads change facts through the host's adapter, one snapshot per base commit. */
export function factsFromRuntime(runtime: RunHost | null): FactsAt {
  const snapshots = new Map<string, Promise<ChangeSnapshot>>();
  return async (change, baseCommit) => {
    if (runtime === null || runtime.adapter === null || baseCommit === null) return null;
    let snapshot = snapshots.get(baseCommit);
    if (snapshot === undefined) {
      snapshot = runtime.adapter.snapshot(runtime.reader, baseCommit);
      snapshots.set(baseCommit, snapshot);
    }
    return findChange((await snapshot).changes, change) ?? null;
  };
}

/** The gates of the latest attempt, in the order they ran. */
function lastAttempt(gates: readonly GateResultRow[]): ReportChange['gates'] {
  const attempt = Math.max(0, ...gates.map((g) => g.attempt));
  return gates
    .filter((g) => g.attempt === attempt)
    .map((g) => ({ gate: g.gate, attempt: g.attempt, verdict: g.verdict }));
}

function lastFailure(gates: readonly GateResultRow[]): ReportFailure | null {
  const failed = gates.filter((g) => g.verdict === 'fail').at(-1);
  return failed === undefined
    ? null
    : {
        gate: failed.gate,
        attempt: failed.attempt,
        reason: failed.reason,
        exitCode: failed.exitCode,
        tail: failed.tail,
        logPath: failed.logPath,
      };
}

function setting<T>(settings: unknown, key: string, guard: (v: unknown) => v is T): T | null {
  const value = (settings as Record<string, unknown> | null)?.[key];
  return guard(value) ? value : null;
}
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number';

export function runDirFor(home: string, hostId: string, runId: string): string {
  return join(hostDir(home, hostId), 'runs', runId);
}

/** Builds the report of `runId` from the store, the run folder and the changes' facts. */
export async function buildRunReport(input: {
  home: string;
  db: Store;
  runId: string;
  factsAt?: FactsAt;
}): Promise<RunReport | null> {
  const run = getRun(input.db, input.runId);
  if (run === undefined) return null;
  const runDir = runDirFor(input.home, run.hostId, run.id);
  const report: RunReport = {
    runId: run.id,
    hostId: run.hostId,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    endReason: run.endReason,
    endDetail: run.endDetail,
    settings: {
      model: setting(run.settings, 'model', isString),
      effort: setting(run.settings, 'effort', isString),
      budgetPercent: setting(run.settings, 'budgetPercent', isNumber),
    },
    ready: [],
    notForMerge: [],
    parked: [],
    notBuilt: [],
    olderBase: [],
    waiting: [],
    assumptions: [],
    flags: [],
  };

  for (const row of listRunChanges(input.db, run.id)) {
    const facts = (await input.factsAt?.(row.change, row.baseCommit).catch(() => null)) ?? null;
    const gateRows = listGateResults(input.db, row.id);
    const entry: ReportChange = {
      change: row.change,
      title: facts?.title ?? row.change,
      state: row.state,
      reason: row.reason,
      branch: row.branch,
      prUrl: row.prUrl,
      previewUrl: row.previewUrl,
      attempts: row.attempts,
      lastFailure: row.state === 'parked' ? lastFailure(gateRows) : null,
      gates: lastAttempt(gateRows),
      testShare: row.testShare,
    };
    if (row.state === 'green') {
      (blocksMerge(row.flags) ? report.notForMerge : report.ready).push(entry);
      for (const step of facts?.tasks.ownerSteps ?? []) {
        report.waiting.push(`${row.change}: ${step}`);
      }
    } else if (row.state === 'parked') {
      report.parked.push(entry);
    } else {
      report.notBuilt.push(entry);
    }
    const fetch = row.baseFetch;
    if (fetch !== null && fetch.error !== null) {
      report.olderBase.push({
        change: row.change,
        base: fetch.base,
        fetchedAt: fetch.fetchedAt,
        error: fetch.error,
      });
    }
    const assumed = readSmallFile(join(runDir, row.change, 'assumptions.md'));
    const text = [assumed === null ? '' : defuse(assumed).trim(), unansweredText(input.db, row)]
      .filter((part) => part !== '')
      .join('\n\n');
    if (text !== '') report.assumptions.push({ change: row.change, text });
    if (row.flags.length > 0) report.flags.push({ change: row.change, flags: row.flags });
  }

  const latest = runNeedsYou(input.db, run.hostId).filter((item) => item.runId === run.id);
  for (const item of latest) {
    if (item.kind === 'run-stopped') report.waiting.unshift(item.action);
  }
  if (report.parked.length > 0) {
    report.waiting.push(
      `${report.parked.length === 1 ? '1 parked change' : `${report.parked.length} parked changes`}: see Needs You for every gate attempt.`,
    );
  }
  return report;
}

/**
 * The change's questions nobody answered in Needs You, built on the recommended option (D-6), or
 * '' when there are none.
 */
function unansweredText(db: Store, row: RunChangeRow): string {
  const assumed = assumedAnswers(listRunChangeAskCards(db, row.runId, row.change));
  if (assumed.length === 0) return '';
  return [
    'Questions you did not answer, built on the recommended option:',
    ...assumed.map((a) => `- ${line(defuse(a.question))} Assumed: ${line(defuse(a.answer))}`),
  ].join('\n');
}

const END_TEXT: Record<RunEndReason, string> = {
  finished: 'finished: every chosen change was built or parked',
  stopped: 'was stopped',
  'stop-time': 'reached its stop time',
  error: 'stopped on an error',
  refused: 'was refused',
};

function when(ms: number | null): string {
  return ms === null ? '-' : new Date(ms).toLocaleString('en-GB', { hour12: false });
}

function line(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => (l === '' ? '>' : `> ${l}`))
    .join('\n');
}

/** "Gates (attempt 2): types passed · related skipped · suite not run", or null without gates. */
export function gatesLine(c: Pick<ReportChange, 'gates'>): string | null {
  const first = c.gates[0];
  if (first === undefined) return null;
  const words = c.gates.map((g) => `${g.gate} ${gateWord(g.verdict).replace(/ \(.*\)$/, '')}`);
  return `Gates (attempt ${first.attempt}): ${words.join(' · ')}`;
}

/** "Tests: 44% of the change, budget 30% (over budget)", or null when not measured. */
export function testShareLine(c: Pick<ReportChange, 'testShare'>): string | null {
  const share = c.testShare;
  if (share === null) return null;
  const over = share.percent > share.budget;
  const edited = share.editedTests.length;
  return `Tests: ${share.percent}% of the change, budget ${share.budget}%${over ? ' (over budget)' : ''}${edited > 0 ? `; ${edited} existing test ${edited === 1 ? 'file' : 'files'} edited or deleted` : ''}`;
}

function changeLine(c: ReportChange): string {
  const parts = [`**${line(c.title)}** (\`${c.change}\`)`];
  if (c.prUrl !== null) parts.push(`PR ${c.prUrl}`);
  parts.push(c.previewUrl !== null ? `preview ${c.previewUrl}` : 'no preview');
  const extra = [gatesLine(c), testShareLine(c)].filter((l): l is string => l !== null);
  return [`- ${parts.join(' · ')}`, ...extra.map((l) => `  ${l}`)].join('\n');
}

/** The report as Markdown (the file, and what `counterpoint run report` prints). */
export function reportMarkdown(r: RunReport): string {
  const out: string[] = [];
  out.push(`# Run ${r.runId} on ${r.hostId}`, '');
  const ended = r.endReason === null ? 'is still going' : END_TEXT[r.endReason];
  out.push(`Started ${when(r.startedAt)}, ended ${when(r.endedAt)}: the run ${ended}.`);
  if (r.endDetail !== null) out.push('', line(r.endDetail));
  const s = r.settings;
  out.push(
    '',
    `Builder: ${[s.model, s.effort === null ? null : `${s.effort} effort`, s.budgetPercent === null ? null : `${s.budgetPercent}% context budget`].filter((p) => p !== null).join(', ')}.`,
    '',
  );

  out.push(`## Ready to merge (${r.ready.length})`, '');
  out.push(...(r.ready.length === 0 ? ['None.'] : r.ready.map(changeLine)), '');

  if (r.notForMerge.length > 0) {
    out.push(`## Not for merge (${r.notForMerge.length})`, '');
    out.push('Green, but the branch edits planning files: the PR stays a draft.', '');
    out.push(...r.notForMerge.map(changeLine), '');
  }

  out.push(`## Parked (${r.parked.length})`, '');
  if (r.parked.length === 0) out.push('None.', '');
  for (const c of r.parked) {
    out.push(`- **${line(c.title)}** (\`${c.change}\`): ${line(c.reason ?? 'parked')}`);
    const gates = gatesLine(c);
    if (gates !== null) out.push(`  ${gates}`);
    if (c.lastFailure !== null) {
      const f = c.lastFailure;
      out.push(
        `  Last failing gate: ${f.gate}, attempt ${f.attempt} (${f.reason ?? 'failed'}${f.exitCode === null ? '' : `, exit ${f.exitCode}`}). Log: ${f.logPath}`,
      );
      if (f.tail !== null && f.tail.trim() !== '') {
        const tail = f.tail.trim().split('\n').slice(-15).join('\n');
        out.push(
          '',
          '  ```text',
          ...tail.split('\n').map((l) => `  ${l.replaceAll('```', "'''")}`),
          '  ```',
        );
      }
    }
  }
  if (r.parked.length > 0) out.push('');

  if (r.notBuilt.length > 0) {
    out.push(`## Not built (${r.notBuilt.length})`, '');
    for (const c of r.notBuilt) {
      out.push(`- \`${c.change}\`: ${line(c.reason ?? c.state)}`);
    }
    out.push('');
  }

  if (r.olderBase.length > 0) {
    out.push(`## Built from an older base (${r.olderBase.length})`, '');
    out.push(
      'The fetch at their build start failed, so they were built from the base as last fetched.',
      '',
    );
    for (const c of r.olderBase) {
      const at = c.fetchedAt === null ? 'last fetched' : `fetched at ${when(c.fetchedAt)}`;
      out.push(
        `- \`${c.change}\`: built from ${c.base} as ${at}. The fetch failed: ${line(c.error)}`,
      );
    }
    out.push('');
  }

  out.push('## Waiting on you', '');
  out.push(...(r.waiting.length === 0 ? ['Nothing.'] : r.waiting.map((w) => `- ${line(w)}`)), '');

  out.push('## Assumed decisions', '');
  if (r.assumptions.length === 0) out.push('The builder recorded none.', '');
  for (const a of r.assumptions) out.push(`### ${a.change}`, '', quote(a.text), '');

  if (r.flags.length > 0) {
    out.push('## Flags', '');
    for (const { change, flags } of r.flags) {
      for (const flag of flags) {
        const f = flag as RunChangeFlag & { category?: string; status?: string };
        out.push(
          `- \`${change}\`: ${f.kind === 'protected-path' ? (f.category ?? 'protected path') : f.kind}${f.path === undefined ? '' : ` \`${f.path.replaceAll('`', "'")}\``}${f.status === undefined ? '' : ` (${f.status})`}`,
        );
      }
    }
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** Writes `runs/<run>/report.md` (atomically) and records its path with the run. */
export async function writeRunReport(input: {
  home: string;
  db: Store;
  runId: string;
  factsAt?: FactsAt;
}): Promise<string | null> {
  const report = await buildRunReport(input);
  if (report === null) return null;
  const dir = runDirFor(input.home, report.hostId, report.runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'report.md');
  const temp = join(dir, `.report-${process.pid}.tmp`);
  rmSync(temp, { force: true });
  writeFileSync(temp, reportMarkdown(report), { mode: 0o600, flag: 'wx' });
  renameSync(temp, path);
  setRunReportPath(input.db, report.runId, path);
  return path;
}
