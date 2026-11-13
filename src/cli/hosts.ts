// Which registered project a CLI command applies to, and printing untrusted text safely.
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertHostId, InvalidIdError } from '../core/ids.ts';
import {
  getHost,
  type HostRow,
  listHosts,
  openStoreReadOnly,
  stateDbPath,
} from '../core/store/db.ts';

const NO_PROJECT = 'No project registered yet. Run counterpoint inside it first.';

export type HostLookup = { ok: true; host: HostRow } | { ok: false; code: number; message: string };

/**
 * Makes untrusted text (repository values, file names, builder notes) safe to print: control
 * characters are escaped, so a value cannot move the cursor or hide lines.
 */
export function printable(text: string): string {
  let result = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const control =
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    if (!control) {
      result += ch;
    } else if (ch === '\n') {
      result += '\\n';
    } else if (ch === '\t') {
      result += '\\t';
    } else {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
    }
  }
  return result;
}

/** Looks a registered host up read-only. The id is validated before it touches anything. */
export function lookupHost(home: string, hostId: string): HostLookup {
  try {
    assertHostId(hostId);
  } catch (error) {
    if (error instanceof InvalidIdError) return { ok: false, code: 2, message: error.message };
    throw error;
  }
  if (statSync(stateDbPath(home), { throwIfNoEntry: false }) === undefined) {
    return { ok: false, code: 2, message: NO_PROJECT };
  }
  const store = openStoreReadOnly(home);
  try {
    const host = getHost(store, hostId);
    if (host !== undefined) return { ok: true, host };
    const ids = listHosts(store).map((h) => h.id);
    return {
      ok: false,
      code: 2,
      message:
        ids.length === 0
          ? NO_PROJECT
          : `No project "${hostId}" is registered. Registered: ${ids.join(', ')}.`,
    };
  } finally {
    store.close();
  }
}

function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/**
 * The host a command applies to: the explicit id (validated), else the registered host whose
 * root contains `cwd` (the deepest one), else the only registered host.
 */
export function resolveHostForCommand(
  home: string,
  explicitId: string | undefined,
  cwd: string,
  command = 'run',
): HostLookup {
  if (explicitId !== undefined) return lookupHost(home, explicitId);
  if (statSync(stateDbPath(home), { throwIfNoEntry: false }) === undefined) {
    return { ok: false, code: 2, message: NO_PROJECT };
  }
  const store = openStoreReadOnly(home);
  let hosts: HostRow[];
  try {
    hosts = listHosts(store);
  } finally {
    store.close();
  }
  if (hosts.length === 0) return { ok: false, code: 2, message: NO_PROJECT };
  let here = resolve(cwd);
  try {
    here = realpathSync(here);
  } catch {
    // keep the resolved path
  }
  const containing = hosts
    .filter((host) => isInside(here, host.root))
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (containing !== undefined) return { ok: true, host: containing };
  if (hosts.length === 1) return { ok: true, host: hosts[0] as HostRow };
  return {
    ok: false,
    code: 2,
    message: `Name the project: counterpoint ${command} <host>. Registered: ${hosts.map((h) => h.id).join(', ')}.`,
  };
}
