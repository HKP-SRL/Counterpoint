// The draft server (design-drafts 2.4, D-5): a page with a script gets the script-free CSP and no
// cookie, a foreign Host is refused, a path outside the drafts folder is refused, and nothing can
// be written.
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DRAFT_CSP, type DraftServer, startDraftServer } from '../../src/drafts/server.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

let server: DraftServer;
let home: string;

beforeAll(async () => {
  home = makeScratchDir('cp-draft-server-');
  const dir = join(home, 'hosts', 'cena', 'drafts', 'quiet', 'home', 'r1', 'A', 'packed');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'page.html'), '<p>hi</p><script>alert(1)</script>');
  writeFileSync(join(home, 'hosts', 'cena', 'secret.html'), 'secret');
  symlinkSync(join(home, 'hosts', 'cena', 'secret.html'), join(dir, 'link.html'));
  server = await startDraftServer({ home });
});
afterAll(async () => {
  await server.close();
  removeScratchDirs();
});

function get(path: string, host = `127.0.0.1:${server.port}`, method = 'GET') {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: server.port, path, method, headers: { host } },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      );
      req.on('error', reject);
      req.end();
    },
  );
}

describe('draft server', () => {
  it('serves a page with the script-free CSP and no cookie', async () => {
    const res = await get('/h/cena/quiet/home/r1/A/packed/page.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe(DRAFT_CSP);
    expect(String(res.headers['content-security-policy'])).not.toContain('script-src');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('refuses a foreign Host', async () => {
    expect((await get('/h/cena/quiet/home/r1/A/packed/page.html', 'evil.example')).status).toBe(
      403,
    );
    expect(
      (await get('/h/cena/quiet/home/r1/A/packed/page.html', `127.0.0.1:${server.port + 1}`))
        .status,
    ).toBe(403);
  });

  it('refuses a path outside the drafts folder', async () => {
    expect((await get('/h/cena/../secret.html')).status).toBe(404);
    expect((await get('/h/cena/%2e%2e/secret.html')).status).toBe(404);
    expect((await get('/h/cena/quiet/home/r1/A/packed/link.html')).status).toBe(404);
    expect((await get('/h/cena/quiet/home/r1/A/packed/missing.html')).status).toBe(404);
    // A session's unpacked page is never served.
    writeFileSync(join(home, 'hosts', 'cena', 'drafts', 'quiet', 'raw.html'), '<script></script>');
    expect((await get('/h/cena/quiet/raw.html')).status).toBe(404);
  });

  it('is read-only', async () => {
    expect((await get('/h/cena/quiet/home/r1/A/packed/page.html', undefined, 'POST')).status).toBe(
      405,
    );
  });
});
