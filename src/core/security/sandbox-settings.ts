// STUB (RED): replaced in the GREEN commit.
export interface ProtectedPaths {
  homeDir: string;
  counterpointHome: string;
  signingKeyDir: string;
  ghConfigDir: string;
  hostGitDir: string;
  workdir?: string;
}
export interface AgentSettings {
  permissions: { deny: string[]; allow?: string[]; additionalDirectories?: string[] };
  sandbox: {
    enabled: boolean;
    failIfUnavailable: boolean;
    allowUnsandboxedCommands: boolean;
    excludedCommands?: string[];
    filesystem: { denyRead: string[]; denyWrite: string[]; allowWrite: string[] };
  };
}
export interface SandboxTarget {
  id: string;
  mode: 'read' | 'write';
  path: string;
}
export function buildAgentSandboxSettings(_paths: ProtectedPaths): {
  settings: AgentSettings;
  readTargets: SandboxTarget[];
  writeTargets: SandboxTarget[];
} {
  return {
    settings: {
      permissions: { deny: [] },
      sandbox: {
        enabled: false,
        failIfUnavailable: false,
        allowUnsandboxedCommands: true,
        filesystem: { denyRead: [], denyWrite: [], allowWrite: [] },
      },
    },
    readTargets: [],
    writeTargets: [],
  };
}
