// A project's run settings in the store (build-runs: Run settings page).
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_HOST_SETTINGS,
  parseHostSettings,
  readHostSettings,
  writeHostSettings,
} from '../../src/build/host-settings.ts';
import { openStore, type Store, upsertHost } from '../../src/core/store/db.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(removeScratchDirs);

function store(): Store {
  const db = openStore(makeScratchDir('host-settings'));
  upsertHost(db, {
    id: 'cena',
    root: '/x/cena',
    gitCommonDir: '/x/cena/.git',
    baseBranch: 'master',
    adapter: 'openspec',
  });
  return db;
}

describe('host settings', () => {
  it('reads the defaults until the owner saves, then what was saved', () => {
    const db = store();
    expect(readHostSettings(db, 'cena')).toEqual({ settings: DEFAULT_HOST_SETTINGS, saved: false });
    const next = { ...DEFAULT_HOST_SETTINGS, effort: 'xhigh' as const, maxBudgetUsd: 20 };
    writeHostSettings(db, 'cena', next);
    expect(readHostSettings(db, 'cena')).toEqual({ settings: next, saved: true });
    writeHostSettings(db, 'cena', { ...next, model: 'sonnet' });
    expect(readHostSettings(db, 'cena').settings.model).toBe('sonnet');
    db.close();
  });

  it('completes a value saved before a field existed with the defaults', () => {
    const db = store();
    db.prepare('INSERT INTO host_settings (host_id, settings, updated_at) VALUES (?, ?, 0)').run(
      'cena',
      JSON.stringify({ model: 'haiku', effort: 'low', budgetPercent: 50 }),
    );
    expect(readHostSettings(db, 'cena')).toEqual({
      settings: { ...DEFAULT_HOST_SETTINGS, model: 'haiku', effort: 'low', budgetPercent: 50 },
      saved: true,
    });
    db.close();
  });

  it('reads a stored value that no longer validates as the defaults', () => {
    const db = store();
    db.prepare('INSERT INTO host_settings (host_id, settings, updated_at) VALUES (?, ?, 0)').run(
      'cena',
      '{"effort":"huge"',
    );
    expect(readHostSettings(db, 'cena')).toEqual({ settings: DEFAULT_HOST_SETTINGS, saved: false });
    db.close();
  });

  it.each([
    ['an unknown effort', { effort: 'huge' }, /effort/],
    ['a model that looks like a flag', { model: '-x' }, /model/],
    ['a budget above 90%', { budgetPercent: 95 }, /budgetPercent/],
    ['fractional turns', { maxTurns: 10.5 }, /maxTurns/],
    ['no sessions per attempt', { sessionsPerAttempt: 0 }, /sessionsPerAttempt/],
    ['an unknown key', { extra: true }, /Invalid settings/],
  ])('refuses %s', (_name, override, message) => {
    const parsed = parseHostSettings({ ...DEFAULT_HOST_SETTINGS, ...override });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(message);
  });
});
