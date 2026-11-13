// The process-tag sweep (gates: Exit code is the only verdict; spike 3.3).
//
// Gates and agent sessions run in their own process group, and the group is killed on timeout,
// stop or crash recovery. A child that starts its own group (a detached spawn, as some dev tools
// do) survives that kill. Every gate and session therefore carries a random tag in its environment
// (`CP_GATE_RUN=<id>`, `CP_AGENT_RUN=<id>`), inherited by every descendant, and after the group
// kill the owner's processes are swept for that exact tag.
//
// `ps -E` prints each process's arguments followed by its environment, with nothing between them.
// So the sweep reads the list twice, with and without `-E`, and looks for the tag only in what
// `-E` added: a process that merely has the tag in its arguments (a grep for it) is never matched.
// A process that scrubs its own environment still escapes; the caller records what it found.
// Live finding (macOS, 2026-11-11): `ps -E` shows no environment for Apple platform binaries
// (`/bin/sleep`, `/bin/sh`), so a tagged system binary that left its group is not found either.
// The usual escapee, a Node dev server or test worker, is found.
import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';

const PS = '/bin/ps';
const PS_TIMEOUT_MS = 10_000;
const PS_MAX_BUFFER = 64 * 1024 * 1024;
const TAG_RE = /^[A-Za-z0-9_-]{8,128}$/;
const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const COMMAND_KEEP = 300;

export interface TaggedProcess {
  pid: number;
  /** The process's arguments, clipped. */
  command: string;
}

/** Runs `ps` for the current user: arguments only, or arguments plus environment. */
export type ProcessLister = (withEnv: boolean) => Promise<string>;

function runPs(withEnv: boolean): Promise<string> {
  const uid = String(userInfo().uid);
  const args = [...(withEnv ? ['-E'] : []), '-x', '-ww', '-U', uid, '-o', 'pid=,command='];
  return new Promise((resolve, reject) => {
    execFile(
      PS,
      args,
      { timeout: PS_TIMEOUT_MS, maxBuffer: PS_MAX_BUFFER, env: { PATH: '/usr/bin:/bin' } },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

function byPid(text: string): Map<number, string> {
  const lines = new Map<number, string>();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+) (.*)$/.exec(line);
    if (match) lines.set(Number(match[1]), match[2] ?? '');
  }
  return lines;
}

/**
 * The processes whose environment (not arguments) holds `name=tag`, from the two `ps` listings.
 * A process whose argument line differs between the listings (it changed in between) is judged on
 * the whole `-E` line, so a fast-changing process is never missed; the tag is random, so a match
 * there is still ours.
 */
export function taggedFromListings(
  argsOnly: string,
  withEnv: string,
  name: string,
  tag: string,
  exclude: ReadonlySet<number> = new Set(),
): TaggedProcess[] {
  if (!NAME_RE.test(name) || !TAG_RE.test(tag)) throw new Error('Invalid process tag.');
  const plain = byPid(argsOnly);
  const needle = new RegExp(`(^|\\s)${name}=${tag}(\\s|$)`);
  const found: TaggedProcess[] = [];
  for (const [pid, line] of byPid(withEnv)) {
    if (exclude.has(pid)) continue;
    const args = plain.get(pid);
    const envPart = args !== undefined && line.startsWith(args) ? line.slice(args.length) : line;
    if (!needle.test(envPart)) continue;
    found.push({ pid, command: (args ?? line).slice(0, COMMAND_KEEP) });
  }
  return found;
}

export async function findTagged(
  name: string,
  tag: string,
  lister: ProcessLister = runPs,
): Promise<TaggedProcess[]> {
  const argsOnly = await lister(false);
  const withEnv = await lister(true);
  return taggedFromListings(argsOnly, withEnv, name, tag, new Set([process.pid]));
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // ESRCH: already gone
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends every process tagged `name=tag`: SIGTERM, then SIGKILL after `graceMs` for those still
 * there. Returns what it found (the survivors of the group kill). A failing `ps` returns an empty
 * list with `error` set, so the caller can record that the sweep could not look.
 */
export async function sweepTagged(
  name: string,
  tag: string,
  options: { graceMs?: number; lister?: ProcessLister } = {},
): Promise<{ found: TaggedProcess[]; error: string | null }> {
  let found: TaggedProcess[];
  try {
    found = await findTagged(name, tag, options.lister);
  } catch (error) {
    return { found: [], error: (error as Error).message.split('\n')[0] ?? 'ps failed' };
  }
  for (const { pid } of found) signal(pid, 'SIGTERM');
  if (found.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, options.graceMs ?? 2000));
    for (const { pid } of found) if (alive(pid)) signal(pid, 'SIGKILL');
  }
  return { found, error: null };
}
