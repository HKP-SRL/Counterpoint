// RED stub: replaced in GREEN.
export interface HostRecord {
  id: string;
  root: string;
  gitCommonDir: string;
  baseBranch: string;
  adapter: string;
}
export interface HostRegistryStore {
  listHosts(): readonly HostRecord[];
  upsertHost(host: HostRecord): void;
}
export async function detectBaseBranch(_root: string): Promise<string | null> {
  throw new Error('not implemented');
}
export async function registerHost(
  _store: HostRegistryStore,
  _opts: {
    cwd: string;
    base?: string;
    detectFramework: (root: string, baseBranch: string) => string | Promise<string>;
  },
): Promise<HostRecord> {
  throw new Error('not implemented');
}
