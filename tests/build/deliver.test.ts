// Delivery of a green change (pull-requests: One PR per change; Generated PR body): the push with
// the owner's credentials for that one call, the generated body, and gh driven from outside the
// repository.
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createDeliver,
  DeliveryError,
  defuse,
  ghEnv,
  openPullRequest,
  type PrBodyInput,
  parseRemoteUrl,
  prBody,
  pushBranch,
  pushCredentials,
  pushTarget,
} from '../../src/build/deliver.ts';
import { blocksMerge } from '../../src/build/protected-paths.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import type { ChangeFacts } from '../../src/core/framework/port.ts';
import { runGit } from '../../src/core/git/run.ts';
import { EMPTY_HOST_CONFIG } from '../../src/core/host/host-config.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { insertRun, insertRunChange } from '../../src/core/store/runs.ts';
import { materializeOpenSpecHost } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

afterAll(removeScratchDirs);

describe('parseRemoteUrl', () => {
  it.each([
    ['git@github.com:alex/Cena.git', 'ssh', 'github.com', 'alex', 'Cena'],
    ['ssh://git@github.com/alex/Cena', 'ssh', 'github.com', 'alex', 'Cena'],
    ['https://github.com/alex/Cena.git', 'https', 'github.com', 'alex', 'Cena'],
    ['https://me@git.example.com/team/app/', 'https', 'git.example.com', 'team', 'app'],
  ])('reads %s', (url, kind, host, owner, repo) => {
    expect(parseRemoteUrl(url)).toEqual({ kind, slug: { host, owner, repo } });
  });

  it.each([
    ['a local path', '/srv/git/app.git'],
    ['a file URL', 'file:///srv/git/app.git'],
    ['git://', 'git://github.com/alex/Cena.git'],
    ['plain http', 'http://github.com/alex/Cena.git'],
    ['a deeper path', 'https://github.com/alex/Cena/extra'],
    ['a query', 'https://github.com/alex/Cena?x=1'],
    ['an option-like owner', 'git@github.com:-oProxyCommand/x'],
  ])('refuses %s', (_name, url) => {
    expect(parseRemoteUrl(url)).toBeNull();
  });
});

describe('push credentials', () => {
  it('gives an https push gh as its only credential helper', () => {
    const { config, env } = pushCredentials({
      kind: 'https',
      gh: '/opt/bin/gh',
      ssh: '',
      env: { SSH_AUTH_SOCK: '/tmp/agent.sock' },
    });
    expect(config).toEqual([
      '-c',
      'credential.helper=',
      '-c',
      "credential.helper=!'/opt/bin/gh' auth git-credential",
      '-c',
      'credential.useHttpPath=false',
    ]);
    expect(env).toEqual({});
  });

  it('gives an ssh push the agent socket and a batch-mode ssh, nothing else', () => {
    const { config, env } = pushCredentials({
      kind: 'ssh',
      gh: '',
      ssh: '/usr/bin/ssh',
      env: { SSH_AUTH_SOCK: '/tmp/agent.sock', GH_TOKEN: 'secret' },
    });
    expect(config).toEqual([]);
    expect(env).toEqual({
      GIT_SSH_COMMAND: "'/usr/bin/ssh' -o BatchMode=yes",
      SSH_AUTH_SOCK: '/tmp/agent.sock',
    });
  });

  it('runs gh with its config and keychain only, never a prompt', () => {
    const env = ghEnv({ PATH: '/bin', HOME: '/Users/o', GH_TOKEN: 'x', SSH_AUTH_SOCK: '/s' });
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/Users/o',
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
      GH_SPINNER_DISABLED: '1',
      NO_COLOR: '1',
    });
  });
});

async function hostWithRemote(url?: string, before?: (root: string, bare: string) => void) {
  const repo = await materializeOpenSpecHost({ 'src/app.ts': 'export {}\n' }, { label: 'deliver' });
  const bare = makeScratchDir('deliver-bare');
  await runGit(bare, ['init', '--bare', '--quiet']);
  await runGit(repo.root, ['remote', 'add', 'origin', url ?? bare]);
  await runGit(repo.root, ['branch', 'cp/a-thing', repo.commit]);
  before?.(repo.root, bare);
  const home = makeScratchDir('deliver-home');
  const host = {
    id: 'cena',
    root: repo.root,
    gitCommonDir: join(repo.root, '.git'),
    baseBranch: 'master',
  };
  writeBaseline(
    home,
    'cena',
    await snapshotIntegrity(host.gitCommonDir, {
      project: { root: repo.root, baseBranch: 'master' },
    }),
  );
  return { repo, bare, home, host };
}

describe('pushTarget', () => {
  it("names the base branch's remote and its GitHub repository", async () => {
    const { host } = await hostWithRemote('git@github.com:alex/Cena.git');
    await expect(pushTarget(host.root, 'master')).resolves.toEqual({
      remote: 'origin',
      url: 'git@github.com:alex/Cena.git',
      kind: 'ssh',
      slug: { host: 'github.com', owner: 'alex', repo: 'Cena' },
    });
  });

  it('refuses a remote that is not GitHub over https or ssh', async () => {
    const { host } = await hostWithRemote();
    await expect(pushTarget(host.root, 'master')).rejects.toThrow(DeliveryError);
  });
});

describe('pushBranch', () => {
  // A local bare remote stands in for GitHub: the transport differs, the git call is the same.
  const target = (bare: string) => ({
    remote: 'origin',
    url: bare,
    kind: 'ssh' as const,
    slug: { host: 'github.com', owner: 'alex', repo: 'Cena' },
  });

  it('pushes the branch with hooks off', async () => {
    // The hook is part of the baseline (the owner accepted it), and still never runs.
    const { repo, bare, home, host } = await hostWithRemote(undefined, (root, remote) => {
      const hook = writeFileIn(
        root,
        '.git/hooks/pre-push',
        `#!/bin/sh\ntouch "${remote}/HOOK-RAN"\n`,
      );
      chmodSync(hook, 0o755);
    });
    await pushBranch({
      home,
      host,
      branch: 'cp/a-thing',
      target: target(bare),
      ssh: '/usr/bin/ssh',
    });
    const pushed = await runGit(bare, ['rev-parse', 'refs/heads/cp/a-thing']);
    expect(pushed.stdout.trim()).toBe(repo.commit);
    expect(existsSync(join(bare, 'HOOK-RAN'))).toBe(false);
  });

  it("refuses a branch that is not Counterpoint's", async () => {
    const { bare, home, host } = await hostWithRemote();
    await expect(
      pushBranch({ home, host, branch: 'master', target: target(bare), ssh: '/usr/bin/ssh' }),
    ).rejects.toThrow(/not a Counterpoint branch/);
  });

  it('pushes nothing when the git config changed since the baseline', async () => {
    const { repo, bare, home, host } = await hostWithRemote();
    await runGit(repo.root, [
      'config',
      'remote.origin.receivepack',
      'touch /tmp/x; git-receive-pack',
    ]);
    await expect(
      pushBranch({ home, host, branch: 'cp/a-thing', target: target(bare), ssh: '/usr/bin/ssh' }),
    ).rejects.toThrow(/changed since your baseline/);
    const ref = await runGit(bare, ['rev-parse', '--verify', '--quiet', 'refs/heads/cp/a-thing'], {
      allowExitCodes: [0, 1],
    });
    expect(ref.exitCode).toBe(1);
  });
});

const facts = (over: Partial<ChangeFacts> = {}): ChangeFacts =>
  ({
    id: 'a-thing',
    dir: 'openspec/changes/a-thing',
    archived: false,
    archivedOn: null,
    title: 'A thing',
    why: 'Diners need it.',
    created: null,
    dependsOn: [],
    artifacts: {},
    tasks: { total: 2, done: 0, ownerSteps: [] },
    unreadable: null,
    ...over,
  }) as ChangeFacts;

const bodyInput = (over: Partial<PrBodyInput> = {}): PrBodyInput => ({
  change: facts(),
  runId: 'run-1',
  baseCommit: 'a'.repeat(40),
  branch: 'cp/a-thing',
  taskList: '- [x] 1.1 Do it\n- [ ] 1.2 Owner: check it\n',
  ticked: ['1.1 Do it'],
  assumptions: '<!-- session 1 -->\n- Chose euros, ping @alex if wrong.',
  flags: [],
  gates: [
    { gate: 'unit', attempt: 1, verdict: 'fail', durationMs: 4000 },
    { gate: 'unit', attempt: 2, verdict: 'pass', durationMs: 5000 },
    { gate: 'lint', attempt: 2, verdict: 'pass', durationMs: 1200 },
  ],
  sessions: 3,
  preview: { kind: 'url', url: 'https://cena-abc.vercel.app/' },
  ...over,
});

describe('prBody', () => {
  it('carries the why, the ticks, the assumed decisions, the gates and the run', () => {
    const body = prBody(bodyInput());
    expect(body).toContain('Diners need it.');
    expect(body).toContain('This build ticked 1 task:\n- [x] 1.1 Do it');
    expect(body).toContain('<summary>The whole task list</summary>');
    expect(body).toContain('> - Chose euros, ping @​alex if wrong.');
    expect(body).not.toContain('<!-- session');
    expect(body).toContain('Every gate passed on attempt 2.');
    expect(body).toContain('| unit | pass | 5 s |');
    expect(body).toContain('| lint | pass | 1 s |');
    expect(body).toContain('run `run-1`, 3 builder sessions, from `aaaaaaaaaaaa` on `cp/a-thing`');
    expect(body).not.toContain('[!WARNING]');
  });

  it('puts the preview first, and says why when there is none', () => {
    expect(prBody(bodyInput()).startsWith('**Preview:** https://cena-abc.vercel.app/')).toBe(true);
    expect(prBody(bodyInput({ preview: { kind: 'deploy-pending' } }))).toContain(
      "the host's deploy is building",
    );
    expect(
      prBody(
        bodyInput({
          preview: { kind: 'deploy-missing', reason: "The host's preview deploy failed." },
        }),
      ),
    ).toContain("**Preview:** none. The host's preview deploy failed.");
    expect(prBody(bodyInput({ preview: { kind: 'none' } }))).toContain('names no preview command');
  });

  it('says so when the builder assumed nothing', () => {
    expect(prBody(bodyInput({ assumptions: null }))).toContain('The builder recorded none.');
  });

  it('lists flags and warns when the branch edits planning files', () => {
    const flags = [
      {
        kind: 'protected-path',
        path: 'openspec/changes/a-thing/proposal.md',
        category: 'planning',
        status: 'modified',
      },
      { kind: 'protected-path', path: 'src/a.test.ts', category: 'test', status: 'modified' },
    ];
    expect(blocksMerge(flags)).toBe(true);
    const body = prBody(bodyInput({ flags }));
    expect(body.startsWith('> [!WARNING]')).toBe(true);
    expect(body).toContain('**Preview:**');
    expect(body).toContain('- **planning** `openspec/changes/a-thing/proposal.md` (modified)');
    expect(body).toContain('- **test** `src/a.test.ts` (modified)');
  });

  it('stays under the size GitHub accepts', () => {
    const body = prBody(bodyInput({ assumptions: 'x'.repeat(100_000) }));
    expect(body.length).toBeLessThan(65_536);
  });

  it('defuses mentions but keeps emails and code', () => {
    expect(defuse('ask @team, mail a@b.c, run `@scope/pkg`')).toBe(
      'ask @​team, mail a@b.c, run `@scope/pkg`',
    );
  });
});

describe('openPullRequest', () => {
  const slug = { host: 'github.com', owner: 'alex', repo: 'Cena' };

  function fakeGh(answers: Array<{ exitCode?: number; stdout?: string; stderr?: string }>) {
    const calls: Array<{ args: readonly string[]; cwd: string }> = [];
    const gh = async (args: readonly string[], options: { cwd: string }) => {
      calls.push({ args, cwd: options.cwd });
      const answer = answers.shift() ?? {};
      return {
        exitCode: answer.exitCode ?? 0,
        stdout: answer.stdout ?? '',
        stderr: answer.stderr ?? '',
      };
    };
    return { gh, calls };
  }

  const input = (gh: Parameters<typeof openPullRequest>[0]['gh'], draft = false) => ({
    gh,
    cwd: '/runs/r1/a-thing',
    slug,
    branch: 'cp/a-thing',
    base: 'master',
    title: 'A thing',
    bodyPath: '/runs/r1/a-thing/pr-body.md',
    draft,
  });

  it('opens a PR from outside the repository and returns its URL', async () => {
    const { gh, calls } = fakeGh([
      { stdout: '[]' },
      { stdout: 'Creating pull request…\nhttps://github.com/alex/Cena/pull/12\n' },
    ]);
    await expect(openPullRequest(input(gh))).resolves.toBe('https://github.com/alex/Cena/pull/12');
    expect(calls.map((c) => c.cwd)).toEqual(['/runs/r1/a-thing', '/runs/r1/a-thing']);
    expect(calls[1]?.args).toEqual([
      'pr',
      'create',
      '--repo',
      'alex/Cena',
      '--head',
      'cp/a-thing',
      '--base',
      'master',
      '--title',
      'A thing',
      '--body-file',
      '/runs/r1/a-thing/pr-body.md',
    ]);
  });

  it('opens a draft when the branch edits planning files', async () => {
    const { gh, calls } = fakeGh([
      { stdout: '[]' },
      { stdout: 'https://github.com/alex/Cena/pull/3' },
    ]);
    await openPullRequest(input(gh, true));
    expect(calls[1]?.args.at(-1)).toBe('--draft');
  });

  it('updates the open PR of a change built again instead of opening a second one', async () => {
    const { gh, calls } = fakeGh([
      { stdout: '[{"url":"https://github.com/alex/Cena/pull/7"}]' },
      {},
    ]);
    await expect(openPullRequest(input(gh))).resolves.toBe('https://github.com/alex/Cena/pull/7');
    expect(calls[1]?.args.slice(0, 3)).toEqual([
      'pr',
      'edit',
      'https://github.com/alex/Cena/pull/7',
    ]);
    // A draft held back while the change was unfinished is marked ready now that it is whole.
    expect(calls[2]?.args).toEqual([
      'pr',
      'ready',
      'https://github.com/alex/Cena/pull/7',
      '--repo',
      'alex/Cena',
    ]);
    expect(calls).toHaveLength(3);
  });

  it('puts the open PR back to draft when the branch now edits planning files', async () => {
    const { gh, calls } = fakeGh([
      { stdout: '[{"url":"https://github.com/alex/Cena/pull/7"}]' },
      {},
      { exitCode: 1, stderr: 'already a draft' },
    ]);
    await expect(openPullRequest(input(gh, true))).resolves.toBe(
      'https://github.com/alex/Cena/pull/7',
    );
    expect(calls[2]?.args.at(-1)).toBe('--undo');
  });

  it("fails with gh's last line, and without a URL", async () => {
    const failing = fakeGh([
      { stdout: '[]' },
      { exitCode: 1, stderr: 'GraphQL: No commits between master and cp/a-thing\n' },
    ]);
    await expect(openPullRequest(input(failing.gh))).rejects.toThrow(
      /Opening the PR failed \(exit 1\): GraphQL: No commits/,
    );
    const silent = fakeGh([{ stdout: '[]' }, { stdout: 'done\n' }]);
    await expect(openPullRequest(input(silent.gh))).rejects.toThrow(/no PR URL/);
  });
});

describe('createDeliver', () => {
  async function setup(preview: { command: string[]; ports: number[] } | null) {
    const { repo, home, host } = await hostWithRemote('git@github.com:alex/Cena.git');
    const db = openStore(home);
    upsertHost(db, { ...host, adapter: 'openspec' });
    insertRun(db, { id: 'run-1', hostId: 'cena', settings: {}, stopAt: null });
    const runChangeId = insertRunChange(db, { runId: 'run-1', change: 'a-thing', position: 0 });
    const changeDir = makeScratchDir('deliver-change');
    const context = {
      db,
      hostId: 'cena',
      host,
      config: { ...EMPTY_HOST_CONFIG, preview },
      runId: 'run-1',
      runChangeId,
      change: facts(),
      worktree: repo.root,
      branch: 'cp/a-thing',
      baseCommit: repo.commit,
      changeDir,
      flags: [],
      signal: new AbortController().signal,
    };
    return { repo, db, context, changeDir };
  }

  function recordingGh(prUrl = 'https://github.com/alex/Cena/pull/12') {
    const calls: string[][] = [];
    const gh = async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[1] === 'list') return { exitCode: 0, stdout: '[]', stderr: '' };
      if (args[1] === 'create') return { exitCode: 0, stdout: `${prUrl}\n`, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    return { gh, calls };
  }

  it("waits for the host's deploy in the background, then puts its link in the PR", async () => {
    const { repo, context, changeDir } = await setup(null);
    const { gh, calls } = recordingGh();
    const lookups: string[] = [];
    const deliver = createDeliver({
      home: '/unused',
      consolePort: 4170,
      adapterFor: () => null,
      gh,
      push: async () => {},
      hasPreviewDeploys: async () => true,
      findDeployPreview: async (input) => {
        lookups.push(input.sha);
        return { url: 'https://cena-abc.vercel.app/' };
      },
    });
    const delivered = await deliver(context);
    expect(delivered).toMatchObject({
      prUrl: 'https://github.com/alex/Cena/pull/12',
      previewUrl: null,
    });
    const pending = readFileSync(join(changeDir, 'pr-body.md'), 'utf8');
    expect(pending).toContain("the host's deploy is building");

    await expect(delivered.previewLater?.(new AbortController().signal)).resolves.toBe(
      'https://cena-abc.vercel.app/',
    );
    expect(lookups).toEqual([repo.commit]);
    expect(readFileSync(join(changeDir, 'pr-body.md'), 'utf8')).toContain(
      '**Preview:** https://cena-abc.vercel.app/',
    );
    expect(calls.at(-1)?.slice(0, 3)).toEqual([
      'pr',
      'edit',
      'https://github.com/alex/Cena/pull/12',
    ]);
  });

  it('links a host without deploys to the console page that starts its local preview', async () => {
    const { context, changeDir } = await setup({
      command: ['pnpm', 'dev', '--port', '{port}'],
      ports: [],
    });
    const deliver = createDeliver({
      home: '/unused',
      consolePort: 4170,
      adapterFor: () => null,
      gh: recordingGh().gh,
      push: async () => {},
      hasPreviewDeploys: async () => false,
    });
    const delivered = await deliver(context);
    expect(delivered.previewUrl).toBe('http://127.0.0.1:4170/h/cena/preview/a-thing');
    expect(delivered.previewLater).toBeUndefined();
    expect(readFileSync(join(changeDir, 'pr-body.md'), 'utf8')).toContain(
      '**Preview:** http://127.0.0.1:4170/h/cena/preview/a-thing',
    );
  });

  it('says there is no preview when the host has neither', async () => {
    const { context } = await setup(null);
    const deliver = createDeliver({
      home: '/unused',
      consolePort: 4170,
      adapterFor: () => null,
      gh: recordingGh().gh,
      push: async () => {},
      hasPreviewDeploys: async () => false,
    });
    await expect(deliver(context)).resolves.toMatchObject({ previewUrl: null });
  });
});
