// Approval verification (APPR-01, APPR-04): recomputed from git every time, failing closed.
//
// Steps 1-4 of the RESEARCH algorithm (step 5, comparing input digests, lands in 01-12):
// 1. The last first-parent commit C at the base tip that touched .counterpoint/approvals/{item}.json.
// 2. C has exactly one parent (read from the commit object itself) and changes exactly that one
//    file (A or M); the file at the tip is the one C wrote.
// 3. C carries exactly one well-formed `gpgsig`, and `ssh-keygen -Y verify` accepts it for
//    owner@counterpoint in namespace `git` against the allowed-signers file outside the repo,
//    with the signer's fingerprint equal to the pinned one.
// 4. The approval bytes are read from C (capped at 64 KiB).
// The verdict never comes from git's own commit-signature checks, git log signature
// placeholders or ssh-keygen's no-validate mode: those depend on repository configuration or
// skip the allowed-signers file. Every unexpected error is `invalid` with reason `error`.

import {
  catBlob,
  catFileCommit,
  commitDate,
  diffTreeNameStatus,
  logFirstParentLast,
  revParse,
  revParseMaybe,
} from '../git/plumbing.ts';
import {
  BRANCH_RE,
  isArmoredSignature,
  payloadParents,
  SignedCommitError,
  splitSignedCommit,
} from './commit.ts';
import { verifySignature } from './ssh.ts';
import { checkAllowedSignersFile, OWNER_PRINCIPAL } from './trust-store.ts';

const ITEM_ID_RE = /^phase-\d{2}(\.\d+)?$/;
const MAX_APPROVAL_BYTES = 64 * 1024;

export type InvalidApprovalReason =
  | 'bad-item-id'
  | 'allowed-signers-invalid'
  | 'allowed-signers-multiple-keys'
  | 'allowed-signers-principal'
  | 'fingerprint-mismatch'
  | 'root-commit'
  | 'merge-commit'
  | 'not-single-file'
  | 'tip-mismatch'
  | 'unsigned'
  | 'multiple-signatures'
  | 'garbled-signature'
  | 'signature-namespace'
  | 'signature-tampered'
  | 'signature-untrusted'
  | 'too-large'
  | 'error';

export type ApprovalCommitState =
  | { state: 'none'; tip: string }
  | {
      state: 'signed';
      commit: string;
      tip: string;
      bytes: Uint8Array;
      signedAt: string;
      fingerprint: string;
    }
  | { state: 'invalid'; reason: InvalidApprovalReason; detail?: string; commit?: string };

function invalid(
  reason: InvalidApprovalReason,
  detail?: string,
  commit?: string,
): ApprovalCommitState {
  return {
    state: 'invalid',
    reason,
    ...(detail === undefined ? {} : { detail }),
    ...(commit === undefined ? {} : { commit }),
  };
}

export async function verifyApprovalCommit(options: {
  root: string;
  baseBranch: string;
  itemId: string;
  trust: { allowedSignersPath: string; fingerprint: string };
  tmpDir: string;
}): Promise<ApprovalCommitState> {
  const { root, itemId, trust } = options;
  try {
    if (!ITEM_ID_RE.test(itemId)) return invalid('bad-item-id');
    if (!BRANCH_RE.test(options.baseBranch)) return invalid('error', 'Invalid base branch name.');

    const signers = checkAllowedSignersFile(trust.allowedSignersPath, trust.fingerprint);
    if (!signers.ok) {
      const reason: InvalidApprovalReason =
        signers.problem === 'multiple-keys'
          ? 'allowed-signers-multiple-keys'
          : signers.problem === 'principal'
            ? 'allowed-signers-principal'
            : signers.problem === 'fingerprint-mismatch'
              ? 'fingerprint-mismatch'
              : 'allowed-signers-invalid';
      return invalid(reason, signers.detail);
    }

    const tip = await revParse(root, `refs/heads/${options.baseBranch}^{commit}`);
    const path = `.counterpoint/approvals/${itemId}.json`;
    const atTip = await revParseMaybe(root, `${tip}:${path}`);
    if (atTip === null) return { state: 'none', tip };

    const commit = await logFirstParentLast(root, tip, path);
    if (commit === null)
      return invalid('error', 'No commit on the base touched the approval file.');

    const raw = await catFileCommit(root, commit);
    const parents = payloadParents(raw);
    if (parents.length === 0) return invalid('root-commit', undefined, commit);
    if (parents.length > 1) return invalid('merge-commit', undefined, commit);

    const changes = await diffTreeNameStatus(root, commit, parents[0]);
    const only = changes[0];
    if (
      changes.length !== 1 ||
      only === undefined ||
      only.path !== path ||
      !['A', 'M'].includes(only.status)
    ) {
      return invalid('not-single-file', `${changes.length} path(s) changed.`, commit);
    }
    if ((await revParseMaybe(root, `${commit}:${path}`)) !== atTip) {
      return invalid('tip-mismatch', undefined, commit);
    }

    let split: { payload: Uint8Array; signature: string };
    try {
      split = splitSignedCommit(raw);
    } catch (error) {
      if (error instanceof SignedCommitError) {
        if (error.kind === 'unsigned') return invalid('unsigned', undefined, commit);
        if (error.kind === 'multiple-signatures')
          return invalid('multiple-signatures', undefined, commit);
        return invalid('garbled-signature', error.message, commit);
      }
      throw error;
    }
    if (!isArmoredSignature(split.signature))
      return invalid('garbled-signature', undefined, commit);

    const check = await verifySignature({
      allowedSignersPath: trust.allowedSignersPath,
      principal: OWNER_PRINCIPAL,
      namespace: 'git',
      signature: split.signature,
      payload: split.payload,
      tmpDir: options.tmpDir,
    });
    if (!check.ok) {
      const reason: InvalidApprovalReason = /namespace/i.test(check.message)
        ? 'signature-namespace'
        : /incorrect signature/i.test(check.message)
          ? 'signature-tampered'
          : 'signature-untrusted';
      return invalid(reason, check.message.split('\n')[0], commit);
    }
    if (check.fingerprint !== trust.fingerprint) {
      return invalid('fingerprint-mismatch', 'The signer is not the pinned key.', commit);
    }

    const bytes = await catBlob(root, commit, path);
    if (bytes === null) return invalid('error', 'The approval file could not be read.', commit);
    if (bytes.length > MAX_APPROVAL_BYTES) return invalid('too-large', undefined, commit);
    const signedAt = await commitDate(root, commit);
    return { state: 'signed', commit, tip, bytes, signedAt, fingerprint: check.fingerprint };
  } catch (error) {
    return invalid('error', (error as Error).message.slice(0, 200));
  }
}
