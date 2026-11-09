// Owner setup commands (APPR-04). RED stub.

export interface TrustCommandOptions {
  isTTY: boolean;
  confirm: (question: string) => Promise<string>;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export function initKeyCommand(_out: (line: string) => void = console.log): void {}

export async function trustKeyCommand(
  _home: string,
  _pubPath: string,
  _options: TrustCommandOptions,
): Promise<number> {
  return 0;
}

export async function trustHostCommand(
  _home: string,
  _hostId: string,
  _options: TrustCommandOptions,
): Promise<number> {
  return 0;
}
