// RED stub: API only.
export const SSH_KEYGEN = '/usr/bin/ssh-keygen';

export function sshKeygenEnv(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return { ...parent } as Record<string, string>;
}

export async function signPayload(_options: {
  payload: Uint8Array;
  privateKeyPath: string;
  timeoutMs?: number;
}): Promise<string> {
  throw new Error('not implemented');
}

export interface SignatureCheck {
  ok: boolean;
  fingerprint: string | null;
  message: string;
}

export async function verifySignature(_options: {
  allowedSignersPath: string;
  principal: string;
  namespace: string;
  signature: string;
  payload: Uint8Array;
  tmpDir: string;
}): Promise<SignatureCheck> {
  throw new Error('not implemented');
}

export async function fingerprintOf(_pubPath: string): Promise<string> {
  throw new Error('not implemented');
}

export function fingerprintOfKeyBlob(_base64: string): string {
  throw new Error('not implemented');
}
