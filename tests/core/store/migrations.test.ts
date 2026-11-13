import { afterAll, describe, expect, it } from 'vitest';
import { openStore, STORE_VERSION, type Store, upsertHost } from '../../../src/core/store/db.ts';
import {
  getRunChange,
  insertRunChange,
  lastPushedHead,
  previousRunChange,
  updateRunChange,
} from '../../../src/core/store/runs.ts';
import { makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

function freshStore(): Store {
  const db = openStore(makeScratchDir('cp-store-'));
  upsertHost(db, {
    id: 'cena',
    root: '/x/cena',
    gitCommonDir: '/x/cena/.git',
    baseBranch: 'master',
    adapter: 'openspec',
  });
  return db;
}

function insertRun(db: Store, id: string, state = 'running'): void {
  const ended = state === 'ended';
  db.prepare(
    `INSERT INTO runs (id, host_id, state, settings, started_at, ended_at, end_reason)
     VALUES (?, 'cena', ?, '{}', 1, ?, ?)`,
  ).run(id, state, ended ? 2 : null, ended ? 'finished' : null);
}

describe('store migration 2 (build lane)', () => {
  it('reaches the latest schema version with the build-lane and settings tables', () => {
    const db = freshStore();
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(STORE_VERSION);
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    for (const name of [
      'runs',
      'run_changes',
      'agent_sessions',
      'gate_results',
      'model_windows',
      'governor',
      'host_settings',
      'approvals',
      'approval_carryover',
    ]) {
      expect(tables).toContain(name);
    }
    db.close();
  });

  it('allows one active run per machine', () => {
    const db = freshStore();
    insertRun(db, 'r1');
    expect(() => insertRun(db, 'r2')).toThrow(/UNIQUE/);
    db.prepare(
      "UPDATE runs SET state = 'ended', ended_at = 3, end_reason = 'stopped' WHERE id = 'r1'",
    ).run();
    insertRun(db, 'r2');
    insertRun(db, 'r0', 'ended');
    db.close();
  });

  it('keeps an ended run consistent with its end time and reason', () => {
    const db = freshStore();
    expect(() =>
      db
        .prepare(
          "INSERT INTO runs (id, host_id, state, settings, started_at) VALUES ('x', 'cena', 'ended', '{}', 1)",
        )
        .run(),
    ).toThrow(/CHECK/);
    db.close();
  });

  it('refuses a run for an unknown host', () => {
    const db = freshStore();
    expect(() =>
      db
        .prepare(
          "INSERT INTO runs (id, host_id, state, settings, started_at) VALUES ('x', 'nope', 'running', '{}', 1)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it('records gate results open while running and closed with a verdict', () => {
    const db = freshStore();
    insertRun(db, 'r1');
    const change = db
      .prepare(
        "INSERT INTO run_changes (run_id, change, position, state) VALUES ('r1', 'add-menu', 0, 'building')",
      )
      .run().lastInsertRowid;
    const insertGate = db.prepare(
      `INSERT INTO gate_results (run_change_id, attempt, gate, verdict, reason, process_tag, log_path, started_at, ended_at)
       VALUES (?, 1, ?, ?, ?, 'tag', '/log', 1, ?)`,
    );
    insertGate.run(change, 'unit', null, null, null);
    insertGate.run(change, 'lint', 'pass', null, 2);
    // A verdict without an end time, or a fail without a reason, is refused.
    expect(() => insertGate.run(change, 'e2e', 'pass', null, null)).toThrow(/CHECK/);
    expect(() => insertGate.run(change, 'types', 'fail', null, 2)).toThrow(/CHECK/);
    expect(() => insertGate.run(change, 'unit', 'pass', null, 2)).toThrow(/UNIQUE/);
    db.close();
  });

  it('needs a run change for builder sessions but not for calibration', () => {
    const db = freshStore();
    const insert = db.prepare(
      `INSERT INTO agent_sessions (host_id, kind, number, model, process_tag, raw_log_path, started_at)
       VALUES ('cena', ?, 1, 'haiku', 'tag', '/raw', 1)`,
    );
    insert.run('calibration');
    expect(() => insert.run('builder')).toThrow(/CHECK/);
    db.close();
  });

  it('has exactly one governor row', () => {
    const db = freshStore();
    expect(db.prepare('SELECT COUNT(*) AS n FROM governor').get()?.n).toBe(1);
    expect(() =>
      db.prepare("INSERT INTO governor (id, utilization, updated_at) VALUES (2, '{}', 0)").run(),
    ).toThrow(/CHECK/);
    db.close();
  });
});

describe('what a build leaves for the next one (migration 16)', () => {
  it("keeps each row's pushed head and last failing gate, and finds the change's previous build", () => {
    const db = freshStore();
    insertRun(db, 'r1', 'ended');
    const first = insertRunChange(db, { runId: 'r1', change: 'a-thing', position: 0 });
    insertRunChange(db, { runId: 'r1', change: 'b-thing', position: 1 });
    expect(lastPushedHead(db, 'cena', 'a-thing')).toBeNull();
    const failure = { gate: 'unit', attempt: 2, reason: 'exit code 1', tail: 'FAIL x' };
    updateRunChange(db, first, {
      branch: 'cp/a-thing',
      headCommit: 'a'.repeat(40),
      gateFailure: failure,
    });
    insertRun(db, 'r2');
    const second = insertRunChange(db, { runId: 'r2', change: 'a-thing', position: 0 });
    expect(getRunChange(db, first)).toMatchObject({
      headCommit: 'a'.repeat(40),
      gateFailure: failure,
    });
    expect(getRunChange(db, second)).toMatchObject({ headCommit: null, gateFailure: null });
    expect(lastPushedHead(db, 'cena', 'a-thing')).toBe('a'.repeat(40));
    expect(previousRunChange(db, 'cena', 'a-thing', second)?.id).toBe(first);
    // Only a build that got as far as a branch counts; nothing before the first.
    expect(previousRunChange(db, 'cena', 'b-thing', second)).toBeUndefined();
    expect(previousRunChange(db, 'cena', 'a-thing', first)).toBeUndefined();
    db.close();
  });
});
