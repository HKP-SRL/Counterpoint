// The host's own preview deploy (pull-requests: Preview link), read from GitHub deployments.
import { describe, expect, it } from 'vitest';
import type { GhRun } from '../../src/build/deliver.ts';
import { findDeployPreview, hasPreviewDeploys, previewUrlFrom } from '../../src/build/preview.ts';

const slug = { host: 'github.com', owner: 'alex', repo: 'Cena' };
const SHA = 'b'.repeat(40);

/** A gh stand-in: deployments per poll, and each deployment's statuses per poll. */
function fakeGh(script: {
  deployments: Array<Array<Record<string, unknown>>>;
  statuses?: Record<number, Array<Array<Record<string, unknown>>>>;
}) {
  const calls: string[][] = [];
  let polls = 0;
  const statusPolls = new Map<number, number>();
  const gh: GhRun = async (args) => {
    calls.push([...args]);
    const path = args.find((a) => a.startsWith('repos/')) ?? '';
    const status = /deployments\/(\d+)\/statuses$/.exec(path);
    if (status !== null) {
      const id = Number(status[1]);
      const n = statusPolls.get(id) ?? 0;
      statusPolls.set(id, n + 1);
      const list = script.statuses?.[id] ?? [[]];
      return {
        exitCode: 0,
        stdout: JSON.stringify(list[Math.min(n, list.length - 1)]),
        stderr: '',
      };
    }
    const list = script.deployments[Math.min(polls, script.deployments.length - 1)] ?? [];
    polls += 1;
    return { exitCode: 0, stdout: JSON.stringify(list), stderr: '' };
  };
  return { gh, calls };
}

const preview = (id: number) => ({ id, environment: 'Preview', production_environment: false });
const production = (id: number) => ({
  id,
  environment: 'Production',
  production_environment: true,
});

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe('findDeployPreview', () => {
  it("waits for the commit's preview deploy and returns its URL", async () => {
    const { gh, calls } = fakeGh({
      deployments: [[], [production(1), preview(2)]],
      statuses: {
        2: [
          [{ state: 'in_progress' }],
          [{ state: 'success', environment_url: 'https://cena-x.vercel.app' }],
        ],
      },
    });
    const found = await findDeployPreview({
      gh,
      cwd: '/run',
      slug,
      sha: SHA,
      signal: new AbortController().signal,
      ...clock(),
    });
    expect(found).toEqual({ url: 'https://cena-x.vercel.app/' });
    expect(calls[0]).toEqual([
      'api',
      '--method',
      'GET',
      'repos/alex/Cena/deployments',
      '-f',
      `sha=${SHA}`,
      '-f',
      'per_page=20',
    ]);
    // The production deployment's statuses are never read.
    expect(calls.some((c) => c.includes('repos/alex/Cena/deployments/1/statuses'))).toBe(false);
  });

  it('stops at a failed deploy', async () => {
    const { gh } = fakeGh({
      deployments: [[preview(2)]],
      statuses: { 2: [[{ state: 'failure' }]] },
    });
    await expect(
      findDeployPreview({
        gh,
        cwd: '/run',
        slug,
        sha: SHA,
        signal: new AbortController().signal,
        ...clock(),
      }),
    ).resolves.toEqual({ url: null, reason: "The host's preview deploy failed." });
  });

  it('gives up after the wait, and at once when the run stops', async () => {
    const { gh } = fakeGh({ deployments: [[]] });
    await expect(
      findDeployPreview({
        gh,
        cwd: '/run',
        slug,
        sha: SHA,
        signal: new AbortController().signal,
        waitMs: 60_000,
        ...clock(),
      }),
    ).resolves.toEqual({ url: null, reason: 'No preview deploy was ready within 1 minute.' });
    const stop = new AbortController();
    stop.abort();
    await expect(
      findDeployPreview({ gh, cwd: '/run', slug, sha: SHA, signal: stop.signal, ...clock() }),
    ).resolves.toMatchObject({ url: null, reason: 'The run stopped before the deploy was ready.' });
  });

  it('asks the right host for GitHub Enterprise', async () => {
    const { gh, calls } = fakeGh({
      deployments: [[preview(5)]],
      statuses: { 5: [[{ state: 'success', target_url: 'https://pr-5.example.dev' }]] },
    });
    await findDeployPreview({
      gh,
      cwd: '/run',
      slug: { host: 'git.example.com', owner: 'team', repo: 'app' },
      sha: SHA,
      signal: new AbortController().signal,
      ...clock(),
    });
    expect(calls[0]?.slice(0, 3)).toEqual(['api', '--hostname', 'git.example.com']);
  });
});

describe('hasPreviewDeploys', () => {
  it('is true only when recent deployments include a preview', async () => {
    expect(
      await hasPreviewDeploys(
        fakeGh({ deployments: [[production(1), preview(2)]] }).gh,
        '/run',
        slug,
      ),
    ).toBe(true);
    expect(
      await hasPreviewDeploys(fakeGh({ deployments: [[production(1)]] }).gh, '/run', slug),
    ).toBe(false);
    expect(await hasPreviewDeploys(fakeGh({ deployments: [[]] }).gh, '/run', slug)).toBe(false);
  });
});

describe('previewUrlFrom', () => {
  it('takes https URLs only, without credentials', () => {
    expect(previewUrlFrom('https://cena-x.vercel.app')).toBe('https://cena-x.vercel.app/');
    expect(previewUrlFrom('http://cena-x.vercel.app')).toBeNull();
    expect(previewUrlFrom('javascript:alert(1)')).toBeNull();
    expect(previewUrlFrom('https://user:pw@x.dev')).toBeNull();
    expect(previewUrlFrom(42)).toBeNull();
  });
});
