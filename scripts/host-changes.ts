// Read-only readiness check: lists a host repository's changes and their derived status at the
// committed tip of its base branch, the way the console would before any approval.
//
//   node scripts/host-changes.ts {repoRoot} {baseBranch}
//
// Prints one line per change in console order, `{id} {status} {done}/{total}`. It resolves
// `refs/heads/{baseBranch}`, picks the framework adapter through the composition root, takes the
// adapter's snapshot and derives each status with `deriveChangeStatus` (no runway overlay:
// approvals are not read here). Every git call
// is a read (`rev-parse`, `ls-tree`, `cat-file`) through the clean-environment runner. It opens no
// store, starts no daemon, touches no Counterpoint home and writes nothing to the host repository.
import { isAbsolute, resolve } from 'node:path';
import { adapterFor, detectFramework, NO_FRAMEWORK } from '../src/compose.ts';
import { createGitFileReader } from '../src/core/git/reader.ts';
import { isChangeId } from '../src/core/ids.ts';
import { deriveChangeStatus } from '../src/core/runway/status.ts';

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [repoArg, branch] = process.argv.slice(2);
  if (!repoArg || !branch) fail('Usage: node scripts/host-changes.ts {repoRoot} {baseBranch}');
  if (!BRANCH_RE.test(branch) || branch.includes('..')) fail('Not a usable branch name.');
  const repoRoot = isAbsolute(repoArg) ? repoArg : resolve(repoArg);

  const reader = createGitFileReader(repoRoot);
  const tip = await reader.resolve(`refs/heads/${branch}`);
  if (tip === null) fail(`No branch ${JSON.stringify(branch)} in ${repoRoot}.`);

  const framework = await detectFramework(repoRoot, branch);
  const adapter = framework === NO_FRAMEWORK ? null : adapterFor({ adapter: framework });
  if (adapter === null) fail(`No composed framework adapter recognises ${branch} at ${tip}.`);

  const snapshot = await adapter.snapshot(reader, tip);
  if (snapshot.unreadable !== null) {
    fail(
      `Planning document unreadable: ${snapshot.unreadable.file}: ${snapshot.unreadable.reason}`,
    );
  }
  for (const change of snapshot.changes) {
    if (!isChangeId(change.id)) continue;
    const { status } = deriveChangeStatus(change);
    process.stdout.write(`${change.id} ${status} ${change.tasks.done}/${change.tasks.total}\n`);
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
