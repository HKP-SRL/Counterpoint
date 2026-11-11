// The per-machine accepted-risk record (doctor: Owner-recorded accepted risk; owner decision in
// docs/decisions.md: Keychain reachability accepted, with an explicit recorded doctor exception for
// the gh credentials row).
//
//   {COUNTERPOINT_HOME}/trust/accepted-risks.json
//   { "schema": "counterpoint/accepted-risks/v1",
//     "risks": [{ "id": "gh-keychain", "target": "gh", "subStep": "keychain",
//                 "reason": "<the owner's one line>", "recordedAt": "<ISO datetime>" }] }
//
// The only acceptable risk is `gh-keychain`: a sandboxed agent's shell can read items in the
// macOS Keychain, so gh credentials kept there are reachable. It covers only that Keychain lookup
// (src/core/security/doctor-report.ts `reachedOnlyByKeychain`), never a gh config file or any other
// probe target, and never the Sandbox isolation settings or Agent permission mode checks.
//
// Who writes it: only `counterpoint accept-risk gh-keychain` (src/cli/risk.ts), at a terminal,
// after a typed reason and `y`; a source-scan test (tests/cli/risk.test.ts) keeps every other
// module from calling the writer or the revoker, or from naming the file. The record lives next
// to the pinned key in the trust folder, which agent sandboxes deny for Read and Edit (deny
// twins) and which sandboxed Bash cannot write (Seatbelt). Nothing ships a default record: no
// environment variable, host-repo config or HTTP route creates one, so a fresh home has none.
//
// Reads never throw. The file is opened with O_NOFOLLOW and must be a regular file, not writable
// by group or others, at most 16 KiB, valid JSON and valid against the strict schema; anything
// else is a one-line problem, and callers then treat the home as having no accepted risk (fail
// closed).
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic0600 } from '../fs/atomic.ts';
import { homePaths } from '../host/home.ts';

export const ACCEPTED_RISKS_SCHEMA = 'counterpoint/accepted-risks/v1';

/** Every risk id the owner can accept. Only one exists. */
export const ACCEPTED_RISK_IDS = ['gh-keychain'] as const;
export type AcceptedRiskId = (typeof ACCEPTED_RISK_IDS)[number];

const RECORD_FILE = 'accepted-risks.json';
const MAX_RECORD_BYTES = 16 * 1024;
export const RISK_REASON_MAX = 300;

/** C0, DEL, C1, U+2028 and U+2029. */
function hasControl(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}

/** The owner's reason: after trimming, 1 to 300 characters, no control characters. */
export const RiskReason = z
  .string()
  .trim()
  .refine((text) => {
    const length = [...text].length;
    return length >= 1 && length <= RISK_REASON_MAX && !hasControl(text);
  }, `a one-line reason of 1 to ${RISK_REASON_MAX} characters with no control characters`);

export const AcceptedRisk = z.strictObject({
  id: z.literal('gh-keychain'),
  target: z.literal('gh'),
  subStep: z.literal('keychain'),
  reason: RiskReason,
  recordedAt: z.iso.datetime(),
});
export type AcceptedRisk = z.infer<typeof AcceptedRisk>;

const AcceptedRisksFile = z.strictObject({
  schema: z.literal(ACCEPTED_RISKS_SCHEMA),
  risks: z.array(AcceptedRisk).max(1),
});

export type AcceptedRisksRead =
  | { ok: true; risks: AcceptedRisk[] }
  | { ok: false; problem: string };

function recordPaths(home: string): { dir: string; file: string } {
  const dir = homePaths(home).trustDir;
  return { dir, file: join(dir, RECORD_FILE) };
}

/** The first issue of a failed parse, on one line. */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'it does not match the accepted-risk schema';
  const where = issue.path.length === 0 ? '' : ` at ${issue.path.join('.')}`;
  return `it does not match the accepted-risk schema${where}: ${issue.message}`.replace(
    /[\r\n]+/g,
    ' ',
  );
}

/**
 * Reads the accepted-risk record of this machine. A missing file is no accepted risk. Never
 * throws: any unsafe or invalid file is `ok: false` with a one-line problem.
 */
export function readAcceptedRisks(home: string): AcceptedRisksRead {
  const { dir, file } = recordPaths(home);
  const dirStat = lstatSync(dir, { throwIfNoEntry: false });
  if (dirStat === undefined) return { ok: true, risks: [] };
  if (!dirStat.isDirectory() || (dirStat.mode & 0o022) !== 0) {
    return { ok: false, problem: `${dir} must be a directory writable only by its owner` };
  }
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: true, risks: [] };
    if (code === 'ELOOP') return { ok: false, problem: `${file} is a symlink` };
    return { ok: false, problem: `${file} cannot be opened (${code ?? 'error'})` };
  }
  let text: string;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, problem: `${file} is not a regular file` };
    if ((stat.mode & 0o022) !== 0) {
      return { ok: false, problem: `${file} is writable by group or others` };
    }
    if (stat.size > MAX_RECORD_BYTES) return { ok: false, problem: `${file} is too large` };
    text = readFileSync(fd, 'utf8');
  } catch (error) {
    return { ok: false, problem: `${file} cannot be read (${(error as Error).message})` };
  } finally {
    closeSync(fd);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: `${file} is not valid JSON` };
  }
  const parsed = AcceptedRisksFile.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: `${file}: ${firstIssue(parsed.error)}` };
  return { ok: true, risks: parsed.data.risks };
}

function writeRecordFile(home: string, risks: AcceptedRisk[]): void {
  const { dir, file } = recordPaths(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writeFileAtomic0600(
    file,
    `${JSON.stringify(AcceptedRisksFile.parse({ schema: ACCEPTED_RISKS_SCHEMA, risks }), null, 2)}\n`,
  );
}

/**
 * Records the owner's acceptance of `gh-keychain` with their reason, replacing any earlier entry.
 * Only the terminal command (src/cli/risk.ts) calls this. Throws on an invalid reason.
 */
export function writeAcceptedRisk(
  home: string,
  input: { reason: string; now?: () => Date },
): AcceptedRisk {
  const reason = RiskReason.safeParse(input.reason);
  if (!reason.success) {
    throw new Error(
      `The reason must be one line of 1 to ${RISK_REASON_MAX} characters with no control characters.`,
    );
  }
  const entry = AcceptedRisk.parse({
    id: 'gh-keychain',
    target: 'gh',
    subStep: 'keychain',
    reason: reason.data,
    recordedAt: (input.now ?? (() => new Date()))().toISOString(),
  });
  writeRecordFile(home, [entry]);
  return entry;
}

/**
 * Withdraws an accepted risk. Deletes the file when no entry remains. Returns whether an entry
 * existed. Throws when the record cannot be read, so nothing is changed blindly.
 */
export function revokeAcceptedRisk(home: string, id: AcceptedRiskId): boolean {
  const read = readAcceptedRisks(home);
  if (!read.ok) throw new Error(read.problem);
  const remaining = read.risks.filter((risk) => risk.id !== id);
  if (remaining.length === read.risks.length) return false;
  if (remaining.length === 0) {
    unlinkSync(recordPaths(home).file);
  } else {
    writeRecordFile(home, remaining);
  }
  return true;
}
