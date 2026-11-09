// The CLI side of the control socket: HTTP over `run/daemon.sock` with the bearer token read from
// the 0600 token file. The token never travels through argv or the environment.
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { homePaths } from '../core/host/home.ts';

const REQUEST_TIMEOUT_MS = 5_000;

export interface ControlResponse {
  status: number;
  body: unknown;
}

export interface DaemonStatus {
  running: true;
  pid: number;
  port: number;
  hosts: unknown[];
}

export class DaemonUnreachableError extends Error {
  constructor(reason: string) {
    super(`Counterpoint's daemon didn't answer (${reason}).`);
    this.name = 'DaemonUnreachableError';
  }
}

function readToken(home: string): string {
  const file = homePaths(home).token;
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    throw new DaemonUnreachableError('no control token');
  }
}

/** Sends one request to the daemon's control socket. */
export function controlRequest(
  home: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ControlResponse> {
  const { socket } = homePaths(home);
  if (!existsSync(socket)) return Promise.reject(new DaemonUnreachableError('no control socket'));
  const token = readToken(home);
  const payload = body === undefined ? undefined : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: socket,
        path,
        method,
        agent: false,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          authorization: `Bearer ${token}`,
          host: 'counterpoint.control',
          ...(payload === undefined
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = text;
          try {
            parsed = text === '' ? null : JSON.parse(text);
          } catch {
            // keep the raw text
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new DaemonUnreachableError('timed out')));
    req.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error instanceof DaemonUnreachableError
          ? error
          : new DaemonUnreachableError(error.code ?? error.message),
      );
    });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function isDaemonStatus(value: unknown): value is DaemonStatus {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.running === true && typeof v.pid === 'number' && typeof v.port === 'number';
}

/** The daemon's status when its control socket answers; `null` otherwise. */
export async function isDaemonRunning(home: string): Promise<DaemonStatus | null> {
  try {
    const res = await controlRequest(home, 'GET', '/control/status');
    return res.status === 200 && isDaemonStatus(res.body) ? res.body : null;
  } catch (error) {
    if (error instanceof DaemonUnreachableError) return null;
    throw error;
  }
}
