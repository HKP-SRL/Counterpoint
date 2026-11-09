// RED stub: replaced in GREEN.
export class HomeMissingError extends Error {
  readonly path: string = '';
}
export function resolveHome(_env?: NodeJS.ProcessEnv, _platform?: NodeJS.Platform): string {
  return '';
}
export function requireHome(_env?: NodeJS.ProcessEnv, _platform?: NodeJS.Platform): string {
  return '';
}
export function homePaths(_home: string): Record<string, string> {
  return {};
}
export function hostDir(_home: string, _hostId: string): string {
  return '';
}
export function readConfig(_home: string): { port: number } {
  return { port: 0 };
}
