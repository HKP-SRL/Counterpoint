// RED stub: API only.
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

export async function verifyApprovalCommit(_options: {
  root: string;
  baseBranch: string;
  itemId: string;
  trust: { allowedSignersPath: string; fingerprint: string };
  tmpDir: string;
}): Promise<ApprovalCommitState> {
  return { state: 'none', tip: '' };
}
