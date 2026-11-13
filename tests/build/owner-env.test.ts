// The owner's environment, read from their login shell at each run start (owner-identity: The
// owner's login environment, read at each run start). A stand-in login shell sources a startup
// file under a scratch HOME, as zsh sources ~/.zshrc.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  parseEnvOutput,
  readOwnerEnv,
  SYSTEM_PATH,
  withoutCounterpoint,
} from '../../src/build/owner-env.ts';
import { missingServicePrograms } from '../../src/build/services.ts';
import { parseHostConfig } from '../../src/core/host/host-config.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

/** A scratch HOME with a login shell that sources `$HOME/.fakerc`, then runs its `-c` script. */
function fakeShell(rc: string, before = '') {
  const root = makeScratchDir('cp-owner-env');
  const home = join(root, 'home');
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(join(home, '.fakerc'), rc);
  const shell = join(root, 'fake-shell');
  writeFileSync(
    shell,
    `#!/bin/sh\n${before}[ -f "$HOME/.fakerc" ] && . "$HOME/.fakerc"\nshift 3\nexec /bin/sh -c "$1"\n`,
  );
  chmodSync(shell, 0o755);
  return { root, home, shell };
}

describe("the owner's login environment", () => {
  it('finds a tool the owner put on their PATH after Counterpoint started, with no restart', async () => {
    const { home, shell } = fakeShell('export PATH="$HOME/bin:$PATH"\nexport GH_TOKEN=gho_owner\n');
    const tool = join(home, 'bin', 'supabase');
    writeFileSync(tool, '#!/bin/sh\necho ok\n');
    chmodSync(tool, 0o755);
    // The daemon started before the install: its PATH has no ~/bin.
    const daemonEnv = { HOME: home, SHELL: shell, USER: 'owner', PATH: '/usr/bin:/bin' };
    const config = parseHostConfig({
      gates: [{ name: 'db', command: ['pnpm', 'test'], services: ['supabase'] }],
      services: { supabase: { start: ['supabase', 'start'] } },
    });
    expect(missingServicePrograms(config, daemonEnv)).toHaveLength(1);

    const owner = await readOwnerEnv({ daemonEnv });
    expect(owner.fallback).toBeNull();
    expect(owner.env.PATH).toBe(`${join(home, 'bin')}:${SYSTEM_PATH}`);
    // A token the owner exports in their shell is theirs to use, as in their own terminal.
    expect(owner.env.GH_TOKEN).toBe('gho_owner');
    expect(owner.env.USER).toBe('owner');
    expect(owner.env.TERM).toBe('dumb');
    expect(missingServicePrograms(config, owner.env)).toEqual([]);
  });

  it("leaves out Counterpoint's own variables and the probe shell's state", async () => {
    const { home, shell } = fakeShell(
      'export COUNTERPOINT_PORT=1\nexport CP_GATE_RUN=x\ncd /tmp\n',
    );
    const owner = await readOwnerEnv({
      daemonEnv: { HOME: home, SHELL: shell, COUNTERPOINT_HOME: '/cp', PATH: '/usr/bin:/bin' },
    });
    expect(owner.fallback).toBeNull();
    expect(Object.keys(owner.env).filter((name) => /^(COUNTERPOINT_|CP_)/.test(name))).toEqual([]);
    expect(owner.env.PWD).toBeUndefined();
    expect(owner.env.SHLVL).toBeUndefined();
  });

  it('ignores what a startup file prints before the environment', async () => {
    const { home, shell } = fakeShell('echo "Welcome back!"\nprintf "noise=1\\0"\nexport A=b\n');
    const owner = await readOwnerEnv({ daemonEnv: { HOME: home, SHELL: shell } });
    expect(owner.fallback).toBeNull();
    expect(owner.env.A).toBe('b');
    expect(owner.env.noise).toBeUndefined();
  });

  it("falls back to the daemon's environment when the login shell hangs, and says why", async () => {
    const { home, shell } = fakeShell('', 'sleep 30\n');
    const started = Date.now();
    const owner = await readOwnerEnv({
      daemonEnv: { HOME: home, SHELL: shell, PATH: '/daemon/bin', COUNTERPOINT_HOME: '/cp' },
      timeoutMs: 500,
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(owner.env).toEqual({ HOME: home, SHELL: shell, PATH: '/daemon/bin' });
    expect(owner.fallback).toMatch(/did not finish within 1 second\b/);
    expect(owner.fallback).toMatch(/environment Counterpoint was started with/);
  });

  it('falls back when the shell fails or there is no SHELL', async () => {
    const { home, shell } = fakeShell('exit 3\n');
    const failed = await readOwnerEnv({ daemonEnv: { HOME: home, SHELL: shell } });
    expect(failed.fallback).toMatch(/exited with code 3/);
    const none = await readOwnerEnv({ daemonEnv: { HOME: home } });
    expect(none.fallback).toMatch(/SHELL is not set/);
  });

  it('parses env -0 output and drops our own variables', () => {
    expect(parseEnvOutput('junk__COUNTERPOINT_ENV__\0A=1\0B=x=y\0bad name=2\0')).toEqual({
      A: '1',
      B: 'x=y',
    });
    expect(parseEnvOutput('')).toBeNull();
    expect(withoutCounterpoint({ A: '1', COUNTERPOINT_HOME: '/x', CP_AGENT_RUN: 't' })).toEqual({
      A: '1',
    });
  });
});
