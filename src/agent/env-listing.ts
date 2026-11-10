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
// rule is not narrowed: a flagged variable is a finding. Its only exception is the owner's
// SANDBOX_PROXY_EXCEPTION (`sandbox-proxy-login`, STATE.md [Owner] 2026-11-10, "Credential-env row
// scoped to the real requirement"): one of twelve exact proxy names, shaped `url-userinfo`, whose
// host class is `loopback`. Anything else credential-shaped stays a finding.
//
// A `url-userinfo` line carries a fourth field, the host class (`loopback` or `other`) the script
// computed from the value; the host, user and password never leave the command.

/** The shape words the listing script prints, in the order it tests them (first match wins). */
export const ENV_SHAPES = ['prefix', 'jwt', 'url-userinfo', 'pem', 'opaque', 'plain'] as const;
export type EnvShape = (typeof ENV_SHAPES)[number];

/** The host class of a `url-userinfo` value: `loopback` only for one URL to this machine. */
export const HOST_CLASSES = ['loopback', 'other'] as const;
export type HostClass = (typeof HOST_CLASSES)[number];

export interface EnvEntry {
  name: string;
  /** The value's length as the script measured it. The value itself is never seen. */
  length: number;
  shape: EnvShape;
  /** Present exactly when `shape` is `url-userinfo`. */
  hostClass?: HostClass;
}

export interface EnvListing {
  /** Every well-formed line, in listing order. */
  entries: EnvEntry[];
  /** Non-empty lines that are not `NAME LENGTH SHAPE` (or `NAME LENGTH url-userinfo CLASS`). */
  malformed: number;
}

const LINE_RE = /^(\S+) ([0-9]+) (prefix|jwt|pem|opaque|plain)$/;
const URL_LINE_RE = /^(\S+) ([0-9]+) url-userinfo (loopback|other)$/;

/**
 * Parses the listing. A `url-userinfo` line must be `NAME LENGTH url-userinfo CLASS` with a class
 * from HOST_CLASSES; every other non-empty line must be `NAME LENGTH SHAPE` with one of the other
 * five shape words. A name has no whitespace and fields are separated by one space. Any other
 * non-empty line counts as malformed: a `url-userinfo` line without a class, a class after any
 * other shape, an unknown class, and a whitespace-only line included.
 */
export function parseEnvListing(text: string): EnvListing {
  const entries: EnvEntry[] = [];
  let malformed = 0;
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const url = URL_LINE_RE.exec(line);
    const match = url ?? LINE_RE.exec(line);
    const length = match ? Number(match[2]) : Number.NaN;
    if (!match || !Number.isSafeInteger(length)) {
      malformed += 1;
      continue;
    }
    if (url) {
      entries.push({
        name: url[1] as string,
        length,
        shape: 'url-userinfo',
        hostClass: url[3] as HostClass,
      });
    } else {
      entries.push({ name: match[1] as string, length, shape: match[3] as EnvShape });
    }
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
 * `NAME (value: {shape}, {length} chars)` when the value's shape is anything but `plain`, and
 * `NAME (value: url-userinfo, {length} chars, host {class})` for a `url-userinfo` value. Names,
 * shapes and host classes only, never a value.
 */
export function credentialFindings(entries: readonly EnvEntry[]): string[] {
  const findings: string[] = [];
  for (const entry of entries) {
    if (isCredentialName(entry.name)) findings.push(`${entry.name} (name)`);
    else if (entry.shape === 'url-userinfo') {
      findings.push(
        `${entry.name} (value: url-userinfo, ${entry.length} chars, host ${entry.hostClass ?? 'other'})`,
      );
    } else if (entry.shape !== 'plain') {
      findings.push(`${entry.name} (value: ${entry.shape}, ${entry.length} chars)`);
    }
  }
  return findings;
}

/**
 * The owner's one named exception to the credential-env rule (STATE.md [Owner] 2026-11-10,
 * "Credential-env row scoped to the real requirement"), recorded like the Keychain one: named,
 * reasoned, dated, and shown wherever the row is (its evidence, the stored row's `exceptions`
 * field, and a waived WINDOWS.md entry). It covers the sandbox network proxy's own per-session
 * login: Claude Code runs that proxy on this machine, outside the sandbox, and points sandboxed
 * commands at it through these variables. It describes Claude Code's own sandbox runtime, the
 * same on every machine, so it is not a per-machine terminal record like gh-keychain (01-19).
 */
export const SANDBOX_PROXY_EXCEPTION = {
  id: 'sandbox-proxy-login',
  reason: "the sandbox's own proxy login, local only",
  recordedAt: '2026-11-10',
  decision:
    "STATE.md [Owner] 2026-11-10: Credential-env row scoped to the real requirement (after 01-26's halt)",
  names: [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'ALL_PROXY',
    'all_proxy',
    'GRPC_PROXY',
    'grpc_proxy',
    'FTP_PROXY',
    'ftp_proxy',
    'DOCKER_HTTP_PROXY',
    'DOCKER_HTTPS_PROXY',
  ],
} as const;

const EXCEPTED_NAMES: ReadonlySet<string> = new Set(SANDBOX_PROXY_EXCEPTION.names);

/**
 * The entries the owner's exception covers: the name is exactly one of the twelve (no case
 * folding, no prefix match), the shape is `url-userinfo` and the host class is `loopback`.
 * Nothing else qualifies.
 */
export function exceptedEntries(entries: readonly EnvEntry[]): EnvEntry[] {
  return entries.filter(
    (entry) =>
      EXCEPTED_NAMES.has(entry.name) &&
      entry.shape === 'url-userinfo' &&
      entry.hostClass === 'loopback',
  );
}

/**
 * credentialFindings over every entry the exception does not cover. The two denied names
 * (CREDENTIAL_ENV_DENY) are not in the exception, so either one, if present, is a finding.
 */
export function unexceptedFindings(entries: readonly EnvEntry[]): string[] {
  const excepted = new Set(exceptedEntries(entries));
  return credentialFindings(entries.filter((entry) => !excepted.has(entry)));
}
