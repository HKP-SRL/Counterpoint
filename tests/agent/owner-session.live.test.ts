// Live check that a builder session runs as the owner (owner-identity: Sessions run as the
// owner): the owner's real `claude`, their login-shell environment, auto mode with prompts denied,
// no sandbox. In a scratch worktree the session installs a package from the network and reads a
// token from a local port. Gated by COUNTERPOINT_LIVE=1 (a signed-in claude, a few cents of haiku).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ClaudeCliRunner } from '../../src/agent/runner.ts';
import { startBuilderSession } from '../../src/build/builder-session.ts';
import { readOwnerEnv } from '../../src/build/owner-env.ts';
import {
  commitAll,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
} from '../helpers/scratch.ts';

const LIVE = process.env.COUNTERPOINT_LIVE === '1';

afterAll(() => {
  if (LIVE) removeScratchDirs();
});

describe.skipIf(!LIVE)('a builder session as the owner (live claude)', () => {
  it(
    'installs a package and reaches a local port from its worktree',
    async () => {
      const worktree = makeScratchDir('cp-live-owner');
      await initScratchRepo(worktree);
      writeFileSync(join(worktree, 'package.json'), '{ "name": "scratch", "private": true }\n');
      await commitAll(worktree);

      const token = `cp-${Math.random().toString(36).slice(2, 10)}`;
      const server = createServer((_req, res) => res.end(token));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const owner = await readOwnerEnv();
        expect(owner.fallback).toBeNull();
        const session = await startBuilderSession({
          runner: new ClaudeCliRunner({ env: owner.env }),
          model: 'haiku',
          cwd: worktree,
          env: owner.env,
          rawLogPath: join(worktree, '..', 'owner-session.jsonl'),
          processTag: 'live-owner-0123456789',
          prompt: [
            'Do these two steps in this folder, then stop:',
            '1. Run `npm install is-odd@3.0.1 --no-audit --no-fund`.',
            `2. Run \`curl -s http://127.0.0.1:${port}/\` and write exactly what it prints to token.txt.`,
          ].join('\n'),
          windowTokens: 200_000,
          budgetPercent: 80,
          maxTurns: 20,
          maxBudgetUsd: 1,
          timeoutMs: 5 * 60 * 1000,
        });
        const result = await session.done;
        expect(result.outcome.kind).toBe('ok');
        expect(existsSync(join(worktree, 'node_modules', 'is-odd', 'package.json'))).toBe(true);
        expect(readFileSync(join(worktree, 'token.txt'), 'utf8').trim()).toBe(token);
      } finally {
        server.close();
      }
    },
    6 * 60 * 1000,
  );
});
