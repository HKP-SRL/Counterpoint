// The environment listing's parser and the credential-shape rule (01-26, replacement 3 of 3 for
// the scrub opt-out, STATE.md [Owner] 2026-11-10).
//
// The probe's env-shape step runs Counterpoint's own awk program (ENV_SHAPE_AWK in probe.ts) in a
// sandboxed Bash command. For every variable in that command's environment it prints one line,
// `NAME LENGTH SHAPE`, and never a value or any part of one. This module reads such a listing and
// says which entries look like a credential, by name or by value shape.
//
// It is shared by the live listing (tests/agent/probe-env.live.test.ts) and the probe evaluator's
// `credential-env` row, so the live stop rule and the row judge a listing with the same code. It is
// a leaf module on purpose: it imports neither probe.ts nor probe-evaluator.ts (probe.ts imports
// values from the evaluator, so putting this code in probe.ts would make a runtime import cycle).
//
// agentEnv passes only its allow-list (PATH, HOME, USER, LOGNAME, LANG, LC_ALL, TMPDIR, SHELL), so
// a credential-shaped variable in a sandboxed Bash environment came from Claude Code itself. The
// rule is not narrowed and has no per-name exception: a flagged variable is a finding.

/** The shape words the listing script prints, in the order it tests them (first match wins). */
export const ENV_SHAPES = ['prefix', 'jwt', 'url-userinfo', 'pem', 'opaque', 'plain'] as const;
export type EnvShape = (typeof ENV_SHAPES)[number];

export interface EnvEntry {
  name: string;
  /** The value's length as the script measured it. The value itself is never seen. */
  length: number;
  shape: EnvShape;
}

export interface EnvListing {
  /** Every well-formed line, in listing order. */
  entries: EnvEntry[];
  /** Non-empty lines that are not `NAME LENGTH SHAPE`. */
  malformed: number;
}

const LINE_RE = /^(\S+) ([0-9]+) (prefix|jwt|url-userinfo|pem|opaque|plain)$/;

/**
 * Parses the listing. Each non-empty line must be a name without whitespace, one space, a
 * decimal length, one space and one of the six shape words; any other non-empty line (a
 * whitespace-only line included) counts as malformed.
 */
export function parseEnvListing(text: string): EnvListing {
  const entries: EnvEntry[] = [];
  let malformed = 0;
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const match = LINE_RE.exec(line);
    const length = match ? Number(match[2]) : Number.NaN;
    if (!match || !Number.isSafeInteger(length)) {
      malformed += 1;
      continue;
    }
    entries.push({ name: match[1] as string, length, shape: match[3] as EnvShape });
  }
  return { entries, malformed };
}

/** Name segments that mark a credential (after upper-casing and splitting on non-alphanumerics). */
const CREDENTIAL_SEGMENTS: ReadonlySet<string> = new Set([
  'TOKEN',
  'TOKENS',
  'SECRET',
  'SECRETS',
  'PASSWORD',
  'PASSWORDS',
  'PASSWD',
  'PASS',
  'PASSPHRASE',
  'CREDENTIAL',
  'CREDENTIALS',
  'CREDS',
  'KEY',
  'KEYS',
  'APIKEY',
  'AUTH',
  'OAUTH',
  'COOKIE',
  'COOKIES',
  'ASKPASS',
  'PAT',
]);

/** Substrings that mark a credential anywhere in the upper-cased name. */
const CREDENTIAL_SUBSTRINGS: readonly string[] = [
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'PASSPHRASE',
  'CREDENTIAL',
  'APIKEY',
  'ASKPASS',
];

/**
 * True when the variable's name marks it as a credential: an upper-cased segment (split on every
 * non-alphanumeric character) is a credential word, or the upper-cased name contains a credential
 * substring. `SSH_AUTH_SOCK` is flagged (an agent socket); `PWD`, `GIT_AUTHOR_NAME` and
 * `CLAUDE_CODE_SESSION_ID` are not.
 */
export function isCredentialName(name: string): boolean {
  const upper = name.toUpperCase();
  if (upper.split(/[^A-Z0-9]+/).some((segment) => CREDENTIAL_SEGMENTS.has(segment))) return true;
  return CREDENTIAL_SUBSTRINGS.some((part) => upper.includes(part));
}

/**
 * One finding per credential-shaped entry: `NAME (name)` when the name is flagged, else
 * `NAME (value: {shape}, {length} chars)` when the value's shape is anything but `plain`. Names
 * and shapes only, never a value.
 */
export function credentialFindings(entries: readonly EnvEntry[]): string[] {
  const findings: string[] = [];
  for (const entry of entries) {
    if (isCredentialName(entry.name)) findings.push(`${entry.name} (name)`);
    else if (entry.shape !== 'plain') {
      findings.push(`${entry.name} (value: ${entry.shape}, ${entry.length} chars)`);
    }
  }
  return findings;
}
