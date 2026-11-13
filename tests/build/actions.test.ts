// The action catalog and the run's cards (owner-inbox 2.3, 2.4): each action picked through the
// API as the owner would pick it, and replays of what stopped real runs, each ending in a card
// whose recommended option fixes it.
import { chmodSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionRunner } from '../../src/build/actions.ts';
import { raiseAskSetupCard, setUpInteractiveAsk } from '../../src/build/ask-session.ts';
import { builderPrompt } from '../../src/build/prompt.ts';
import { syncRunCards } from '../../src/build/run-cards.ts';
import { canRun, describeMissingPrograms } from '../../src/build/services.ts';
import { detectFramework } from '../../src/compose.ts';
import { registerHost } from '../../src/core/host/registry.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { askKeyPath, findAskGrant, isInteractiveKey } from '../../src/core/store/ask.ts';
import {
  type CardRow,
  listDoneForYou,
  listWaitingCards,
  waitingChangeNotes,
} from '../../src/core/store/cards.ts';
import { hostRegistryStore, openStore, type Store } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import {
  addRunNotice,
  endRun,
  insertRun,
  insertRunChange,
  listRunChanges,
  parkRunChange,
  updateRunChange,
} from '../../src/core/store/runs.ts';
import { createApp } from '../../src/server/app.ts';
import { CardDesk } from '../../src/server/cards.ts';
import { createHostRuntimes } from '../../src/server/hosts.ts';
import { materializeFixtureRepo } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const PORT = 4995;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;

let db: Store;
let desk: CardDesk;
let hostId = '';
let cookie = '';
let uiDir = '';
let runSeq = 0;
let ownerPath = '/usr/bin:/bin';
let ownerFallback: string | null = null;
let askHome = '';
let fakeBin = '';
const start = vi.fn(async (_hostId: string, _input: unknown) => ({
  ok: true as const,
  runId: 'run-new',
}));
const restart = vi.fn(async (when: string) => `Restarting ${when}.`);

function app() {
  return createApp({
    store: db,
    port: PORT,
    uiDir,
    bus: new EventBus(),
    runtimes: createHostRuntimes({ store: db }),
    cards: desk,
    syncCards: (id) => syncRunCards(desk, id),
  });
}

async function needsYou(): Promise<{ cards: Array<CardRow & { options: unknown[] }> }> {
  const response = await app().request(`http://${HOST}/api/hosts/${hostId}/needs-you`, {
    headers: { host: HOST, cookie },
  });
  return (await response.json()) as never;
}

async function answer(cardId: string, option: number, note?: string) {
  const response = await app().request(
    `http://${HOST}/api/hosts/${hostId}/cards/${cardId}/answer`,
    {
      method: 'POST',
      headers: { host: HOST, cookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(note === undefined ? { option } : { option, note }),
    },
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { card: CardRow }).card;
}

/** A run that ended now, with the given changes (state per change). */
function endedRun(
  end: { reason: 'error' | 'finished'; detail: string | null },
  changes: Record<string, 'queued' | 'parked' | 'stopped' | 'green'> = {},
): string {
  runSeq += 1;
  const id = `run-${runSeq}`;
  insertRun(db, { id, hostId, settings: {}, stopAt: null }, runSeq * 1000);
  Object.entries(changes).forEach(([change, state], position) => {
    insertRunChange(db, { runId: id, change, position });
    const row = listRunChanges(db, id).find((c) => c.change === change);
    if (state === 'parked') parkRunChange(db, row?.id ?? 0, 'Gate unit failed 3 times.');
    else if (state !== 'queued') updateRunChange(db, row?.id ?? 0, { state });
  });
  endRun(db, id, end, runSeq * 1000 + 500);
  return id;
}

const only = (cards: Array<{ kind: string }>, kind: string) => {
  const found = cards.filter((card) => card.kind === kind);
  expect(found).toHaveLength(1);
  return found[0] as CardRow;
};

beforeAll(async () => {
  const repo = await materializeFixtureRepo('synthetic');
  db = openStore(makeScratchDir('actions-home'));
  uiDir = makeScratchDir('actions-ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');
  hostId = (
    await registerHost(hostRegistryStore(db), { cwd: repo.root, base: 'master', detectFramework })
  ).id;
  desk = new CardDesk({ store: db, bus: new EventBus() });
  desk.setActionRunner(
    createActionRunner({
      db,
      desk,
      orchestrator: { start, running: () => null },
      ownerEnv: async () => ({ env: { PATH: ownerPath, HOME: '/h' }, fallback: ownerFallback }),
      restart,
      addAskTool: (card) =>
        setUpInteractiveAsk({
          db,
          desk,
          card,
          home: askHome,
          server: { command: '/usr/local/bin/node', args: ['/opt/cp/dist/cli.mjs', 'mcp', 'ask'] },
          env: { PATH: fakeBin, HOME: askHome },
        }),
    }),
  );
  askHome = makeScratchDir('ask-setup-home');
  // A fake claude that logs its arguments, one per line, each call ended by `---`.
  fakeBin = makeScratchDir('fake-claude-bin');
  writeFileIn(
    fakeBin,
    'claude',
    '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done >> "$HOME/claude.log"\necho --- >> "$HOME/claude.log"\n',
  );
  chmodSync(join(fakeBin, 'claude'), 0o755);
  const code = mintLoginCode(db);
  const login = await app().request(`http://${HOST}/login?code=${code}`, {
    headers: { host: HOST },
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

beforeEach(() => {
  start.mockClear();
  restart.mockClear();
  ownerPath = process.env.PATH ?? '';
  ownerFallback = null;
});

afterAll(() => {
  db?.close();
  removeScratchDirs();
});

describe('replays of what stopped runs', () => {
  it('a missing program: re-reading the environment finds it and resumes the unbuilt changes', async () => {
    const detail = describeMissingPrograms([{ service: 'db', program: 'supabase' } as never]);
    endedRun({ reason: 'error', detail }, { 'add-menu': 'stopped', 'add-cart': 'green' });
    const card = only((await needsYou()).cards, 'run-stopped');
    expect(card.question).toContain('supabase');
    expect(card.blocking).toBe(true);

    // Still missing: nothing starts, the card stays open to pick again.
    ownerPath = (process.env.PATH ?? '')
      .split(':')
      .filter((dir) => dir !== '' && !canRun('supabase', dir))
      .join(':');
    const first = await answer(card.id, card.recommended);
    expect(first.state).toBe('open');
    expect(first.outcome).toMatch(/Still not on your login shell's PATH: .*supabase/);
    expect(start).not.toHaveBeenCalled();

    // Installed now: the run resumes with the change it did not build.
    const bin = makeScratchDir('owner-bin');
    writeFileIn(bin, 'supabase', '#!/bin/sh\n');
    chmodSync(join(bin, 'supabase'), 0o755);
    // claude, git and gh are on the test machine's PATH.
    ownerPath = `${bin}:${process.env.PATH ?? ''}`;
    const fixed = await answer(card.id, card.recommended);
    expect(fixed).toMatchObject({ state: 'answered', outcome: 'Resumed: run run-new started.' });
    expect(start).toHaveBeenCalledWith(hostId, { changes: ['add-menu'], stopAt: null });
    expect(listDoneForYou(db, hostId)[0]?.text).toBe('Re-read your login environment.');
  });

  it('not logged in names the cause, not the context window it led to, and resumes', async () => {
    endedRun(
      {
        reason: 'error',
        detail:
          "The model's context window could not be learned: The calibration session for opus failed: Not logged in · Please run /login",
      },
      { 'add-menu': 'stopped' },
    );
    const card = only((await needsYou()).cards, 'run-stopped');
    expect(card.question).toMatch(/not logged in/i);
    expect(card.question).not.toMatch(/context window/i);
    expect(card.why).toContain('/login');
    const answered = await answer(card.id, card.recommended);
    expect(answered.outcome).toBe('Resumed: run run-new started.');
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('a login-shell timeout: re-reading the environment is offered and recorded', async () => {
    const id = endedRun({ reason: 'finished', detail: null });
    addRunNotice(
      db,
      id,
      "Your login shell's environment could not be read (it did not finish within 10 seconds), so this run used the environment Counterpoint was started with.",
    );
    const card = only((await needsYou()).cards, 'notice');
    expect(card.question).toMatch(/login shell/);
    const answered = await answer(card.id, card.recommended);
    expect(answered.outcome).toBe('Re-read your environment; the next run uses it.');
    expect(start).not.toHaveBeenCalled();
  });

  it("a parked change: retry with a note reaches the change's next session", async () => {
    endedRun({ reason: 'finished', detail: null }, { 'add-menu': 'parked' });
    const cards = (await needsYou()).cards;
    // The earlier runs' cards resolved themselves: a later run replaced them.
    expect(cards.map((card) => card.kind)).toEqual(['parked']);
    const card = cards[0] as CardRow;
    expect(card.question).toBe('add-menu parked. Retry it?');
    const answered = await answer(card.id, card.recommended, 'Use the seeded menu fixture.');
    expect(answered.outcome).toBe('Queued for the next run with your answer.');
    const notes = waitingChangeNotes(db, hostId, 'add-menu');
    expect(notes).toEqual([
      "This change parked in an earlier run: Gate unit failed 3 times.\nThe owner's note: Use the seeded menu fixture.",
    ]);
    const prompt = builderPrompt({
      changeId: 'add-menu',
      branch: 'cp/add-menu',
      instructions: 'Build it.',
      session: 1,
      handoff: null,
      gateFailure: null,
      doneTasks: [],
      gates: [],
      testBudget: 30,
      ownerNotes: notes,
    } as never);
    expect(prompt).toContain('Use the seeded menu fixture.');
  });

  it("a builder's ask-first question: the picked option goes to the change's next session", async () => {
    const id = endedRun({ reason: 'finished', detail: null }, { 'drop-table': 'parked' });
    const row = listRunChanges(db, id)[0];
    updateRunChange(db, row?.id ?? 0, {
      questions: [
        {
          task: '2.1 Migrate',
          text: 'Drop the orders_old table on the hosted database?',
          options: ['Drop it now', 'Leave it for you', 'Keep the old table'],
          recommended: 1,
          waiting: ['2.2'],
        },
      ],
    });
    const card = only((await needsYou()).cards, 'builder-question');
    expect(card).toMatchObject({ recommended: 1, reversible: false, blocking: true });
    await answer(card.id, 2);
    expect(waitingChangeNotes(db, hostId, 'drop-table')[0]).toContain(
      'The owner answered: Keep the old table.',
    );
  });
});

describe('actions picked through the API', () => {
  it('resume-run, set-git-identity and restart-into-install run as picked', async () => {
    const runId = endedRun({ reason: 'error', detail: 'Something odd.' }, { 'add-menu': 'queued' });
    const stopped = only((await needsYou()).cards, 'run-stopped');
    expect((await answer(stopped.id, 0)).outcome).toBe('Resumed: run run-new started.');
    expect(start).toHaveBeenCalledWith(hostId, { changes: ['add-menu'], stopAt: null });
    // "Leave the run stopped" runs nothing.
    endedRun({ reason: 'error', detail: 'Something odd again.' });
    const again = only((await needsYou()).cards, 'run-stopped');
    start.mockClear();
    await answer(again.id, 1);
    expect(start).not.toHaveBeenCalled();
    expect(runId).toBeTruthy();

    const home = makeScratchDir('git-home');
    const saved = { HOME: process.env.HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
    process.env.HOME = home;
    delete process.env.GIT_CONFIG_GLOBAL;
    try {
      const identity = desk.raise({
        hostId,
        kind: 'git-identity',
        source: 'machine',
        question: 'Sign commits as Ada Lovelace <ada@example.com>?',
        why: 'Previews deploy only commits from known accounts.',
        options: [
          {
            label: 'Use it',
            consequence: 'Your global git config gets this name and email.',
            action: { type: 'set-git-identity', name: 'Ada Lovelace', email: 'ada@example.com' },
          },
          { label: 'Not now', consequence: 'Commits keep Counterpoint’s identity.' },
        ],
        recommended: 0,
        reversible: true,
        blocking: false,
      });
      expect((await answer(identity.id, 0)).outcome).toBe(
        'Commits now carry Ada Lovelace <ada@example.com>.',
      );
      const config = readFileSync(join(home, '.gitconfig'), 'utf8');
      expect(config).toContain('name = Ada Lovelace');
      expect(config).toContain('email = ada@example.com');
    } finally {
      process.env.HOME = saved.HOME;
      if (saved.GIT_CONFIG_GLOBAL !== undefined)
        process.env.GIT_CONFIG_GLOBAL = saved.GIT_CONFIG_GLOBAL;
    }

    const restartCard = desk.raise({
      hostId: null,
      kind: 'restart',
      source: 'machine',
      question: 'A new Counterpoint is installed. Restart into it?',
      why: 'A run is going.',
      options: [
        {
          label: 'Restart after this run',
          consequence: 'The run finishes first.',
          action: { type: 'restart-into-install', when: 'after-run' },
        },
        {
          label: 'Restart now',
          consequence: 'The run stops at its next clean point.',
          action: { type: 'restart-into-install', when: 'now' },
        },
      ],
      recommended: 0,
      reversible: true,
      blocking: false,
    });
    expect((await answer(restartCard.id, 0)).outcome).toBe('Restarting after-run.');
    expect(restart).toHaveBeenCalledWith('after-run');
    expect(listWaitingCards(db, hostId).map((card) => card.id)).not.toContain(restartCard.id);
  });
});

describe('the ask tool for interactive sessions (owner-inbox 3.3)', () => {
  it('a one-time setup card writes the setup key and the user-scope MCP entry', async () => {
    raiseAskSetupCard(desk, askHome);
    const setup = only((await needsYou()).cards, 'setup');
    expect((await answer(setup.id, 0)).outcome).toBe(
      'Set up. New Claude Code sessions ask you here.',
    );

    const keyFile = askKeyPath(askHome);
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    const grant = findAskGrant(db, readFileSync(keyFile, 'utf8').trim());
    expect(grant !== undefined && isInteractiveKey(grant)).toBe(true);

    const calls = readFileSync(join(askHome, 'claude.log'), 'utf8')
      .split('---\n')
      .filter((call) => call !== '')
      .map((call) => call.trimEnd().split('\n'));
    expect(calls[0]).toEqual(['mcp', 'remove', '--scope', 'user', 'counterpoint']);
    expect(calls[1]?.slice(0, 5)).toEqual(['mcp', 'add-json', '--scope', 'user', 'counterpoint']);
    expect(JSON.parse(calls[1]?.[5] ?? '')).toEqual({
      type: 'stdio',
      command: '/usr/local/bin/node',
      args: ['/opt/cp/dist/cli.mjs', 'mcp', 'ask'],
      env: { COUNTERPOINT_HOME: askHome },
    });

    // Once set up, it is not asked again.
    raiseAskSetupCard(desk, askHome);
    expect((await needsYou()).cards.filter((card) => card.kind === 'setup')).toHaveLength(0);
  });
});
