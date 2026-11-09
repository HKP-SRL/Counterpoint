// The probe evaluator (FOUND-04, RESEARCH "doctor live probe design" steps 3 and 6): a pure
// function from the two probe sessions' stream-json events to one Blocked / Reachable /
// Not checked verdict per probe target. It is written so that it cannot false-pass.
//
// Evidence comes only from structured stream events: the `tool_use` blocks (did the session
// really attempt the step), their `tool_result` blocks (what happened), the `tool_result_meta`
// permission decision, `system/permission_denied` events and `result.permission_denials`. The
// model's prose and a bare `is_error` never decide anything, except that a canary value anywhere
// in the treatment stream (prose included) makes its target Reachable.
//
// A target is Blocked only when every treatment step for it was denied by our rules or by the OS
// sandbox AND the matching control step (same index, tool and operation, against the target's
// mirror canary) reached it. Anything else, including a skipped step, a mode-based denial, an
// unrecognised message and a control session that could not reach its mirror, is Not checked.
//
// The denial texts are the ones claude MATCHER_CLAUDE_VERSION prints (verified live in 01-04 and
// 01-05). Update the families together with MATCHER_CLAUDE_VERSION when Claude Code changes its
// messages; until then another version that prints anything unfamiliar reads Not checked.
import {
  PROBE_TARGET_IDS,
  type ProbeResult,
  type ProbeTarget,
  type ProbeTargetId,
  probeTargetLabel,
  probeTargetMode,
} from '../core/security/doctor-report.ts';
import type { ProbePlan, ProbeStep, StepOperation } from './probe.ts';
import type { StreamEvent } from './runner.ts';

/** The claude version the denial-text families below were verified against. */
export const MATCHER_CLAUDE_VERSION = '2.1.319';

export type StepClass =
  | 'reached'
  | 'denied-rule'
  | 'denied-os'
  | 'denied-mode'
  | 'skipped'
  | 'unknown';

// --- Denial-text families (claude 2.1.319) ---------------------------------------------------

/** Mode family: a denial by the permission mode, not by any rule of ours (RESEARCH R2). */
const MODE_FAMILY_TEXT = "running in don't ask mode";
/** Rule family, Read and Write tools. */
const RULE_FILE_TEXT = 'File is in a directory that is denied by your permission settings.';
/** Rule family, Grep and Read through a symlink: `Permission to read <path> has been denied.` */
const RULE_READ_RE = /^Permission to read ([\s\S]+) has been denied\.$/;
/** Rule family, Bash (Read/Edit deny rules applied to the command before the sandbox runs). */
const RULE_BASH_RE = /^Permission to use Bash with command ([\s\S]+) has been denied\.$/;
/** OS family: the Seatbelt sandbox refused the syscall (`Operation not permitted`). */
const OS_FAMILY_TEXT = 'Operation not permitted';
/** `permission_decision.reason_type` values that mean "our deny rules decided". */
const RULE_REASON_TYPES: ReadonlySet<string> = new Set(['rule', 'subcommandResults']);

const READ_OPERATIONS: ReadonlySet<StepOperation> = new Set([
  'cat',
  'read',
  'grep',
  'read-symlink',
  'keychain',
  'read-before-edit',
]);

/** Case-folded, with typographic apostrophes made plain, for family matching. */
function folded(text: string): string {
  return text.replace(/[\u2018\u2019]/g, "'").toLowerCase();
}

// --- Stream access -------------------------------------------------------------------------------

interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResult {
  text: string;
  /** The whole user event serialised, for the value check (tool_use_result included). */
  haystack: string;
  isError: boolean | undefined;
  decision: { decision: string; reasonType: string } | null;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function contentBlocks(event: StreamEvent): Json[] {
  const message = (event as Json).message;
  if (!isObject(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isObject);
}

function toolUses(events: readonly StreamEvent[]): ToolUse[] {
  const uses: ToolUse[] = [];
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    for (const block of contentBlocks(event)) {
      if (block.type !== 'tool_use' || typeof block.id !== 'string') continue;
      uses.push({
        id: block.id,
        name: String(block.name),
        input: isObject(block.input) ? block.input : {},
      });
    }
  }
  return uses;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(isObject)
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('\n');
  }
  return '';
}

function toolResult(events: readonly StreamEvent[], id: string): ToolResult | null {
  for (const event of events) {
    if (event.type !== 'user') continue;
    const block = contentBlocks(event).find(
      (b) => b.type === 'tool_result' && b.tool_use_id === id,
    );
    if (!block) continue;
    const text = resultText(block.content)
      .replace(/^<tool_use_error>/, '')
      .replace(/<\/tool_use_error>$/, '')
      .trim();
    let decision: ToolResult['decision'] = null;
    const meta = (event as Json).tool_result_meta;
    if (Array.isArray(meta)) {
      const entry = meta.filter(isObject).find((m) => m.id === id);
      const pd = entry?.permission_decision;
      if (isObject(pd)) {
        decision = { decision: String(pd.decision), reasonType: String(pd.reason_type) };
      }
    }
    return {
      text,
      haystack: JSON.stringify(event),
      isError: typeof block.is_error === 'boolean' ? block.is_error : undefined,
      decision,
    };
  }
  return null;
}

/** Tool-use ids listed in the session's `result.permission_denials`. */
function deniedIds(events: readonly StreamEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== 'result') continue;
    const denials = (event as Json).permission_denials;
    if (!Array.isArray(denials)) continue;
    for (const denial of denials) {
      if (isObject(denial) && typeof denial.tool_use_id === 'string') ids.add(denial.tool_use_id);
    }
  }
  return ids;
}

/** `system/permission_denied` reason types by tool-use id. */
function deniedEventReasons(events: readonly StreamEvent[]): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const event of events) {
    if (event.type !== 'system' || event.subtype !== 'permission_denied') continue;
    const id = (event as Json).tool_use_id;
    if (typeof id === 'string') reasons.set(id, String((event as Json).decision_reason_type));
  }
  return reasons;
}

/** True when the tool call is the planned step (right tool, right command, path or pattern). */
function matchesStep(step: ProbeStep, use: ToolUse): boolean {
  if (use.name !== step.tool) return false;
  switch (step.tool) {
    case 'Bash':
      return (
        typeof use.input.command === 'string' && use.input.command.includes(step.command ?? '\0')
      );
    case 'Grep':
      return use.input.path === step.path && use.input.pattern === step.pattern;
    case 'Read':
    case 'Write':
    case 'Edit':
      return use.input.file_path === step.path;
  }
}

// --- Step classification -------------------------------------------------------------------------

function classifyUse(
  step: ProbeStep,
  use: ToolUse,
  events: readonly StreamEvent[],
  expectedValue: string | undefined,
): StepClass {
  const result = toolResult(events, use.id);
  if (!result) return 'unknown';
  const { text, decision } = result;

  // A canary value in the result is a reach, whatever else the result says.
  if (expectedValue !== undefined && result.haystack.includes(expectedValue)) return 'reached';

  // Mode family: never ours, so never Blocked.
  if (folded(text).includes(folded(MODE_FAMILY_TEXT))) return 'denied-mode';
  if (decision?.decision === 'reject' && !RULE_REASON_TYPES.has(decision.reasonType)) {
    return decision.reasonType === 'mode' ? 'denied-mode' : 'unknown';
  }

  // Rule family: the text, the permission_denials record, the permission decision and (when
  // present) the permission_denied event must all agree.
  if (isRuleText(step, use, text)) {
    const eventReason = deniedEventReasons(events).get(use.id);
    const agreed =
      result.isError === true &&
      deniedIds(events).has(use.id) &&
      decision?.decision === 'reject' &&
      RULE_REASON_TYPES.has(decision.reasonType) &&
      (eventReason === undefined || RULE_REASON_TYPES.has(eventReason));
    return agreed ? 'denied-rule' : 'unknown';
  }

  // OS family: the command ran and the sandbox refused the step's own path.
  if (
    step.tool === 'Bash' &&
    result.isError === true &&
    step.path !== null &&
    folded(text).includes(folded(OS_FAMILY_TEXT)) &&
    text.includes(step.path)
  ) {
    return 'denied-os';
  }

  // Success. A read reaches only by showing its canary value (checked above).
  if (READ_OPERATIONS.has(step.operation)) {
    if (expectedValue !== undefined) return 'unknown';
    return result.isError === false || (result.isError === undefined && text !== '')
      ? 'reached'
      : 'unknown';
  }
  if (step.tool === 'Bash') return result.isError === false ? 'reached' : 'unknown';
  if (
    result.isError !== true &&
    /^(File created successfully at: |The file .+ has been updated successfully)/.test(text)
  ) {
    return 'reached';
  }
  return 'unknown';
}

function isRuleText(step: ProbeStep, use: ToolUse, text: string): boolean {
  if (
    (step.tool === 'Read' || step.tool === 'Write' || step.tool === 'Edit') &&
    text === RULE_FILE_TEXT
  ) {
    return true;
  }
  if (step.tool === 'Read' || step.tool === 'Grep') {
    const match = RULE_READ_RE.exec(text);
    const target = step.tool === 'Read' ? use.input.file_path : use.input.path;
    return match !== null && match[1] === target;
  }
  if (step.tool === 'Bash') {
    const match = RULE_BASH_RE.exec(text);
    return match !== null && match[1] === use.input.command;
  }
  return false;
}

/** Severity order when a step was attempted more than once: the least favourable wins. */
const CLASS_ORDER: readonly StepClass[] = [
  'reached',
  'unknown',
  'denied-mode',
  'skipped',
  'denied-os',
  'denied-rule',
];

/**
 * Classifies one planned step from a session's events. `expectedValue` is the canary value the
 * step would show if it reached its file (or Keychain item); without it a read counts as reached
 * on any successful result.
 */
export function classifyStep(
  step: ProbeStep,
  events: readonly StreamEvent[],
  expectedValue?: string,
): StepClass {
  const uses = toolUses(events).filter((use) => matchesStep(step, use));
  if (uses.length === 0) return 'skipped';
  const classes = new Set(uses.map((use) => classifyUse(step, use, events, expectedValue)));
  return CLASS_ORDER.find((c) => classes.has(c)) ?? 'unknown';
}

// --- Target verdicts -----------------------------------------------------------------------------

export interface EvaluateProbeOptions {
  /** `claude --version` output (for example `2.1.319 (Claude Code)`), or null if unreadable. */
  claudeVersion: string | null;
  /** Probe-named files found in the real git dir after the treatment session. */
  leftovers: readonly string[];
  /** Read targets whose directory did not exist, so no canary was planted. */
  skippedTargets?: readonly ProbeTargetId[];
  /** Host display name for the `{host} .git/config` label. */
  hostName?: string;
}

/** The `x.y.z` part of a `claude --version` string, or null. */
export function matcherVersionOf(version: string | null): string | null {
  return /\b(\d+\.\d+\.\d+)\b/.exec(version ?? '')?.[1] ?? null;
}

const OPERATION_LABEL: Readonly<Record<StepOperation, string>> = {
  cat: 'Bash cat',
  read: 'Read',
  grep: 'Grep',
  'read-symlink': 'Read via symlink',
  keychain: 'Bash Keychain lookup',
  append: 'Bash append',
  touch: 'Bash touch',
  write: 'Write',
  'read-before-edit': 'Read before Edit',
  edit: 'Edit',
};

const CLASS_LABEL: Readonly<Record<StepClass, string>> = {
  reached: 'reached',
  'denied-rule': 'denied by permission rule',
  'denied-os': 'Operation not permitted (sandbox)',
  'denied-mode': 'denied by the permission mode, not a rule',
  skipped: 'not attempted',
  unknown: 'unrecognised result',
};

const KEYCHAIN_NOTE =
  "the Keychain sub-step used a temporary canary item as a proxy for the owner's gh keyring entry";

function serialise(events: readonly StreamEvent[]): string {
  return events
    .map((e) => (e.type === 'unknown' && 'raw' in e ? e.raw : JSON.stringify(e)))
    .join('\n');
}

function isInsideDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/**
 * Turns both probe sessions into one verdict per probe target, in PROBE_TARGET_IDS order, in the
 * doctor report's ProbeTarget shape.
 */
export function evaluateProbe(
  plan: ProbePlan,
  treatment: readonly StreamEvent[],
  control: readonly StreamEvent[],
  options: EvaluateProbeOptions,
): ProbeTarget[] {
  const version = matcherVersionOf(options.claudeVersion);
  const skipped = new Set(options.skippedTargets ?? []);

  // Canary values by the path a step finally reaches.
  const treatmentValues = new Map<string, string>();
  const controlValues = new Map<string, string>();
  for (const canary of plan.protectedCanaries) treatmentValues.set(canary.path, canary.value);
  for (const canary of plan.mirrorCanaries) controlValues.set(canary.path, canary.value);
  treatmentValues.set(plan.controlCanary.path, plan.controlCanary.value);
  controlValues.set(plan.controlCanary.path, plan.controlCanary.value);

  const valueFor = (step: ProbeStep, values: Map<string, string>): string | undefined => {
    if (step.operation === 'keychain') return plan.keychain.value;
    // The outside Edit file holds the `before` marker in both sessions.
    if (step.operation === 'read-before-edit') return plan.outside.before;
    if (!READ_OPERATIONS.has(step.operation) || step.reaches === null) return undefined;
    // A read step with no known canary value can never count as reached by value.
    return values.get(step.reaches) ?? `\0no-canary:${step.reaches}`;
  };

  const tClass = new Map<number, StepClass>();
  const cClass = new Map<number, StepClass>();
  for (const step of plan.treatment.steps) {
    tClass.set(step.index, classifyStep(step, treatment, valueFor(step, treatmentValues)));
  }
  for (const step of plan.control.steps) {
    cClass.set(step.index, classifyStep(step, control, valueFor(step, controlValues)));
  }

  const anyUnknown = [...tClass.values(), ...cClass.values()].includes('unknown');
  const versionDistrust = version !== MATCHER_CLAUDE_VERSION && anyUnknown;
  const controlSteps = (steps: readonly ProbeStep[], classes: Map<number, StepClass>) =>
    steps.filter((s) => s.target === 'control').every((s) => classes.get(s.index) === 'reached');
  const baselineOk =
    controlSteps(plan.treatment.steps, tClass) && controlSteps(plan.control.steps, cClass);
  const treatmentRaw = serialise(treatment);

  return PROBE_TARGET_IDS.map((id): ProbeTarget => {
    const readTarget = plan.readTargets.find((t) => t.id === id);
    const writeTarget = plan.writeTargets.find((t) => t.id === id);
    const mode = probeTargetMode(id);
    const outsideRow = id === 'outside-workdir';
    const row = (result: ProbeResult, evidence: string): ProbeTarget => ({
      id,
      label: probeTargetLabel(id, options.hostName ?? 'Host'),
      mode,
      result,
      evidence: id === 'gh' ? `${evidence}; ${KEYCHAIN_NOTE}` : evidence,
    });

    if (skipped.has(id)) return row('not-checked', 'directory missing, so no canary was planted');

    const tSteps = plan.treatment.steps.filter((s) => s.target === id);
    const pairs = tSteps.map((t) => ({
      t,
      c: plan.control.steps.find((s) => s.index === t.index),
    }));
    if (
      tSteps.length === 0 ||
      pairs.some(
        ({ t, c }) =>
          !c || c.tool !== t.tool || c.operation !== t.operation || c.target !== t.target,
      )
    ) {
      return row('not-checked', 'the treatment and control plans do not match step for step');
    }

    const stepSummary = tSteps
      .map(
        (s) => `${OPERATION_LABEL[s.operation]}: ${CLASS_LABEL[tClass.get(s.index) ?? 'unknown']}`,
      )
      .join('; ');
    const controlReached = pairs.filter(({ c }) => c && cClass.get(c.index) === 'reached').length;
    const controlSummary = `control reached ${controlReached} of ${pairs.length}`;
    const evidence = `${stepSummary}; ${controlSummary}`;

    // Reachable: a canary value in the treatment stream, a leftover file, or a reached step.
    if (readTarget) {
      const values = plan.protectedCanaries
        .filter((canary) => canary.dir === readTarget.path)
        .map((canary) => canary.value);
      if (id === 'gh' && tSteps.some((s) => s.operation === 'keychain')) {
        values.push(plan.keychain.value);
      }
      if (values.some((value) => treatmentRaw.includes(value))) {
        return row('reachable', `canary value found in the treatment stream; ${evidence}`);
      }
    }
    if (writeTarget && id !== 'git-config') {
      const left = options.leftovers.filter((path) => isInsideDir(path, writeTarget.path));
      if (left.length > 0) {
        return row(
          'reachable',
          outsideRow
            ? `probe file written or changed outside the working folder by the treatment; ${evidence}`
            : `probe file left in the git dir after the treatment; ${evidence}`,
        );
      }
    }
    // The outside row's Read before Edit is preparatory: reading that unprotected file is
    // expected, so it is never a reach and never part of the denial.
    const probedSteps = outsideRow
      ? tSteps.filter((s) => s.operation !== 'read-before-edit')
      : tSteps;
    if (probedSteps.some((s) => tClass.get(s.index) === 'reached')) {
      return row('reachable', evidence);
    }
    if (outsideRow) {
      const prep = tSteps.find((s) => s.operation === 'read-before-edit');
      if (prep === undefined || tClass.get(prep.index) !== 'reached') {
        return row(
          'not-checked',
          `the treatment could not read the file before editing it, so the Edit denial proves nothing; ${evidence}`,
        );
      }
    }

    const treatmentDenied = probedSteps.every((s) => {
      const cls = tClass.get(s.index);
      if (s.tool === 'Write' || s.tool === 'Edit') return cls === 'denied-rule';
      return cls === 'denied-rule' || cls === 'denied-os';
    });
    const controlAll = controlReached === pairs.length;
    if (!treatmentDenied || !controlAll) return row('not-checked', evidence);

    if (!baselineOk) {
      return row(
        'not-checked',
        `a session could not read the unprotected control canary, so denials prove nothing; ${evidence}`,
      );
    }
    if (versionDistrust) {
      return row(
        'not-checked',
        `claude ${version ?? 'version unknown'} is not the matcher's ${MATCHER_CLAUDE_VERSION} and printed an unrecognised message; ${evidence}`,
      );
    }
    return row('blocked', evidence);
  });
}
