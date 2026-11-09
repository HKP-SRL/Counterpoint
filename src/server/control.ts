// The control-socket app, served only on the Unix socket `run/daemon.sock` (dir 0700, socket
// 0600). Every request must carry `Authorization: Bearer <token>` from the 0600 token file; the
// daemon holds only the token's SHA-256 and compares in constant time.
import { createHash, timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  BaseBranchNotFoundError,
  type FrameworkDetector,
  InvalidFrameworkIdError,
  NotARepositoryError,
  registerHost,
} from '../core/host/registry.ts';
import { mintLoginCode } from '../core/security/login.ts';
import { hostRegistryStore, listHosts, type Store } from '../core/store/db.ts';

export interface ControlAppOptions {
  store: Store;
  /** SHA-256 of the control token. */
  tokenHash: Buffer;
  /** The HTTP port the console is bound to. */
  port: number;
  /** Called after `POST /control/stop` has been answered. */
  onStop: () => void;
  detectFramework: FrameworkDetector;
  pid?: number;
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function bearerMatches(header: string | undefined, expected: Buffer): boolean {
  if (header === undefined) return false;
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{1,512})$/.exec(header);
  if (match?.[1] === undefined) return false;
  const presented = hashToken(match[1]);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

const RegisterBody = z.object({
  cwd: z.string().min(1).max(4096).refine(isAbsolute, 'cwd must be an absolute path'),
  base: z.string().min(1).max(200).optional(),
});

export function createControlApp(options: ControlAppOptions): Hono {
  const app = new Hono();
  const pid = options.pid ?? process.pid;

  app.use('*', async (c, next) => {
    if (!bearerMatches(c.req.header('authorization'), options.tokenHash)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  app.get('/control/status', (c) =>
    c.json({ running: true, pid, port: options.port, hosts: listHosts(options.store) }),
  );

  app.post('/control/hosts', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'The request body must be JSON.' }, 400);
    }
    const parsed = RegisterBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid host registration request.' }, 400);

    try {
      const host = await registerHost(hostRegistryStore(options.store), {
        cwd: parsed.data.cwd,
        ...(parsed.data.base === undefined ? {} : { base: parsed.data.base }),
        detectFramework: options.detectFramework,
      });
      return c.json({ host });
    } catch (error) {
      if (
        error instanceof NotARepositoryError ||
        error instanceof BaseBranchNotFoundError ||
        error instanceof InvalidFrameworkIdError
      ) {
        return c.json({ error: error.message }, 422);
      }
      throw error;
    }
  });

  // A fresh one-time sign-in link (D-07). Only the owner's CLI, holding the 0600 token, gets here;
  // the link is printed to the owner's terminal and never logged.
  app.post('/control/login-code', (c) => {
    const code = mintLoginCode(options.store);
    return c.json({ url: `http://127.0.0.1:${options.port}/login?code=${code}` });
  });

  app.post('/control/stop', (c) => {
    // Answer first; stop once the response has gone out.
    setImmediate(options.onStop);
    return c.json({ stopping: true }, 202);
  });

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  app.onError((_error, c) => c.json({ error: 'internal error' }, 500));

  return app;
}
