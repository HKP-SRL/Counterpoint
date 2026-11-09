// The approval-input rule (D-02). The adapter owns "which files does approving a phase cover", so
// core stays framework-agnostic and only ever sees ApprovalInput values.
//
// The inputs of phase NN are, at one commit:
//   - from the phase directory listing only (no recursion), names matching exactly
//     `NN-CONTEXT.md`, `NN-MM-PLAN.md`, `NN-RESEARCH.md`, `NN-UI-SPEC.md`, `NN-SPEC.md`,
//     `NN-AI-SPEC.md` — read as exact committed bytes;
//   - the phase's ROADMAP section as a virtual input, normalized with
//     `cp-gsd-roadmap-section/v1` so progress bookkeeping does not change its digest.
// SUMMARY, VERIFICATION, UAT, DISCUSSION-LOG, PATTERNS, VALIDATION, PERMISSION-MATRIX and other
// phases' files are never inputs. Inputs are sorted by path bytes. Every input names the
// repository file it comes from (`sourcePath`).
//
// Unsafe entries are refused, not skipped: the reader throws UnsafeTreeEntryError for a symlink
// or a blob over 5 MiB, so an approval can never silently cover less than it claims.
import {
  type ApprovalInput,
  type ApprovalInputKind,
  comparePhaseNumbers,
  formatPhaseId,
  type GitFileReader,
  PhaseNotFoundError,
} from '../../core/framework/port.ts';
import { assertPhaseId } from '../../core/ids.ts';
import { listPhaseDirs, ROADMAP_NAME, ROADMAP_PATH } from './layout.ts';
import { normalizeRoadmapSection, ROADMAP_SECTION_NORMALIZER } from './normalize.ts';
import { parseRoadmap } from './roadmap.ts';

const DOC_KINDS = {
  RESEARCH: 'research',
  'UI-SPEC': 'ui-spec',
  SPEC: 'spec',
  'AI-SPEC': 'ai-spec',
} as const satisfies Record<string, ApprovalInputKind>;

const INPUT_RULES: ReadonlyArray<{
  re: RegExp;
  kind: (match: RegExpExecArray) => ApprovalInputKind;
}> = [
  { re: /^\d+(\.\d+)?-CONTEXT\.md$/, kind: () => 'context' },
  { re: /^\d+(\.\d+)?-\d+-PLAN\.md$/, kind: () => 'plan' },
  {
    re: /^\d+(\.\d+)?-(RESEARCH|UI-SPEC|SPEC|AI-SPEC)\.md$/,
    kind: (match) => DOC_KINDS[match[2] as keyof typeof DOC_KINDS],
  },
];

function inputKind(name: string): ApprovalInputKind | null {
  for (const rule of INPUT_RULES) {
    const match = rule.re.exec(name);
    if (match) return rule.kind(match);
  }
  return null;
}

async function readText(
  reader: GitFileReader,
  commit: string,
  path: string,
): Promise<string | null> {
  const bytes = await reader.read(commit, path);
  return bytes === null ? null : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function approvalInputs(
  reader: GitFileReader,
  commit: string,
  phaseId: string,
): Promise<ApprovalInput[]> {
  assertPhaseId(phaseId);

  const roadmap = await readText(reader, commit, ROADMAP_PATH);
  if (roadmap === null) throw new PhaseNotFoundError(phaseId);
  // The first heading for a phase wins, as in the snapshot.
  const phase = parseRoadmap(roadmap).find((p) => formatPhaseId(p.number) === phaseId);
  if (!phase) throw new PhaseNotFoundError(phaseId);

  const inputs: ApprovalInput[] = [
    {
      path: `${ROADMAP_PATH}#phase-${phaseId}`,
      sourcePath: ROADMAP_PATH,
      label: `${ROADMAP_NAME} · Phase ${phaseId} section`,
      kind: 'roadmap-section',
      normalization: ROADMAP_SECTION_NORMALIZER,
      bytes: new TextEncoder().encode(normalizeRoadmapSection(phase.sectionText)),
    },
  ];

  const dir = (await listPhaseDirs(reader, commit)).find(
    (d) => comparePhaseNumbers(d.number, phase.number) === 0,
  );
  if (dir) {
    for (const entry of await reader.list(commit, dir.path)) {
      // Symlinks are listed as blobs (mode 120000) and refused by reader.read below.
      if (entry.type !== 'blob') continue;
      const kind = inputKind(entry.name);
      if (kind === null) continue;
      const bytes = await reader.read(commit, entry.path);
      if (bytes === null) throw new Error(`Input ${entry.path} disappeared while reading.`);
      inputs.push({
        path: entry.path,
        sourcePath: entry.path,
        label: entry.name,
        kind,
        normalization: null,
        bytes,
      });
    }
  }

  return inputs.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
