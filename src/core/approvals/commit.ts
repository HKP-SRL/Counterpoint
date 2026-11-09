// The approval commit (APPR-01): a commit on the base branch that adds or replaces exactly one
// file, `.counterpoint/approvals/{item}.json`, signed with the owner's SSH key.
//
// Built with plumbing only (hash-object, ls-tree/mktree, commit-tree): no checkout and no index
// of its own, so nothing in the owner's checkout changes while it is built. The signature from
// `ssh-keygen -Y sign -n git` is embedded as a `gpgsig` header, the signed object is written with
// `hash-object -t commit`, and the base ref moves by compare-and-swap (`update-ref <new> <old>`),
// so a concurrent change to the base is refused rather than overwritten. Where the base branch
// is checked out, only the approval file is placed in that checkout's index and working tree;
// a path that is already occupied there is refused before any ref moves. Nothing is pushed.
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CommitIdent,
  catFileCommit,
  checkoutIndexFile,
  commitTree,
  filterAttribute,
  hashObjectBlob,
  hashObjectCommit,
  lsTree,
  mktree,
  revParse,
  revParseMaybe,
  statusOfPath,
  type TreeEntry,
  updateIndexCacheinfo,
  updateRefCas,
  worktreeList,
} from '../git/plumbing.ts';

/** The only paths an approval commit may write. */
export const APPROVAL_PATH_RE = /^\.counterpoint\/approvals\/phase-\d{2}(\.\d+)?\.json$/;

const SHA_RE = /^[0-9a-f]{40}$/;
const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}(?<![/.])$/;
const ARMOR_RE =
  /^-----BEGIN SSH SIGNATURE-----\n([A-Za-z0-9+/=]+\n)+-----END SSH SIGNATURE-----\n$/;

export class SignedCommitError extends Error {
  readonly kind: 'malformed' | 'unsigned' | 'multiple-signatures' | 'unsupported-signature';

  constructor(kind: SignedCommitError['kind'], message: string) {
    super(message);
    this.name = 'SignedCommitError';
    this.kind = kind;
  }
}

function assertApprovalPath(itemPath: string): void {
  if (!APPROVAL_PATH_RE.test(itemPath)) throw new Error('Not an approval file path.');
}

function assertSha(value: string, what: string): void {
  if (!SHA_RE.test(value)) throw new Error(`Invalid ${what}.`);
}

export interface BuiltApprovalCommit {
  /** The unsigned commit object bytes: exactly what gets signed. */
  payload: Uint8Array;
  tree: string;
  blob: string;
  parent: string;
}

/** Builds the unsigned approval commit on top of `baseTip` and returns its payload. */
export async function buildApprovalCommit(options: {
  root: string;
  baseTip: string;
  itemPath: string;
  fileBytes: Uint8Array;
  message: string;
  ident: CommitIdent;
}): Promise<BuiltApprovalCommit> {
  const { root, baseTip, itemPath } = options;
  assertApprovalPath(itemPath);
  assertSha(baseTip, 'base tip');
  const blob = await hashObjectBlob(root, options.fileBytes);
  const baseTree = await revParse(root, `${baseTip}^{tree}`);
  const tree = await replacePath(root, baseTree, itemPath.split('/'), {
    mode: '100644',
    type: 'blob',
    sha: blob,
  });
  const unsigned = await commitTree(root, {
    tree,
    parent: baseTip,
    message: options.message,
    ident: options.ident,
  });
  const payload = await catFileCommit(root, unsigned);
  return { payload, tree, blob, parent: baseTip };
}

/**
 * Returns a new tree equal to `treeSha` (or an empty tree) with `entry` at `segments`. Each level
 * is read with ls-tree and rebuilt with mktree, so every sibling at every level is preserved.
 */
export async function replacePath(
  root: string,
  treeSha: string | null,
  segments: readonly string[],
  entry: Omit<TreeEntry, 'name'>,
): Promise<string> {
  const [head, ...rest] = segments;
  if (head === undefined || head === '' || head === '.' || head === '..') {
    throw new Error('Invalid path segment.');
  }
  const entries = treeSha === null ? [] : await lsTree(root, treeSha);
  const existing = entries.find((e) => e.name === head);
  const others = entries.filter((e) => e.name !== head);
  if (rest.length === 0) {
    if (existing && !(existing.type === 'blob' && /^1006[0-7]{2}$/.test(existing.mode))) {
      throw new Error(`"${head}" exists in the base tree and is not a regular file.`);
    }
    return mktree(root, [...others, { ...entry, name: head }]);
  }
  if (existing && existing.type !== 'tree') {
    throw new Error(`"${head}" exists in the base tree and is not a directory.`);
  }
  const child = await replacePath(root, existing?.sha ?? null, rest, entry);
  return mktree(root, [...others, { mode: '040000', type: 'tree', sha: child, name: head }]);
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

/** Inserts `armored` as a `gpgsig` header at the end of the commit headers. */
export function embedSignature(payload: Uint8Array, armored: string): Uint8Array {
  if (!ARMOR_RE.test(armored)) throw new Error('Not an armored SSH signature.');
  const text = latin1(payload);
  const end = text.indexOf('\n\n');
  if (end < 0) throw new SignedCommitError('malformed', 'Commit object has no header end.');
  if (/(^|\n)gpgsig(-sha256)? /.test(text.slice(0, end + 1))) {
    throw new SignedCommitError('multiple-signatures', 'Commit already carries a signature.');
  }
  const lines = armored.slice(0, -1).split('\n');
  const header = `gpgsig ${lines[0]}\n${lines
    .slice(1)
    .map((line) => ` ${line}\n`)
    .join('')}`;
  return Buffer.from(text.slice(0, end + 1) + header + text.slice(end + 1), 'latin1');
}

/**
 * The exact inverse of embedSignature: returns the signed payload and the armored signature.
 * Throws when the commit has no signature header or more than one.
 */
export function splitSignedCommit(bytes: Uint8Array): { payload: Uint8Array; signature: string } {
  const text = latin1(bytes);
  const end = text.indexOf('\n\n');
  if (end < 0) throw new SignedCommitError('malformed', 'Commit object has no header end.');
  const lines = text.slice(0, end).split('\n');
  const kept: string[] = [];
  const signatures: { name: string; lines: string[] }[] = [];
  let inSignature = false;
  for (const line of lines) {
    if (line.startsWith(' ')) {
      if (inSignature) signatures.at(-1)?.lines.push(line.slice(1));
      else kept.push(line);
      continue;
    }
    const space = line.indexOf(' ');
    const name = space < 0 ? line : line.slice(0, space);
    if (name === 'gpgsig' || name === 'gpgsig-sha256') {
      inSignature = true;
      signatures.push({ name, lines: [line.slice(name.length + 1)] });
    } else {
      inSignature = false;
      kept.push(line);
    }
  }
  const [only, ...more] = signatures;
  if (only === undefined) throw new SignedCommitError('unsigned', 'Commit has no signature.');
  if (more.length > 0) {
    throw new SignedCommitError(
      'multiple-signatures',
      'Commit has more than one signature header.',
    );
  }
  if (only.name !== 'gpgsig') {
    throw new SignedCommitError(
      'unsupported-signature',
      'Commit uses an unsupported signature header.',
    );
  }
  const payload = `${kept.join('\n')}\n${text.slice(end + 1)}`;
  return { payload: Buffer.from(payload, 'latin1'), signature: `${only.lines.join('\n')}\n` };
}

/** The `parent` header values of a raw commit object, in order. */
export function payloadParents(bytes: Uint8Array): string[] {
  const text = latin1(bytes);
  const end = text.indexOf('\n\n');
  const headers = text.slice(0, end < 0 ? text.length : end).split('\n');
  return headers.filter((l) => l.startsWith('parent ')).map((l) => l.slice(7));
}

export type LandRefusal = {
  ok: false;
  reason: 'base-moved' | 'occupied' | 'unsafe-path';
  detail?: string;
};

export type LandResult =
  | {
      ok: true;
      commit: string;
      previousTip: string;
      /** Checkouts of the base branch where the approval file was placed. */
      placedIn: string[];
      /** Checkouts of the base branch where placing the file failed after the ref moved. */
      unplaced: { worktree: string; error: string }[];
    }
  | LandRefusal;

/**
 * Finds every checkout of `baseRef` and makes sure placing the approval file there cannot
 * overwrite anything of the owner's: the path must be absent or tracked and unmodified, with no
 * symlink on the way, and no content filter (which could run a program) may apply to it.
 */
async function checkCheckouts(
  root: string,
  baseRef: string,
  itemPath: string,
): Promise<{ ok: true; worktrees: string[] } | LandRefusal> {
  const all = await worktreeList(root);
  const worktrees = all
    .filter((w) => !w.bare && !w.prunable && w.branch === baseRef)
    .map((w) => w.path);
  const segments = itemPath.split('/');
  for (const worktree of worktrees) {
    let current = worktree;
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (stat === undefined) break;
      const last = index === segments.length - 1;
      if (last ? !stat.isFile() : !stat.isDirectory()) {
        return { ok: false, reason: 'occupied', detail: `${current} is in the way.` };
      }
    }
    const filter = await filterAttribute(worktree, itemPath);
    if (filter !== 'unspecified' && filter !== 'unset') {
      return {
        ok: false,
        reason: 'unsafe-path',
        detail: `A "filter" attribute applies to ${itemPath} in ${worktree}.`,
      };
    }
    const status = await statusOfPath(worktree, itemPath);
    if (status !== '') {
      return {
        ok: false,
        reason: 'occupied',
        detail: `${itemPath} has uncommitted changes or untracked content in ${worktree}.`,
      };
    }
  }
  return { ok: true, worktrees };
}

/** Writes the signed commit and moves `baseRef` to it only if it still points at `expectedOldTip`. */
export async function landApprovalCommit(options: {
  root: string;
  baseRef: string;
  expectedOldTip: string;
  signedBytes: Uint8Array;
  itemPath: string;
  blob: string;
}): Promise<LandResult> {
  const { root, baseRef, expectedOldTip, itemPath, blob } = options;
  assertApprovalPath(itemPath);
  assertSha(expectedOldTip, 'expected base tip');
  assertSha(blob, 'blob id');
  if (!baseRef.startsWith('refs/heads/') || !BRANCH_RE.test(baseRef.slice(11))) {
    throw new Error('Invalid base ref.');
  }
  const parents = payloadParents(options.signedBytes);
  if (parents.length !== 1 || parents[0] !== expectedOldTip) {
    throw new Error('The signed commit is not a single-parent child of the expected base tip.');
  }

  const checked = await checkCheckouts(root, baseRef, itemPath);
  if (!checked.ok) return checked;

  const commit = await hashObjectCommit(root, options.signedBytes);
  if ((await revParseMaybe(root, `${commit}:${itemPath}`)) !== blob) {
    throw new Error('The signed commit does not hold the approval file it was built with.');
  }
  const cas = await updateRefCas(
    root,
    baseRef,
    commit,
    expectedOldTip,
    `counterpoint: approve ${itemPath}`,
  );
  if (!cas.ok) return cas;

  const placedIn: string[] = [];
  const unplaced: { worktree: string; error: string }[] = [];
  for (const worktree of checked.worktrees) {
    try {
      await updateIndexCacheinfo(worktree, blob, itemPath);
      await checkoutIndexFile(worktree, itemPath);
      placedIn.push(worktree);
    } catch (error) {
      unplaced.push({ worktree, error: (error as Error).message });
    }
  }
  return { ok: true, commit, previousTip: expectedOldTip, placedIn, unplaced };
}

/**
 * Builds, signs and lands an approval commit on `baseBranch`. `sign` receives the exact commit
 * payload; production passes signPayload with the trusted private key. Occupied paths are
 * refused before `sign` is called, so the owner is never asked to sign something that cannot land.
 */
export async function signAndLand(options: {
  root: string;
  baseBranch: string;
  itemPath: string;
  fileBytes: Uint8Array;
  message: string;
  ident: CommitIdent;
  sign: (payload: Uint8Array) => Promise<string>;
}): Promise<LandResult> {
  const { root, baseBranch, itemPath } = options;
  assertApprovalPath(itemPath);
  if (!BRANCH_RE.test(baseBranch)) throw new Error('Invalid base branch name.');
  const baseRef = `refs/heads/${baseBranch}`;
  const tip = await revParse(root, `${baseRef}^{commit}`);

  const checked = await checkCheckouts(root, baseRef, itemPath);
  if (!checked.ok) return checked;

  const built = await buildApprovalCommit({
    root,
    baseTip: tip,
    itemPath,
    fileBytes: options.fileBytes,
    message: options.message,
    ident: options.ident,
  });
  const signature = await options.sign(built.payload);
  const signedBytes = embedSignature(built.payload, signature);
  return landApprovalCommit({
    root,
    baseRef,
    expectedOldTip: tip,
    signedBytes,
    itemPath,
    blob: built.blob,
  });
}
