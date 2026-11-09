// `counterpoint approve {host} {phase}` (stub for the RED step).
export interface ApproveCommandOptions {
  home: string;
  hostId: string;
  phaseId: string;
  isTTY: boolean;
  out?: (line: string) => void;
  err?: (line: string) => void;
  sign?: (payload: Uint8Array) => Promise<string>;
  notify?: (home: string, body: { hostId: string; family: 'approval' }) => Promise<void>;
}
export async function approveCommand(_options: ApproveCommandOptions): Promise<number> {
  return 0;
}
