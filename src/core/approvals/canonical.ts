// Canonical JSON (stub for the RED step).
export function canonicalJson(value: unknown, _rootPath = '$'): string {
  return JSON.stringify(value) ?? '';
}
