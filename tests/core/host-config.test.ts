import { describe, expect, it } from 'vitest';
import type { GitFileReader } from '../../src/core/framework/port.ts';
import {
  COUNTERPOINT_CONFIG_PATH,
  HostConfigError,
  parseHostConfig,
  readHostConfig,
} from '../../src/core/host/host-config.ts';

/** A reader over one commit's files, held in memory. */
function memoryReader(files: Record<string, Record<string, string>>): GitFileReader {
  return {
    resolve: async (ref) => (ref in files ? ref : null),
    list: async () => [],
    read: async (commit, path) => {
      const text = files[commit]?.[path];
      return text === undefined ? null : new TextEncoder().encode(text);
    },
  };
}

const CENA = `
gates:
  - name: lint
    command: [pnpm, lint]
  - name: unit
    command: [pnpm, vitest, run]
    timeout: 20m
    testLock: true
    ports: [54321]
    services: [supabase]
    testCount: 'Tests\\s+(\\d+) passed'
services:
  supabase:
    start: [supabase, start]
    reset: [supabase, db, reset]
    env:
      command: [supabase, status, -o, env]
      map:
        NEXT_PUBLIC_SUPABASE_URL: API_URL
        NEXT_PUBLIC_SUPABASE_ANON_KEY: PUBLISHABLE_KEY
      file: .env.local
attempts: 4
preview:
  command: [pnpm, dev, --port, '{port}']
  ports: [54321]
protected:
  - supabase/migrations/**
`;

describe('host config', () => {
  it('reads the config at the given commit, never another', async () => {
    const reader = memoryReader({
      base: { [COUNTERPOINT_CONFIG_PATH]: CENA },
      edited: { [COUNTERPOINT_CONFIG_PATH]: 'gates: []\n' },
    });
    const config = await readHostConfig(reader, 'base');
    expect(config.gates.map((gate) => gate.name)).toEqual(['lint', 'unit']);
    expect((await readHostConfig(reader, 'edited')).gates).toEqual([]);
  });

  it('parses gates with defaults and durations in milliseconds', async () => {
    const config = await readHostConfig(
      memoryReader({ c: { [COUNTERPOINT_CONFIG_PATH]: CENA } }),
      'c',
    );
    const [lint, unit] = config.gates;
    expect(lint).toEqual({
      name: 'lint',
      command: ['pnpm', 'lint'],
      timeout: 600_000,
      testLock: false,
      ports: [],
      services: [],
    });
    expect(unit?.timeout).toBe(1_200_000);
    expect(unit?.testLock).toBe(true);
    expect(unit?.testCount).toBe('Tests\\s+(\\d+) passed');
    expect(config.services.supabase?.timeout).toBe(300_000);
    expect(config.services.supabase?.env?.file).toBe('.env.local');
    expect(config.attempts).toBe(4);
    expect(config.preview?.command).toContain('{port}');
    expect(config.protected).toEqual(['supabase/migrations/**']);
  });

  it('defaults to no gates and three attempts without a config file', async () => {
    const config = await readHostConfig(memoryReader({ c: {} }), 'c');
    expect(config).toEqual({
      gates: [],
      services: {},
      attempts: 3,
      preview: null,
      protected: [],
      worktree: { clone: [] },
    });
  });

  it.each([
    ['an unknown top-level key', 'protcted: [src/**]\n', /protcted|Unrecognized/],
    ['an unknown gate key', 'gates:\n  - { name: a, command: [x], shell: true }\n', /gates\.0/],
    [
      'a shell string command',
      'gates:\n  - { name: a, command: pnpm test }\n',
      /gates\.0\.command/,
    ],
    ['a dash program', "gates:\n  - { name: a, command: ['-c', x] }\n", /dash/],
    [
      'a duplicate gate',
      'gates:\n  - { name: a, command: [x] }\n  - { name: a, command: [y] }\n',
      /Duplicate/,
    ],
    [
      'an unknown service',
      'gates:\n  - { name: a, command: [x], services: [db] }\n',
      /Unknown service db/,
    ],
    ['a bad duration', 'gates:\n  - { name: a, command: [x], timeout: 2d }\n', /timeout/],
    ['a too-long duration', 'gates:\n  - { name: a, command: [x], timeout: 7h }\n', /6 hours/],
    ['a bad port', 'gates:\n  - { name: a, command: [x], ports: [70000] }\n', /ports/],
    [
      'a count without a group',
      "gates:\n  - { name: a, command: [x], testCount: 'Tests \\d+' }\n",
      /capture group/,
    ],
    [
      'an invalid count pattern',
      "gates:\n  - { name: a, command: [x], testCount: '(' }\n",
      /regular expression/,
    ],
    ['an escaping protected path', 'protected: [../other/**]\n', /inside the repository/],
    ['an absolute protected path', 'protected: [/etc/**]\n', /inside the repository/],
    ['a preview without {port}', 'preview: { command: [pnpm, dev] }\n', /\{port\}/],
    ['zero attempts', 'attempts: 0\n', /attempts/],
    ['cloning .claude', 'worktree: { clone: [.claude] }\n', /worktree\.clone\.0/],
    ['cloning inside .git', 'worktree: { clone: [.git/hooks] }\n', /may be cloned/],
    ['a clone glob', "worktree: { clone: ['packages/*/node_modules'] }\n", /no globs/],
    ['an escaping clone', 'worktree: { clone: [../node_modules] }\n', /inside the repository/],
    ['a list at the top', '- a\n', /mapping/],
    ['duplicate keys', 'attempts: 2\nattempts: 3\n', /parsed/],
  ])('refuses %s, naming where', async (_label, yaml, message) => {
    const reader = memoryReader({ c: { [COUNTERPOINT_CONFIG_PATH]: yaml } });
    await expect(readHostConfig(reader, 'c')).rejects.toThrow(HostConfigError);
    await expect(readHostConfig(reader, 'c')).rejects.toThrow(message);
  });

  it('reads the folders to clone into new worktrees', () => {
    expect(
      parseHostConfig({ worktree: { clone: ['node_modules', 'apps/web/node_modules'] } }).worktree,
    ).toEqual({ clone: ['node_modules', 'apps/web/node_modules'] });
  });

  it('treats an empty document as no config', () => {
    expect(parseHostConfig(null).gates).toEqual([]);
  });
});
