// One-time sign-in codes, sessions and the GET /login exchange (D-07, FOUND-02).
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllSessions,
  consumeLoginCode,
  createSession,
  mintLoginCode,
  SESSION_COOKIE,
  validateSession,
} from '../../src/core/security/login.ts';
import { openStore, type Store, upsertHost } from '../../src/core/store/db.ts';
import { createApp } from '../../src/server/app.ts';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const PORT = 4999;
const HOST = `127.0.0.1:${PORT}`;
const NOW = 1_800_000_000_000;
const FIVE_MIN = 5 * 60 * 1000;
const TWELVE_H = 12 * 60 * 60 * 1000;
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const COOKIE_RE =
  /^cp_session=([A-Za-z0-9_-]{43}); HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200$/;

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

let db: Store;
let uiDir: string;

beforeEach(() => {
  db = openStore(makeScratchDir('login'));
  uiDir = makeScratchDir('ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');
});

afterAll(() => {
  removeScratchDirs();
});

function count(sql: string): number {
  const row = db.prepare(sql).get();
  return Number(row?.n ?? -1);
}

describe('login codes', () => {
  it('mints a 32-byte base64url code and stores only its sha256 with a 5-minute expiry', () => {
    const code = mintLoginCode(db, NOW);
    expect(code).toMatch(B64URL_32);
    const rows = db.prepare('SELECT code_hash, expires_at, used_at FROM login_codes').all();
    expect(rows).toEqual([{ code_hash: sha256(code), expires_at: NOW + FIVE_MIN, used_at: null }]);
  });

  it('mints a different code every time', () => {
    expect(mintLoginCode(db, NOW)).not.toBe(mintLoginCode(db, NOW));
  });

  it('consumes a fresh code exactly once', () => {
    const code = mintLoginCode(db, NOW);
    expect(consumeLoginCode(db, code, NOW + 1000)).toBe(true);
    expect(consumeLoginCode(db, code, NOW + 2000)).toBe(false);
  });

  it('refuses an expired code', () => {
    const code = mintLoginCode(db, NOW);
    expect(consumeLoginCode(db, code, NOW + FIVE_MIN)).toBe(false);
  });

  it.each([
    ['unknown', 'A'.repeat(43)],
    ['empty', ''],
    ['malformed', 'not a code'],
    ['not a string', 42],
    ['undefined', undefined],
  ])('refuses an %s code', (_label, value) => {
    mintLoginCode(db, NOW);
    expect(consumeLoginCode(db, value, NOW)).toBe(false);
  });

  it('lets exactly one of two concurrent consumes of one code succeed', async () => {
    const code = mintLoginCode(db, NOW);
    const results = await Promise.all([
      Promise.resolve().then(() => consumeLoginCode(db, code, NOW)),
      Promise.resolve().then(() => consumeLoginCode(db, code, NOW)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('sessions', () => {
  it('creates a random id whose sha256 is stored with a 12-hour expiry', () => {
    const id = createSession(db, NOW);
    expect(id).toMatch(B64URL_32);
    const rows = db.prepare('SELECT id_hash, created_at, expires_at FROM sessions').all();
    expect(rows).toEqual([{ id_hash: sha256(id), created_at: NOW, expires_at: NOW + TWELVE_H }]);
  });

  it('validates a live session', () => {
    const id = createSession(db, NOW);
    expect(validateSession(db, id, NOW + 1000)).toBe(true);
  });

  it('rejects an expired session', () => {
    const id = createSession(db, NOW);
    expect(validateSession(db, id, NOW + TWELVE_H)).toBe(false);
  });

  it('rejects unknown, tampered and malformed values', () => {
    const id = createSession(db, NOW);
    const tampered = `${id.slice(0, -1)}${id.endsWith('A') ? 'B' : 'A'}`;
    for (const value of ['B'.repeat(43), tampered, '', 'x', undefined, null, 7]) {
      expect(validateSession(db, value, NOW)).toBe(false);
    }
  });

  it('clearAllSessions signs every browser out', () => {
    const a = createSession(db, NOW);
    const b = createSession(db, NOW);
    clearAllSessions(db);
    expect(validateSession(db, a, NOW)).toBe(false);
    expect(validateSession(db, b, NOW)).toBe(false);
    expect(count('SELECT COUNT(*) AS n FROM sessions')).toBe(0);
  });

  it('names the cookie cp_session', () => {
    expect(SESSION_COOKIE).toBe('cp_session');
  });
});

describe('GET /login', () => {
  function app() {
    return createApp({ store: db, port: PORT, uiDir });
  }

  function get(path: string, method = 'GET') {
    return app().request(`http://${HOST}${path}`, { method, headers: { host: HOST } });
  }

  function addHost(id: string, now: number) {
    upsertHost(
      db,
      {
        id,
        root: `/repos/${id}`,
        gitCommonDir: `/repos/${id}/.git`,
        baseBranch: 'main',
        adapter: 'none',
      },
      now,
    );
  }

  it('exchanges a fresh code for the session cookie and redirects to the newest host', async () => {
    addHost('older', 1);
    addHost('cena', 2);
    const code = mintLoginCode(db);
    const res = await get(`/login?code=${code}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/h/cena');
    const cookie = res.headers.get('set-cookie') ?? '';
    const match = COOKIE_RE.exec(cookie);
    expect(match).not.toBeNull();
    expect(cookie).not.toMatch(/Secure/i);
    expect(validateSession(db, match?.[1])).toBe(true);
  });

  it('redirects to / when no host is registered', async () => {
    const res = await get(`/login?code=${mintLoginCode(db)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('sends a used code to /signed-out?reason=used without a cookie', async () => {
    const code = mintLoginCode(db);
    expect((await get(`/login?code=${code}`)).status).toBe(302);
    const again = await get(`/login?code=${code}`);
    expect(again.status).toBe(302);
    expect(again.headers.get('location')).toBe('/signed-out?reason=used');
    expect(again.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['missing', '/login'],
    ['unknown', `/login?code=${'C'.repeat(43)}`],
  ])('sends a %s code to /signed-out?reason=used', async (_label, path) => {
    const res = await get(path);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/signed-out?reason=used');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('sends an expired code to /signed-out?reason=used', async () => {
    const code = mintLoginCode(db, Date.now() - FIVE_MIN - 1);
    const res = await get(`/login?code=${code}`);
    expect(res.headers.get('location')).toBe('/signed-out?reason=used');
  });

  it('creates exactly one session for two concurrent requests with one code', async () => {
    addHost('cena', 1);
    const code = mintLoginCode(db);
    const responses = await Promise.all([get(`/login?code=${code}`), get(`/login?code=${code}`)]);
    const locations = responses.map((res) => res.headers.get('location')).sort();
    expect(locations).toEqual(['/h/cena', '/signed-out?reason=used']);
    expect(responses.filter((res) => res.headers.get('set-cookie') !== null)).toHaveLength(1);
    expect(count('SELECT COUNT(*) AS n FROM sessions')).toBe(1);
  });

  it('does not consume the code on a HEAD request', async () => {
    const code = mintLoginCode(db);
    const head = await get(`/login?code=${code}`, 'HEAD');
    expect(head.headers.get('set-cookie')).toBeNull();
    expect(consumeLoginCode(db, code)).toBe(true);
  });

  it('serves /signed-out as the console without a session', async () => {
    const res = await get('/signed-out?reason=used');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Counterpoint</title>');
  });
});
