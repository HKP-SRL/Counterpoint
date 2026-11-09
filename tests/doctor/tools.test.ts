import { describe, expect, it } from 'vitest';
import {
  type CommandResult,
  type CommandRunner,
  checkTools,
  parseGitVersion,
  parseOpenSshVersion,
  versionAtLeast,
} from '../../src/doctor/tools.ts';

describe('parseGitVersion', () => {
  it('reads major, minor and patch from Apple git', () => {
    expect(parseGitVersion('git version 2.50.1 (Apple Git-155)')).toEqual([2, 50, 1]);
  });

  it('reads a version without a patch number', () => {
    expect(parseGitVersion('git version 2.34')).toEqual([2, 34, 0]);
  });

  it('returns null for text that is not a git version', () => {
    expect(parseGitVersion('command not found')).toBeNull();
  });
});

describe('parseOpenSshVersion', () => {
  it('reads major and minor from ssh -V', () => {
    expect(parseOpenSshVersion('OpenSSH_10.3p1, LibreSSL 3.3.6')).toEqual([10, 3]);
  });

  it('returns null for text that is not an OpenSSH version', () => {
    expect(parseOpenSshVersion('ssh: command not found')).toBeNull();
  });
});

describe('versionAtLeast', () => {
  it('rejects git 2.33 against the 2.34 minimum', () => {
    expect(versionAtLeast([2, 33, 9], [2, 34])).toBe(false);
  });

  it('accepts git 2.34.0 and newer', () => {
    expect(versionAtLeast([2, 34, 0], [2, 34])).toBe(true);
    expect(versionAtLeast([3, 0, 0], [2, 34])).toBe(true);
  });

  it('rejects OpenSSH 8.0 against the 8.1 minimum', () => {
    expect(versionAtLeast([8, 0], [8, 1])).toBe(false);
    expect(versionAtLeast([8, 1], [8, 1])).toBe(true);
  });
});

type Answers = Record<string, CommandResult>;

function fakeRun(answers: Answers): { run: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CommandRunner = async (file, args) => {
    calls.push([file, ...args]);
    const answer = answers[file];
    if (answer === undefined) return { exitCode: null, stdout: '', stderr: '', error: 'ENOENT' };
    return answer;
  };
  return { run, calls };
}

const ok = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: '' });

describe('checkTools', () => {
  const allPresent: Answers = {
    claude: ok('2.1.319 (Claude Code)\n'),
    git: ok('git version 2.50.1 (Apple Git-155)\n'),
    gh: ok('gh version 2.102.0 (2026-09-30)\nhttps://github.com/cli/cli/releases/tag/v2.102.0\n'),
  };

  it('passes claude, git and gh with their version strings', async () => {
    const { run } = fakeRun(allPresent);
    const rows = await checkTools(run);
    expect(rows.map((row) => [row.id, row.result, row.detail])).toEqual([
      ['claude', 'pass', '2.1.319 (Claude Code)'],
      ['git', 'pass', 'git version 2.50.1 (Apple Git-155)'],
      ['gh', 'pass', 'gh version 2.102.0 (2026-09-30)'],
    ]);
    expect(rows.every((row) => row.fix === undefined)).toBe(true);
  });

  it('runs each tool with an argument array', async () => {
    const { run, calls } = fakeRun(allPresent);
    await checkTools(run);
    expect(calls).toEqual([
      ['claude', '--version'],
      ['git', '--version'],
      ['gh', '--version'],
    ]);
  });

  it('fails git older than 2.34 with an update fix', async () => {
    const { run } = fakeRun({ ...allPresent, git: ok('git version 2.33.1\n') });
    const git = (await checkTools(run)).find((row) => row.id === 'git');
    expect(git?.result).toBe('fail');
    expect(git?.fix).toBe('Update git to 2.34 or newer');
  });

  it('fails a missing claude with an install fix', async () => {
    const { claude: _claude, ...rest } = allPresent;
    const { run } = fakeRun(rest);
    const claude = (await checkTools(run)).find((row) => row.id === 'claude');
    expect(claude?.result).toBe('fail');
    expect(claude?.fix).toBe('Install Claude Code and sign in');
  });

  it('fails a missing gh with an install fix', async () => {
    const { gh: _gh, ...rest } = allPresent;
    const { run } = fakeRun(rest);
    const gh = (await checkTools(run)).find((row) => row.id === 'gh');
    expect(gh?.result).toBe('fail');
    expect(gh?.fix).toBe('Install the GitHub CLI (gh)');
  });

  it('fails a tool that exits non-zero', async () => {
    const { run } = fakeRun({ ...allPresent, gh: { exitCode: 1, stdout: '', stderr: 'boom' } });
    const gh = (await checkTools(run)).find((row) => row.id === 'gh');
    expect(gh?.result).toBe('fail');
  });
});
