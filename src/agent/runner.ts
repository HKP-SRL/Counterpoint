// STUB (RED): replaced in the GREEN commit.
export interface KnownStreamEvent {
  readonly type: string;
  readonly subtype?: string;
  readonly [key: string]: unknown;
}
export interface UnknownStreamEvent {
  readonly type: 'unknown';
  readonly raw: string;
}
export type StreamEvent = KnownStreamEvent | UnknownStreamEvent;
export interface AgentRunRequest {
  argv: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  rawLogPath: string;
}
export interface AgentRun {
  events: StreamEvent[];
  raw: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  result: StreamEvent | null;
}
export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRun>;
  version?(): Promise<string | null>;
}
