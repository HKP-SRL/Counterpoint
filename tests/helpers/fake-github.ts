// GitHub's PR side over a local bare repository, for planning-write tests (owner-inbox D-11, D-12):
// a fake `gh` that opens, views, merges (squash) and closes PRs, and refuses `--admin`.
import type { GhRun } from '../../src/build/deliver.ts';
import { runGit } from '../../src/core/git/run.ts';

export type Checks = 'none' | 'pending' | 'passing' | 'failing';

/** GitHub's PR side over a bare repository: open, view, merge (squash) and close. */
export class FakeGitHub {
  readonly calls: string[][] = [];
  readonly prs: { number: number; head: string; base: string; state: string; url: string }[] = [];
  checks: Checks = 'none';
  reviewRequired = false;
  /** Runs once, right after the first PR opens (another PR lands, say). */
  afterCreate: (() => Promise<void>) | null = null;

  readonly bare: string;

  constructor(bare: string) {
    this.bare = bare;
  }

  async #sha(ref: string): Promise<string | null> {
    const result = await runGit(this.bare, ['rev-parse', '--verify', '--quiet', ref], {
      allowExitCodes: [0, 1, 128],
    });
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  async #mergeTree(base: string, head: string): Promise<string | null> {
    const result = await runGit(this.bare, ['merge-tree', '--write-tree', base, head], {
      allowExitCodes: [0, 1],
    });
    return result.exitCode === 0 ? (result.stdout.trim().split('\n')[0] ?? null) : null;
  }

  async #status(pr: FakeGitHub['prs'][number]) {
    const head = await this.#sha(`refs/heads/${pr.head}`);
    const base = (await this.#sha(`refs/heads/${pr.base}`)) as string;
    let merge = 'CLEAN';
    if (head === null || (await this.#mergeTree(base, head)) === null) merge = 'DIRTY';
    else if (this.checks === 'pending' || this.checks === 'failing') merge = 'BLOCKED';
    else if (this.reviewRequired) merge = 'BLOCKED';
    const rollup =
      this.checks === 'none'
        ? []
        : [
            this.checks === 'pending'
              ? { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }
              : {
                  __typename: 'CheckRun',
                  status: 'COMPLETED',
                  conclusion: this.checks === 'passing' ? 'SUCCESS' : 'FAILURE',
                },
          ];
    return {
      state: pr.state,
      mergeStateStatus: pr.state === 'OPEN' ? merge : 'UNKNOWN',
      statusCheckRollup: rollup,
      reviewDecision: this.reviewRequired ? 'REVIEW_REQUIRED' : '',
      headRefOid: head ?? '',
    };
  }

  readonly gh: GhRun = async (args) => {
    this.calls.push([...args]);
    const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
    const fail = (stderr: string) => ({ exitCode: 1, stdout: '', stderr });
    const flag = (name: string) => args[args.indexOf(name) + 1] ?? '';
    const pr = this.prs.find((p) => p.url === args[2]);
    const [group, verb] = args;
    if (args.includes('--admin')) return fail('never bypass');
    if (group === 'repo' && verb === 'view') {
      return ok(JSON.stringify({ squashMergeAllowed: true, mergeCommitAllowed: true }));
    }
    if (group !== 'pr') return fail(`unknown ${group}`);
    switch (verb) {
      case 'list': {
        const open = this.prs.filter((p) => p.head === flag('--head') && p.state === 'OPEN');
        return ok(JSON.stringify(open.slice(0, 1).map((p) => ({ url: p.url }))));
      }
      case 'create': {
        const number = this.prs.length + 1;
        const url = `https://github.com/alex/Cena/pull/${number}`;
        this.prs.push({ number, head: flag('--head'), base: flag('--base'), state: 'OPEN', url });
        const after = this.afterCreate;
        this.afterCreate = null;
        await after?.();
        return ok(`${url}\n`);
      }
      case 'edit':
      case 'ready':
        return ok();
      case 'view':
        return pr === undefined ? fail('no such PR') : ok(JSON.stringify(await this.#status(pr)));
      case 'merge': {
        if (pr === undefined) return fail('no such PR');
        const status = await this.#status(pr);
        if (pr.state !== 'OPEN' || status.mergeStateStatus !== 'CLEAN') {
          return fail(
            'X Pull request is not mergeable: the base branch policy prohibits the merge.',
          );
        }
        if (status.headRefOid !== flag('--match-head-commit')) return fail('head moved');
        const base = (await this.#sha(`refs/heads/${pr.base}`)) as string;
        const tree = (await this.#mergeTree(base, status.headRefOid)) as string;
        const commit = (
          await runGit(this.bare, ['commit-tree', tree, '-p', base, '-m', `Squash #${pr.number}`], {
            env: {
              GIT_AUTHOR_NAME: 'GitHub',
              GIT_AUTHOR_EMAIL: 'gh@example.invalid',
              GIT_COMMITTER_NAME: 'GitHub',
              GIT_COMMITTER_EMAIL: 'gh@example.invalid',
            },
          })
        ).stdout.trim();
        await runGit(this.bare, ['update-ref', `refs/heads/${pr.base}`, commit, base]);
        if (args.includes('--delete-branch')) {
          await runGit(this.bare, ['update-ref', '-d', `refs/heads/${pr.head}`]);
        }
        pr.state = 'MERGED';
        return ok();
      }
      case 'close':
        if (pr === undefined) return fail('no such PR');
        pr.state = 'CLOSED';
        if (args.includes('--delete-branch')) {
          await runGit(this.bare, ['update-ref', '-d', `refs/heads/${pr.head}`]);
        }
        return ok();
      default:
        return fail(`unknown pr ${verb}`);
    }
  };
}
