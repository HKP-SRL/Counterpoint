// Identifier rules the console checks before an id from the address bar or the API is used in a
// path, a link or a displayed command. They mirror src/core/ids.ts (the console bundle does not
// import server code).

/** Host ids: lowercase slug, 1-32 characters, never starting with a dash. */
export const HOST_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Change ids: the change's kebab-case directory name, at most 64 characters, never `archive`. */
const CHANGE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHANGE_ID_MAX = 64;

export function isChangeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= CHANGE_ID_MAX &&
    CHANGE_ID_RE.test(value) &&
    value !== 'archive'
  );
}
