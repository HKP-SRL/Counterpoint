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
// scoped to the real requirement", extended by "CLOUDSDK_PROXY_PASSWORD joins the
// sandbox-proxy-login exception"): one of twelve exact proxy names, shaped `url-userinfo`, whose
// host class is `loopback`; and `CLOUDSDK_PROXY_PASSWORD`, only in a listing whose
// `CLOUDSDK_PROXY_ADDRESS` has host class `loopback`. Anything else credential-shaped stays a
// finding, and so does any entry whose host class is `other`.
//
// A `url-userinfo` line carries a fourth field, the host class (`loopback` or `other`) the script
// computed from the value; the host, user and password never leave the command. The
// `CLOUDSDK_PROXY_ADDRESS` line carries one too, computed from that bare host; the address itself
// never leaves the command.

/** The shape words the listing script prints, in the order it tests them (first match wins). */
export const ENV_SHAPES = ['prefix', 'jwt', 'url-userinfo', 'pem', 'opaque', 'plain'] as const;
export type EnvShape = (typeof ENV_SHAPES)[number];

/** The host class of a `url-userinfo` value: `loopback` only for one URL to this machine. */
export const HOST_CLASSES = ['loopback', 'other'] as const;
export type HostClass = (typeof HOST_CLASSES)[number];

/**
 * The one variable whose line carries a host class whatever its shape: the gcloud proxy config's
 * bare host, which the listing classes like a proxy URL's host (01-26 rerun decision).
 */
export const PROXY_ADDRESS_NAME = 'CLOUDSDK_PROXY_ADDRESS';

export interface EnvEntry {
  name: string;
  /** The value's length as the script measured it. The value itself is never seen. */
  length: number;
  shape: EnvShape;
  /** Present exactly when `shape` is `url-userinfo` or the name is PROXY_ADDRESS_NAME. */
  hostClass?: HostClass;
}

export interface EnvListing {
  /** Every well-formed line, in listing order. */
  entries: EnvEntry[];
  /** Non-empty lines that are not `NAME LENGTH SHAPE`, or `NAME LENGTH SHAPE CLASS` where due. */
  malformed: number;
}

const LINE_RE = /^(\S+) ([0-9]+) (prefix|jwt|url-userinfo|pem|opaque|plain)(?: (loopback|other))?$/;

/**
 * Parses the listing. A line is `NAME LENGTH SHAPE`, or `NAME LENGTH SHAPE CLASS` with a class
 * from HOST_CLASSES. The class is due exactly when the shape is `url-userinfo` or the name is
 * PROXY_ADDRESS_NAME. A name has no whitespace and fields are separated by one space. Any other
 * non-empty line counts as malformed: a `url-userinfo` or PROXY_ADDRESS_NAME line without a
 * class, a class on any other line, an unknown class, and a whitespace-only line included.
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
    const name = match[1] as string;
    const shape = match[3] as EnvShape;
    const hostClass = match[4] as HostClass | undefined;
    const classDue = shape === 'url-userinfo' || name === PROXY_ADDRESS_NAME;
    if (classDue !== (hostClass !== undefined)) {
      malformed += 1;
      continue;
    }
    entries.push(
      hostClass === undefined ? { name, length, shape } : { name, length, shape, hostClass },
    );
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
 * `NAME (value: {shape}, {length} chars, host {class})` for an entry that carries a host class (a
 * `url-userinfo` value, or PROXY_ADDRESS_NAME). An entry whose host class is `other` is a finding
 * whatever its shape: a non-loopback proxy address fails the row (01-26 rerun decision). Names,
 * shapes and host classes only, never a value.
 */
export function credentialFindings(entries: readonly EnvEntry[]): string[] {
  const findings: string[] = [];
  for (const entry of entries) {
    if (isCredentialName(entry.name)) findings.push(`${entry.name} (name)`);
    else if (entry.shape !== 'plain' || entry.hostClass === 'other') {
      const host =
        entry.shape === 'url-userinfo' || entry.hostClass !== undefined
          ? `, host ${entry.hostClass ?? 'other'}`
          : '';
      findings.push(`${entry.name} (value: ${entry.shape}, ${entry.length} chars${host})`);
    }
  }
  return findings;
}

/**
 * The owner's one named exception to the credential-env rule, recorded like the Keychain one:
 * named, reasoned, dated, and shown wherever the row is (its evidence, the stored row's
 * `exceptions` field, and a waived WINDOWS.md entry). It covers the sandbox network proxy's own
 * per-session login: Claude Code runs that proxy on this machine, outside the sandbox, and points
 * sandboxed commands at it through the twelve proxy URL variables and the `CLOUDSDK_PROXY_*`
 * gcloud proxy config (ADDRESS, PORT, TYPE, USERNAME, PASSWORD), which it sets after the launch
 * profile's deny entries apply. It describes Claude Code's own sandbox runtime, the same on every
 * machine, so it is not a per-machine terminal record like gh-keychain (01-19).
 *
 * Two STATE.md [Owner] decisions, both 2026-11-10: "Credential-env row scoped to the real
 * requirement" (the twelve proxy URLs, loopback host only) and "CLOUDSDK_PROXY_PASSWORD joins the
 * sandbox-proxy-login exception" (the gcloud proxy password, only beside a loopback
 * `CLOUDSDK_PROXY_ADDRESS`).
 */
export const SANDBOX_PROXY_EXCEPTION = {
  id: 'sandbox-proxy-login',
  reason: "the sandbox's own proxy login, local only",
  recordedAt: '2026-11-10',
  decision:
    "STATE.md [Owner] 2026-11-10: Credential-env row scoped to the real requirement (after 01-26's halt); CLOUDSDK_PROXY_PASSWORD joins the sandbox-proxy-login exception (after 01-26's rerun halt): the CLOUDSDK_PROXY_* gcloud proxy config's password, excepted only when CLOUDSDK_PROXY_ADDRESS has host class loopback",
  /** Excepted only when shaped `url-userinfo` with host class `loopback`. */
  proxyUrlNames: [
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
  /** The gcloud proxy password: excepted only when `requires` is listed with host class `loopback`. */
  gcloudPassword: { name: 'CLOUDSDK_PROXY_PASSWORD', requires: PROXY_ADDRESS_NAME },
} as const;

const EXCEPTED_URL_NAMES: ReadonlySet<string> = new Set(SANDBOX_PROXY_EXCEPTION.proxyUrlNames);

/** Every name the exception can cover: the twelve proxy URL names, then the gcloud password. */
export const SANDBOX_PROXY_EXCEPTION_NAMES: readonly string[] = [
  ...SANDBOX_PROXY_EXCEPTION.proxyUrlNames,
  SANDBOX_PROXY_EXCEPTION.gcloudPassword.name,
];

/**
 * The entries the owner's exception covers, within one listing (no case folding, no prefix match):
 * - an entry named exactly one of the twelve proxy URL names, shaped `url-userinfo`, with host
 *   class `loopback`;
 * - `CLOUDSDK_PROXY_PASSWORD`, only when the same listing holds `CLOUDSDK_PROXY_ADDRESS` with host
 *   class `loopback`. With the address absent or `other`, the password is not excepted.
 * Nothing else qualifies.
 */
export function exceptedEntries(entries: readonly EnvEntry[]): EnvEntry[] {
  const { name: passwordName, requires } = SANDBOX_PROXY_EXCEPTION.gcloudPassword;
  const addressLoopback = entries.some(
    (entry) => entry.name === requires && entry.hostClass === 'loopback',
  );
  return entries.filter(
    (entry) =>
      (EXCEPTED_URL_NAMES.has(entry.name) &&
        entry.shape === 'url-userinfo' &&
        entry.hostClass === 'loopback') ||
      (entry.name === passwordName && addressLoopback),
  );
}

/**
 * credentialFindings over every entry the exception does not cover. The denied name
 * (CREDENTIAL_ENV_DENY) is not in the exception, so it is a finding if present.
 */
export function unexceptedFindings(entries: readonly EnvEntry[]): string[] {
  const excepted = new Set(exceptedEntries(entries));
  return credentialFindings(entries.filter((entry) => !excepted.has(entry)));
}
