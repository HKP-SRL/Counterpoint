// The approval statement (APPR-02): the file a runway approval signs, committed at
// `.counterpoint/approvals/phase-{NN}.json` on the base branch.
//
// Format chosen by the owner at the 01-12 checkpoint (option "item4", RESEARCH Item 4), frozen
// from the first real approval on:
//
//   schema  counterpoint/approval/v1
//   kind    runway
//   host    the host id
//   item    { type: phase, id: NN }
//   base    { branch, commit }            the base branch and the tip the statement was built at
//   inputs  { algorithm: sha256, files: [{ path, kind, digest, normalization? }], combined }
//   draft   { state: none, digest: null } filled by a later phase without a schema change
//   gates   { state: absent | present, digest }
//
// Each file digest is `sha256:` + hex of the input's exact bytes as committed (a derived input is
// digested after its named normalizer). Files are sorted by path bytes; `combined` is the sha256
// of the canonical JSON of the files array, so listing order never changes it. The file on disk
// is pretty JSON with sorted keys and a trailing LF; there is no preparation timestamp, so the
// same inputs at the same tip always give byte-identical bytes and the same fingerprint.
import { z } from 'zod';
import type { ApprovalInput, ApprovalInputKind } from '../framework/port.ts';
import { approvalItemId, assertHostId, assertPhaseId, HOST_ID_RE, PHASE_ID_RE } from '../ids.ts';
import { canonicalJson, prettyCanonicalJson } from './canonical.ts';
import { BRANCH_RE } from './commit.ts';
import { sha256Digest } from './digest.ts';

export const APPROVAL_SCHEMA = 'counterpoint/approval/v1';

/** Where approvals live in the host repository. */
export const APPROVALS_DIR = '.counterpoint/approvals';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const NORMALIZER_RE = /^[a-z0-9][a-z0-9./-]{0,63}$/;
// Repository-relative path or logical input id: printable, no control characters, bounded.
function isInputPath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

const INPUT_KINDS = [
  'context',
  'plan',
  'research',
  'ui-spec',
  'spec',
  'ai-spec',
  'roadmap-section',
] as const satisfies readonly ApprovalInputKind[];

const Digest = z.string().regex(DIGEST_RE);

const StatementFile = z.strictObject({
  path: z.string().refine(isInputPath, 'Not a valid input path.'),
  kind: z.enum(INPUT_KINDS),
  digest: Digest,
  normalization: z.string().regex(NORMALIZER_RE).optional(),
});
export type StatementFile = z.infer<typeof StatementFile>;

export const GATES_ABSENT = Object.freeze({ state: 'absent', digest: null } as const);

const GatesSlot = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('absent'), digest: z.null() }),
  z.strictObject({ state: z.literal('present'), digest: Digest }),
]);
export type GatesSlot = z.infer<typeof GatesSlot>;

function comparePathBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** The combined digest: sha256 of the canonical JSON of the (sorted) files array. */
export function combinedDigest(files: readonly StatementFile[]): string {
  return sha256Digest(canonicalJson(files));
}

/** Strict schema for a statement read back from history (untrusted input). */
export const ApprovalStatement = z
  .strictObject({
    schema: z.literal(APPROVAL_SCHEMA),
    kind: z.literal('runway'),
    host: z.string().regex(HOST_ID_RE),
    item: z.strictObject({ type: z.literal('phase'), id: z.string().regex(PHASE_ID_RE) }),
    base: z.strictObject({
      branch: z.string().regex(BRANCH_RE),
      commit: z.string().regex(COMMIT_RE),
    }),
    inputs: z.strictObject({
      algorithm: z.literal('sha256'),
      files: z.array(StatementFile).min(1).max(1000),
      combined: Digest,
    }),
    draft: z.strictObject({ state: z.literal('none'), digest: z.null() }),
    gates: GatesSlot,
  })
  .superRefine((statement, ctx) => {
    const files = statement.inputs.files;
    for (let i = 1; i < files.length; i++) {
      if (
        comparePathBytes((files[i - 1] as StatementFile).path, (files[i] as StatementFile).path) >=
        0
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['inputs', 'files', i, 'path'],
          message: 'Files must be sorted by path bytes, without duplicates.',
        });
        return;
      }
    }
    if (combinedDigest(files) !== statement.inputs.combined) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', 'combined'],
        message: 'The combined digest does not match the files.',
      });
    }
  });
export type ApprovalStatement = z.infer<typeof ApprovalStatement>;

/** The statement file entries for a set of inputs: digested, sorted by path bytes. */
export function statementFiles(
  inputs: readonly Pick<ApprovalInput, 'path' | 'kind' | 'normalization' | 'bytes'>[],
): StatementFile[] {
  const files = inputs.map((input) => {
    const file: StatementFile = {
      path: input.path,
      kind: input.kind,
      digest: sha256Digest(input.bytes),
    };
    if (input.normalization !== null) file.normalization = input.normalization;
    return file;
  });
  files.sort((a, b) => comparePathBytes(a.path, b.path));
  for (let i = 1; i < files.length; i++) {
    if ((files[i - 1] as StatementFile).path === (files[i] as StatementFile).path) {
      throw new Error(`Two approval inputs share the path ${JSON.stringify(files[i]?.path)}.`);
    }
  }
  return files;
}

/** The approval file path for a phase: `.counterpoint/approvals/phase-{NN}.json`. */
export function approvalPath(phaseId: string): string {
  return `${APPROVALS_DIR}/${approvalItemId(phaseId)}.json`;
}

export function buildStatement(options: {
  hostId: string;
  phaseId: string;
  baseBranch: string;
  tip: string;
  inputs: readonly Pick<ApprovalInput, 'path' | 'kind' | 'normalization' | 'bytes'>[];
  gates: GatesSlot;
}): ApprovalStatement {
  const files = statementFiles(options.inputs);
  const statement: ApprovalStatement = {
    schema: APPROVAL_SCHEMA,
    kind: 'runway',
    host: assertHostId(options.hostId),
    item: { type: 'phase', id: assertPhaseId(options.phaseId) },
    base: { branch: options.baseBranch, commit: options.tip },
    inputs: { algorithm: 'sha256', files, combined: combinedDigest(files) },
    draft: { state: 'none', digest: null },
    gates:
      options.gates.state === 'absent'
        ? { state: 'absent', digest: null }
        : { state: 'present', digest: options.gates.digest },
  };
  // Validate what we are about to sign with the same strict schema the verifier uses.
  return ApprovalStatement.parse(statement);
}

/** The statement file text: pretty JSON (2 spaces) with keys sorted recursively and a final LF. */
export function serializeStatement(statement: ApprovalStatement): string {
  return `${prettyCanonicalJson(statement, 2)}\n`;
}

/** The first 12 hex characters of sha256(canonical JSON of the statement). */
export function statementFingerprint(statement: ApprovalStatement): string {
  return sha256Digest(canonicalJson(statement)).slice(7, 19);
}
