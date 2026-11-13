// Fetching the base branch from the remote (host-planning: Fetching leaves the owner's checkout
// alone; When the base is fetched; A failed fetch never stops work; build-from-remote-base D-2,
// D-3, D-4, D-6).
//
// The fetch is one narrow call:
//   git fetch --no-tags --no-write-fetch-head --no-recurse-submodules <remote>
//       +refs/heads/<base>:refs/remotes/<remote>/<base>
// with automatic gc and maintenance off, through the clean git runner, with a 30-second limit. It
// writes objects and that one remote-tracking ref, nothing else: no local branch, no `HEAD`, no
// index, no working file, no `FETCH_HEAD`. It gets the push's credentials (remote.ts) for a
// GitHub remote; any other URL (a local path in tests) is fetched with none.
//
// The per-host fetcher runs one fetch per host at a time (a caller joins one in flight) and keeps,
// per host, when the base was last fetched, the latest fetch's error and how many commits on the
// local base branch are not on the remote. The daemon fetches every host every 60 seconds; a run
// fetches at its start and at each change's build start. In a run the fetch uses the run's
// environment; outside one, the owner's login environment, read on first need and replaced at
// each run start. A change in what the console shows is logged and announced once, never every
// failure.
import { baseRemote, localBaseRef, remoteBaseRef, resolveBase } from './base-ref.ts';
import { parseRemoteUrl, programOnPath, remoteCredentials } from './remote.ts';
import { GitError, runGit } from './run.ts';

export const FETCH_TIMEOUT_MS = 30_000;
export const FETCH_INTERVAL_MS = 60_000;
const MAX_ERROR_CHARS = 300;

export interface FetchBaseInput {
  repo: string;
  baseBranch: string;
  remote: string;
  /** The owner's environment: where `gh` and `ssh` are found, and the SSH agent socket. */
  env: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
}

/** Fetches the base branch into its remote-tracking ref. Throws with the reason when it fails. */
export async function fetchBaseBranch(input: FetchBaseInput): Promise<void> {
  const url = (await runGit(input.repo, ['remote', 'get-url', input.remote])).stdout.trim();
  const parsed = parseRemoteUrl(url);
  let credentials: { config: string[]; env: Record<string, string> } = {
    // Not a GitHub remote: no credentials, not even a helper the repository's config names.
    config: ['-c', 'credential.helper='],
    env: {},
  };
  if (parsed !== null) {
    const program = parsed.kind === 'https' ? 'gh' : 'ssh';
    const found = programOnPath(program, input.env.PATH ?? '');
    if (found === null) throw new Error(`${program} was not found on your PATH.`);
    credentials = remoteCredentials({
      kind: parsed.kind,
      gh: parsed.kind === 'https' ? found : '',
      ssh: parsed.kind === 'ssh' ? found : '',
      env: input.env,
    });
  }
  const target = remoteBaseRef(input.remote, input.baseBranch);
  const timeoutMs = input.timeoutMs ?? FETCH_TIMEOUT_MS;
  try {
    await runGit(
      input.repo,
      [
        ...credentials.config,
        '-c',
        'gc.auto=0',
        '-c',
        'maintenance.auto=false',
        '-c',
        'protocol.ext.allow=never',
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        '--no-recurse-submodules',
        input.remote,
        `+${localBaseRef(input.baseBranch)}:${target}`,
      ],
      { timeoutMs, env: credentials.env },
    );
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    throw new Error(fetchFailure(error, timeoutMs));
  }
}

/** Git's own reason, in one line: its first `fatal:` or `error:` line, else its last line. */
function fetchFailure(error: GitError, timeoutMs: number): string {
  if (error.exitCode === null) {
    return `it did not finish within ${Math.round(timeoutMs / 1000)} seconds`;
  }
  const line =
    error.stderrTail.find((l) => /^(fatal|error): /.test(l)) ?? error.stderrTail.at(-1) ?? '';
  const reason = line.replace(/^(fatal|error): /, '').trim();
  return reason === '' ? `git fetch exited with code ${error.exitCode}` : reason;
}

/** What the console shows about a host's base (D-6). */
export interface BaseFetchState {
  /** `origin/master`, or `master` when local only. */
  label: string;
  /** The remote, or null when the base branch has none. */
  remote: string | null;
  localOnly: boolean;
  /** When a fetch last succeeded (since Counterpoint started), or null. */
  fetchedAt: number | null;
  /** The latest fetch's error, or null when it succeeded. */
  error: string | null;
  /** When the latest fetch failed, while `error` is set. */
  failedAt: number | null;
  /** Commits on the local base branch that are not on the remote (never read or built). */
  localAhead: number;
}

export interface FetchHost {
  id: string;
  root: string;
  baseBranch: string;
}

export interface BaseFetcherOptions {
  /** The owner's login environment, read on first need outside a run. */
  ownerEnv: () => Promise<Record<string, string>>;
  now?: () => number;
  timeoutMs?: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Called when what the console shows changed (not on every fetch). */
  onChange?: (hostId: string, state: BaseFetchState) => void;
  /**
   * Called after each host's fetch in the minute loop (not at run or build starts), with the
   * owner's environment. A failure is logged and the loop goes on.
   */
  afterFetch?: (host: FetchHost, env: Readonly<Record<string, string>>) => Promise<void>;
  /** Seam for tests. */
  fetchBaseBranch?: typeof fetchBaseBranch;
}

/** A short, one-line reason from a failed fetch. */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.replace(/\s+/g, ' ').trim();
  return line.length > MAX_ERROR_CHARS ? `${line.slice(0, MAX_ERROR_CHARS - 1)}…` : line;
}

function shown(state: BaseFetchState): string {
  return JSON.stringify([state.label, state.localOnly, state.error, state.localAhead]);
}

export class BaseFetcher {
  readonly #o: BaseFetcherOptions;
  readonly #now: () => number;
  readonly #states = new Map<string, { key: string; state: BaseFetchState }>();
  readonly #inflight = new Map<string, Promise<BaseFetchState>>();
  #ownerEnv: Promise<Record<string, string>> | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  constructor(options: BaseFetcherOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
  }

  /** The host's base as last fetched, or null before its first fetch. */
  state(hostId: string): BaseFetchState | null {
    return this.#states.get(hostId)?.state ?? null;
  }

  /** Replaces the owner's environment used outside runs (a run read it again at its start). */
  setOwnerEnv(env: Record<string, string>): void {
    this.#ownerEnv = Promise.resolve(env);
  }

  /**
   * Fetches the host's base branch, or joins the fetch in flight. Never throws: a failure is in
   * the returned state's `error`. `env` is the run's environment; without it, the owner's.
   */
  fetch(host: FetchHost, env?: Readonly<Record<string, string>>): Promise<BaseFetchState> {
    const pending = this.#inflight.get(host.id);
    if (pending !== undefined) return pending;
    const next = this.#fetch(host, env).finally(() => this.#inflight.delete(host.id));
    this.#inflight.set(host.id, next);
    return next;
  }

  /** Fetches every host now and every `intervalMs` after, until stopped. */
  start(hosts: () => FetchHost[], intervalMs: number = FETCH_INTERVAL_MS): void {
    const loop = async () => {
      if (this.#stopped) return;
      let list: FetchHost[] = [];
      try {
        list = hosts();
      } catch (error) {
        this.#o.log?.('base-fetch-list-failed', { message: reasonOf(error) });
      }
      for (const host of list) {
        if (this.#stopped) return;
        await this.fetch(host);
        if (this.#o.afterFetch === undefined || this.#stopped) continue;
        try {
          await this.#o.afterFetch(host, await this.#envFor());
        } catch (error) {
          this.#o.log?.('base-fetch-after-failed', { hostId: host.id, message: reasonOf(error) });
        }
      }
      if (this.#stopped) return;
      this.#timer = setTimeout(() => void loop(), intervalMs);
      this.#timer.unref?.();
    };
    void loop();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
  }

  async #envFor(env?: Readonly<Record<string, string>>): Promise<Readonly<Record<string, string>>> {
    if (env !== undefined) return env;
    if (this.#ownerEnv === null) {
      const reading = this.#o.ownerEnv();
      this.#ownerEnv = reading;
      // A failed read is tried again at the next fetch.
      reading.catch(() => {
        if (this.#ownerEnv === reading) this.#ownerEnv = null;
      });
    }
    return this.#ownerEnv;
  }

  async #fetch(host: FetchHost, env?: Readonly<Record<string, string>>): Promise<BaseFetchState> {
    const previous = this.#states.get(host.id);
    let remote: string | null = null;
    let error: string | null = null;
    let fetched = false;
    try {
      remote = await baseRemote(host.root, host.baseBranch);
      if (remote !== null) {
        await (this.#o.fetchBaseBranch ?? fetchBaseBranch)({
          repo: host.root,
          baseBranch: host.baseBranch,
          remote,
          env: await this.#envFor(env),
          ...(this.#o.timeoutMs === undefined ? {} : { timeoutMs: this.#o.timeoutMs }),
        });
        fetched = true;
      }
    } catch (caught) {
      error = reasonOf(caught);
    }
    const at = this.#now();
    let label = previous?.state.label ?? host.baseBranch;
    let localOnly = previous?.state.localOnly ?? remote === null;
    let localAhead = previous?.state.localAhead ?? 0;
    try {
      const base = await resolveBase(host.root, host.baseBranch, remote);
      label = base.label;
      localOnly = base.localOnly;
      localAhead = base.localOnly ? 0 : await this.#localAhead(host, base.ref);
    } catch (caught) {
      error ??= reasonOf(caught);
    }
    const state: BaseFetchState = {
      label,
      remote,
      localOnly,
      fetchedAt: fetched ? at : (previous?.state.fetchedAt ?? null),
      error,
      failedAt: error === null ? null : at,
      localAhead,
    };
    const key = shown(state);
    this.#states.set(host.id, { key, state });
    if (previous?.key !== key && (previous !== undefined || error !== null || localAhead > 0)) {
      if (error !== null) {
        this.#o.log?.('base-fetch-failed', { hostId: host.id, base: label, message: error });
      } else if (previous?.state.error != null) {
        this.#o.log?.('base-fetch-recovered', { hostId: host.id, base: label });
      }
      try {
        this.#o.onChange?.(host.id, state);
      } catch {
        // a listener failure changes nothing here
      }
    }
    return state;
  }

  /** Commits on the local base branch that are not on `remoteRef`; 0 without a local branch. */
  async #localAhead(host: FetchHost, remoteRef: string): Promise<number> {
    const result = await runGit(
      host.root,
      ['rev-list', '--count', `${remoteRef}..${localBaseRef(host.baseBranch)}`, '--'],
      { allowExitCodes: [0, 128] },
    );
    const count = Number(result.stdout.trim());
    return result.exitCode === 0 && Number.isSafeInteger(count) ? count : 0;
  }
}
