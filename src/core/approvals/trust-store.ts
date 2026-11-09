// RED stub: API only.
export const OWNER_PRINCIPAL = 'owner@counterpoint';

export interface Trust {
  allowedSignersPath: string;
  fingerprint: string;
  principal: string;
  privateKeyPath: string;
  publicKeyPath: string;
}

export type TrustFailure = {
  ok: false;
  error: 'no-trusted-key' | 'bad-allowed-signers' | 'fingerprint-mismatch';
  detail: string;
};

export type TrustResult = ({ ok: true } & Trust) | TrustFailure;

export type AllowedSignersProblem =
  | 'missing'
  | 'unsafe-file'
  | 'empty'
  | 'multiple-keys'
  | 'principal'
  | 'format'
  | 'fingerprint-mismatch';

export function checkAllowedSignersFile(
  _path: string,
  _pinnedFingerprint: string,
): { ok: true } | { ok: false; problem: AllowedSignersProblem; detail: string } {
  return { ok: true };
}

export async function writeTrust(
  _home: string,
  _options: { publicKeyPath: string },
): Promise<Trust> {
  throw new Error('not implemented');
}

export function readTrust(_home: string): TrustResult {
  throw new Error('not implemented');
}
