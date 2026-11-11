// The gate sandbox (gates: Exit code is the only verdict; owner decision on spike 3.4: gates run
// under Claude Code's sandbox runtime, `@anthropic-ai/sandbox-runtime`, exact-pinned).
//
// Gate commands run builder-written code (tests import it), so they never run with the owner's
// full rights. Each gate runs as `srt --settings <profile> -- <command>` where the profile:
// - writes only the worktree and the gate's own temp dir, never the worktree's `.git` file or its
//   `.claude/` folder (the next builder session loads `.claude/` as project settings);
// - reads everything except the agent profile's protected directories (signing key, ~/.ssh, gh,
//   the Counterpoint home);
// - reaches only the loopback ports the gate lists, through srt's proxy. Never the console port.
//
// Live facts (srt 0.0.82, macOS, 2026-11-11): srt exports `NO_PROXY=localhost,127.0.0.1,...`, so a
// client that honours it connects to 127.0.0.1 directly and the OS sandbox refuses it (`EPERM`).
// The gate therefore runs through `env -u NO_PROXY -u no_proxy NODE_USE_ENV_PROXY=1`: Node's
// fetch then goes through the proxy, which lets `127.0.0.1:<listed port>` through and refuses any
// other port. Paths in the profile are absolute and realpath-resolved.
//
// Two more live facts (srt 0.0.82, 2026-11-11, task 9.1):
// - srt passes the command's exit code through, but when the command dies from a signal srt exits
//   0, which would read as a pass. The command therefore runs inside `/bin/sh -c 'code=0; "$@" ||
//   code=$?; exit "$code"'`: the shell survives its child's signal and exits 128+n.
// - srt sets `TMPDIR` to its own temp folder. A gate's own temp dir is set inside the sandbox, after
//   srt, through the same `env` call.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  buildAgentSandboxSettings,
  type ProtectedPaths,
  resolveAbsolute,
} from '../core/security/sandbox-settings.ts';

export interface GateSandboxSettings {
  network: { allowedDomains: string[]; deniedDomains: string[]; allowLocalBinding: false };
  filesystem: {
    denyRead: string[];
    allowRead: string[];
    allowWrite: string[];
    denyWrite: string[];
  };
  enableWeakerNestedSandbox: false;
  enableWeakerNetworkIsolation: false;
  allowAppleEvents: false;
}

export interface GateSandboxInput {
  protectedPaths: Omit<ProtectedPaths, 'workdir'>;
  /** The worktree the gate runs in (its cwd). */
  workdir: string;
  /** The gate's own temp dir. */
  tmpDir: string;
  /** Loopback ports the gate may reach. */
  ports: readonly number[];
  /** The console's port: never allowed, whatever the gate lists. */
  consolePort: number;
}

export function buildGateSandboxSettings(input: GateSandboxInput): GateSandboxSettings {
  for (const port of input.ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`Invalid gate port ${port}.`);
    }
    if (port === input.consolePort) {
      throw new Error(`A gate may not reach the console port (${port}).`);
    }
  }
  const agent = buildAgentSandboxSettings({ ...input.protectedPaths });
  const workdir = resolveAbsolute(input.workdir, 'workdir');
  const tmpDir = resolveAbsolute(input.tmpDir, 'tmpDir');
  return {
    network: {
      allowedDomains: [...new Set(input.ports)].map((port) => `127.0.0.1:${port}`),
      deniedDomains: [],
      allowLocalBinding: false,
    },
    filesystem: {
      denyRead: agent.readTargets.map((target) => target.path),
      allowRead: [],
      allowWrite: [workdir, tmpDir],
      denyWrite: [join(workdir, '.git'), join(workdir, '.claude'), agent.gitDir],
    },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
  };
}

/** The srt CLI script of the installed, pinned package. */
export function srtCliPath(): string {
  const require = createRequire(import.meta.url);
  return join(
    dirname(require.resolve('@anthropic-ai/sandbox-runtime/package.json')),
    'dist',
    'cli.js',
  );
}

/** Exits 128+n when the command dies from signal n (srt itself would exit 0). */
const SIGNAL_SAFE_WRAPPER = ['/bin/sh', '-c', 'code=0; "$@" || code=$?; exit "$code"', 'cp-gate'];
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The argv (program first) that runs `command` under srt with the profile at `settingsPath`.
 * `command` is an argument array; nothing in it is parsed by a shell (the wrapper passes it on as
 * `"$@"`). `env` is set inside the sandbox, after srt (for `TMPDIR`, which srt overrides).
 */
export function gateArgv(
  settingsPath: string,
  command: readonly string[],
  env: Readonly<Record<string, string>> = {},
): string[] {
  if (command.length === 0) throw new Error('Empty gate command.');
  const assignments = Object.entries(env).map(([name, value]) => {
    if (!ENV_NAME_RE.test(name) || value.includes('\0'))
      throw new Error(`Invalid variable ${name}.`);
    return `${name}=${value}`;
  });
  return [
    process.execPath,
    srtCliPath(),
    '--settings',
    settingsPath,
    '--',
    '/usr/bin/env',
    '-u',
    'NO_PROXY',
    '-u',
    'no_proxy',
    'NODE_USE_ENV_PROXY=1',
    ...assignments,
    ...SIGNAL_SAFE_WRAPPER,
    ...command,
  ];
}
