// STUB (RED): replaced in the GREEN commit.
import type { ProbeTargetId } from '../core/security/doctor-report.ts';
import type {
  AgentSettings,
  ProtectedPaths,
  ReadTarget,
  WriteTarget,
} from '../core/security/sandbox-settings.ts';
import type { AgentRun, AgentRunner } from './runner.ts';

export interface ProbeStep {
  index: number;
  target: ProbeTargetId | 'control';
  tool: 'Bash' | 'Read' | 'Grep' | 'Write';
  operation: string;
  path: string | null;
  reaches: string | null;
  command?: string;
  instruction: string;
}
export interface ProbeCanary {
  target: ProbeTargetId | 'control';
  dir: string;
  path: string;
  value: string;
}
export interface ProbeSession {
  steps: ProbeStep[];
  prompt: string;
}
export interface ProbePlan {
  nonce: string;
  probeDir: string;
  mirrorRoot: string;
  mirrorGitDir: string;
  gitDir: string;
  readTargets: ReadTarget[];
  writeTargets: WriteTarget[];
  protectedCanaries: ProbeCanary[];
  mirrorCanaries: ProbeCanary[];
  controlCanary: ProbeCanary;
  symlinks: {
    treatment: { path: string; target: string };
    control: { path: string; target: string };
  };
  keychain: { service: string; account: string; value: string };
  gitArtifacts: string[];
  treatment: ProbeSession;
  control: ProbeSession;
}
export interface LaunchSession {
  settings: AgentSettings;
  argv: string[];
}
export interface ProbeLaunch {
  treatment: LaunchSession;
  control: LaunchSession;
}
export interface KeychainPort {
  add(service: string, account: string, value: string): Promise<boolean>;
  remove(service: string, account: string): Promise<void>;
}
export interface ProbeOutcome {
  plan: ProbePlan;
  treatment: AgentRun;
  control: AgentRun;
  claudeVersion: string | null;
  leftovers: string[];
  staleLeftovers: string[];
}

export function planProbe(_input: {
  protectedPaths: ProtectedPaths;
  nonce: string;
  mirrorRoot: string;
}): ProbePlan {
  return {} as ProbePlan;
}
export function buildControlSettings(treatment: AgentSettings, _plan: ProbePlan): AgentSettings {
  return treatment;
}
export function buildProbeLaunch(input: {
  plan: ProbePlan;
  treatmentSettings: AgentSettings;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
}): ProbeLaunch {
  return {
    treatment: { settings: input.treatmentSettings, argv: [] },
    control: { settings: input.treatmentSettings, argv: [] },
  };
}
export function sweepStaleArtifacts(_input: { readDirs: string[]; gitDir: string }): string[] {
  return [];
}
export async function runSandboxProbe(_input: {
  protectedPaths: ProtectedPaths;
  runner: AgentRunner;
  logDir: string;
  model?: string;
  keychain?: KeychainPort;
  tmpRoot?: string;
}): Promise<ProbeOutcome> {
  throw new Error('not implemented');
}
