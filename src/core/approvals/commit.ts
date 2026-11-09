// RED stub: API only.
import type { CommitIdent, TreeEntry } from '../git/plumbing.ts';

export interface BuiltApprovalCommit {
  payload: Uint8Array;
  tree: string;
  blob: string;
  parent: string;
}

export async function buildApprovalCommit(_options: {
  root: string;
  baseTip: string;
  itemPath: string;
  fileBytes: Uint8Array;
  message: string;
  ident: CommitIdent;
}): Promise<BuiltApprovalCommit> {
  throw new Error('not implemented');
}

export async function replacePath(
  _root: string,
  _treeSha: string | null,
  _segments: readonly string[],
  _entry: Omit<TreeEntry, 'name'>,
): Promise<string> {
  throw new Error('not implemented');
}

export function embedSignature(_payload: Uint8Array, _armored: string): Uint8Array {
  throw new Error('not implemented');
}

export function splitSignedCommit(_bytes: Uint8Array): { payload: Uint8Array; signature: string } {
  throw new Error('not implemented');
}

export type LandResult =
  | { ok: true; commit: string; previousTip: string; placedIn: string[] }
  | { ok: false; reason: 'base-moved' | 'occupied' | 'unsafe-path'; detail?: string };

export async function landApprovalCommit(_options: {
  root: string;
  baseRef: string;
  expectedOldTip: string;
  signedBytes: Uint8Array;
  itemPath: string;
  blob: string;
}): Promise<LandResult> {
  throw new Error('not implemented');
}

export async function signAndLand(_options: {
  root: string;
  baseBranch: string;
  itemPath: string;
  fileBytes: Uint8Array;
  message: string;
  ident: CommitIdent;
  sign: (payload: Uint8Array) => Promise<string>;
}): Promise<LandResult> {
  throw new Error('not implemented');
}
