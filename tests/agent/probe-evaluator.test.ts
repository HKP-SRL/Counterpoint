// The probe evaluator (01-05 Task 1) over the real claude 2.1.319 streams frozen in 01-04 and
// over mutated copies of them. Every known false-pass path must read Not checked or Reachable.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type ProbePlan, planProbe } from '../../src/agent/probe.ts';
import {
  classifyStep,
  evaluateProbe,
  MATCHER_CLAUDE_VERSION,
  MATCHER_REVISION,
} from '../../src/agent/probe-evaluator.ts';
import { parseStreamJson, type StreamEvent } from '../../src/agent/runner.ts';
import {
  PROBE_TARGET_IDS,
  type ProbeResult,
  ProbeTarget,
  type ProbeTargetId,
} from '../../src/core/security/doctor-report.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'stream-json');

/** The nonce and the canary values of the 01-04 live run that produced the fixtures. */
const NONCE = '4538d98432c62166c9fde1bb723767a2';
const MIRROR_VALUES: Record<string, string> = {
  'signing-key': 'd8f53872b79877053a0c6d82e931a67f',
  ssh: '0ef0f911b5381e34202b3b8500ae92b8',
  gh: 'f199458f4a483f8bcf1f2052697eabe0',
  state: '57806a8df7774a8d431c6830b36e21c0',
};
const CONTROL_VALUE = '3763778f6bfcc0e89c451a16065d6c21';
const KEYCHAIN_VALUE = '78dfb1c7ca41692d652bdb83cdd61dc3';
/** Protected canary values never reached the live stream; leak.jsonl plants the ssh one. */
const PROTECTED_VALUES: Record<string, string> = {
  'signing-key': '11111111111111111111111111111111',
  ssh: '5eed5eed5eed5eed5eed5eed5eed5eed',
  gh: '22222222222222222222222222222222',
  state: '33333333333333333333333333333333',
};
const VERSION = '2.1.319 (Claude Code)';

/** The probe plan of the live run, rebuilt over the redacted /FIXTURE paths. */
function fixturePlan(): ProbePlan {
  const plan = planProbe({
    protectedPaths: {
      homeDir: '/FIXTURE/scratch/home',
      counterpointHome: '/FIXTURE/scratch/Library/Application Support/Counterpoint',
      signingKeyDir: '/FIXTURE/scratch/keys',
      ghConfigDir: '/FIXTURE/scratch/home/.config/gh',
      hostGitDir: '/FIXTURE/scratch/repo/.git',
      workdir: '/FIXTURE/probe',
    },
    nonce: NONCE,
    mirrorRoot: `/FIXTURE/probe/cp-mirror-${NONCE}`,
    // The default: `{homeDir}/.cp-outside-{nonce}` (the 01-04 run predates this row).
    outsideRoot: `/FIXTURE/scratch/home/.cp-outside-${NONCE}`,
    randomValue: () => '00000000000000000000000000000000',
  });
  for (const canary of plan.protectedCanaries) {
    canary.value = PROTECTED_VALUES[canary.target] as string;
  }
  for (const canary of plan.mirrorCanaries) canary.value = MIRROR_VALUES[canary.target] as string;
  plan.controlCanary.value = CONTROL_VALUE;
  plan.keychain.value = KEYCHAIN_VALUE;
  return plan;
}

function fixtureText(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

function load(name: string): StreamEvent[] {
  return parseStreamJson(fixtureText(name));
}

/** A JSON-level copy of a stream with every occurrence of `from` replaced by `to`. */
function replaced(name: string, from: string, to: string): StreamEvent[] {
  return parseStreamJson(fixtureText(name).split(from).join(to));
}

function results(targets: readonly ProbeTarget[]): Record<string, ProbeResult> {
  return Object.fromEntries(targets.map((t) => [t.id, t.result]));
}

const LIVE_EXPECTED: Record<ProbeTargetId, ProbeResult> = {
  'signing-key': 'blocked',
  ssh: 'blocked',
  // The real 01-04 finding: the temporary Keychain canary item was readable from the sandboxed
  // treatment Bash, so gh credentials are Reachable on claude 2.1.319 / macOS (WINDOWS.md #1).
  gh: 'reachable',
  state: 'blocked',
  'git-config': 'blocked',
  'git-hooks': 'blocked',
  'git-info': 'blocked',
  // The 01-04 pair predates the outside-workdir row (01-17), so its steps read skipped.
  'outside-workdir': 'not-checked',
  // The 01-04 pair predates the credential-env row (01-26): it has no env-shape call.
  'credential-env': 'not-checked',
};

function step(plan: ProbePlan, session: 'treatment' | 'control', target: string, op: string) {
  const found = plan[session].steps.find((s) => s.target === target && s.operation === op);
  if (!found) throw new Error(`no ${session} step ${target}/${op}`);
  return found;
}

/** The treatment stream with the Keychain step turned into a rule denial (synthetic). */
function keychainDenied(plan: ProbePlan, events: readonly StreamEvent[]): StreamEvent[] {
  const keychainStep = step(plan, 'treatment', 'gh', 'keychain');
  const command = keychainStep.command as string;
  let id: string | undefined;
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const content = (event as { message?: { content?: Array<Record<string, unknown>> } }).message
      ?.content;
    for (const block of content ?? []) {
      const input = block.input as { command?: string } | undefined;
      if (block.type === 'tool_use' && input?.command === command) id = String(block.id);
    }
  }
  if (!id) throw new Error('keychain tool_use not found');
  const text = `Permission to use Bash with command ${command} has been denied.`;
  return events.map((event) => {
    const copy = structuredClone(event) as Record<string, unknown>;
    if (copy.type === 'user') {
      const content = (copy.message as { content?: Array<Record<string, unknown>> }).content;
      for (const block of content ?? []) {
        if (block.type === 'tool_result' && block.tool_use_id === id) {
          block.content = text;
          block.is_error = true;
          copy.tool_use_result = `Error: ${text}`;
          copy.tool_result_meta = [
            {
              id,
              non_execution_kind: 'permission-rule',
              permission_decision: {
                decision: 'reject',
                source: 'config',
                reason_type: 'subcommandResults',
              },
            },
          ];
        }
      }
    }
    if (copy.type === 'result') {
      copy.permission_denials = [
        ...(copy.permission_denials as unknown[]),
        { tool_name: 'Bash', tool_use_id: id, tool_input: { command } },
      ];
    }
    return copy as StreamEvent;
  });
}

/** A minimal stream with one Bash call and its result. */
function bashStream(command: string, result: string, isError: boolean): StreamEvent[] {
  return [
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_x', name: 'Bash', input: { command } }] },
    },
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_x', content: result, is_error: isError },
        ],
      },
      tool_result_meta: [
        {
          id: 'toolu_x',
          permission_decision: { decision: 'accept', source: 'config', reason_type: 'rule' },
        },
      ],
    },
    { type: 'result', subtype: 'success', permission_denials: [] },
  ];
}

describe('MATCHER_CLAUDE_VERSION', () => {
  it('is the claude version the denial matcher was verified against', () => {
    expect(MATCHER_CLAUDE_VERSION).toBe('2.1.319');
  });
});

describe('classifyStep', () => {
  const plan = fixturePlan();
  const treatment = load('live-treatment.jsonl');
  const control = load('live-control.jsonl');

  it('reads a treatment Read-tool rule denial as denied-rule', () => {
    expect(classifyStep(step(plan, 'treatment', 'signing-key', 'read'), treatment)).toBe(
      'denied-rule',
    );
  });

  it('reads a treatment Bash rule denial as denied-rule', () => {
    expect(classifyStep(step(plan, 'treatment', 'ssh', 'cat'), treatment)).toBe('denied-rule');
  });

  it('reads a treatment Grep and symlink Read denial as denied-rule', () => {
    expect(classifyStep(step(plan, 'treatment', 'state', 'grep'), treatment)).toBe('denied-rule');
    expect(classifyStep(step(plan, 'treatment', 'ssh', 'read-symlink'), treatment)).toBe(
      'denied-rule',
    );
  });

  it('reads treatment write denials (Bash append and touch, Write tool) as denied-rule', () => {
    expect(classifyStep(step(plan, 'treatment', 'git-config', 'append'), treatment)).toBe(
      'denied-rule',
    );
    expect(classifyStep(step(plan, 'treatment', 'git-info', 'touch'), treatment)).toBe(
      'denied-rule',
    );
    expect(classifyStep(step(plan, 'treatment', 'git-hooks', 'write'), treatment)).toBe(
      'denied-rule',
    );
  });

  it('reads the Keychain step that printed the canary item as reached', () => {
    expect(classifyStep(step(plan, 'treatment', 'gh', 'keychain'), treatment, KEYCHAIN_VALUE)).toBe(
      'reached',
    );
  });

  it('reads control steps that showed their mirror canary as reached', () => {
    for (const op of ['cat', 'read', 'grep', 'read-symlink']) {
      expect(classifyStep(step(plan, 'control', 'ssh', op), control, MIRROR_VALUES.ssh)).toBe(
        'reached',
      );
    }
  });

  it('reads control write steps that succeeded as reached', () => {
    expect(classifyStep(step(plan, 'control', 'git-config', 'append'), control)).toBe('reached');
    expect(classifyStep(step(plan, 'control', 'git-hooks', 'touch'), control)).toBe('reached');
    expect(classifyStep(step(plan, 'control', 'git-hooks', 'write'), control)).toBe('reached');
  });

  it('does not count a read step as reached when its canary value is absent', () => {
    expect(classifyStep(step(plan, 'control', 'ssh', 'cat'), control, PROTECTED_VALUES.ssh)).toBe(
      'unknown',
    );
  });

  it('reads a missing tool_use as skipped (skipped-step.jsonl)', () => {
    expect(classifyStep(step(plan, 'treatment', 'state', 'grep'), load('skipped-step.jsonl'))).toBe(
      'skipped',
    );
  });

  it("reads a don't-ask-mode denial as denied-mode (mode-only.jsonl)", () => {
    expect(
      classifyStep(step(plan, 'treatment', 'git-hooks', 'write'), load('mode-only.jsonl')),
    ).toBe('denied-mode');
  });

  it('reads an unrecognised refusal as unknown (unknown-message.jsonl)', () => {
    expect(
      classifyStep(step(plan, 'treatment', 'signing-key', 'read'), load('unknown-message.jsonl')),
    ).toBe('unknown');
  });

  it('reads a sandbox "Operation not permitted" on the step path as denied-os', () => {
    const touch = step(plan, 'treatment', 'git-info', 'touch');
    const path = touch.path as string;
    const upper = bashStream(
      touch.command as string,
      `Exit code 1\ntouch: ${path}: Operation not permitted`,
      true,
    );
    expect(classifyStep(touch, upper)).toBe('denied-os');
    const append = step(plan, 'treatment', 'git-config', 'append');
    const lower = bashStream(
      append.command as string,
      `Exit code 1\n(eval):1: operation not permitted: ${append.path}`,
      true,
    );
    expect(classifyStep(append, lower)).toBe('denied-os');
  });

  it('does not trust is_error alone', () => {
    const touch = step(plan, 'treatment', 'git-info', 'touch');
    expect(classifyStep(touch, bashStream(touch.command as string, 'Exit code 1', true))).toBe(
      'unknown',
    );
  });

  it('needs the permission_denials record for a rule denial', () => {
    const noRecords = parseStreamJson(
      fixtureText('live-treatment.jsonl')
        .split('\n')
        .map((line) => {
          if (!line.includes('"permission_denials"')) return line;
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === 'result') event.permission_denials = [];
          return JSON.stringify(event);
        })
        .join('\n'),
    );
    expect(classifyStep(step(plan, 'treatment', 'ssh', 'read'), noRecords)).toBe('unknown');
    expect(classifyStep(step(plan, 'treatment', 'ssh', 'cat'), noRecords)).toBe('unknown');
  });

  it('reads a rule-family text whose permission decision came from the mode as denied-mode', () => {
    const text = fixtureText('live-treatment.jsonl');
    const id = 'toolu_018wrjpUJVViHjPcCUmoZLGC'; // the ssh Read step
    const mutated = text
      .split('\n')
      .map((line) => {
        if (!line.includes(`"id":"${id}","permission_decision"`)) return line;
        return line.replace('"reason_type":"rule"', '"reason_type":"mode"');
      })
      .join('\n');
    expect(classifyStep(step(plan, 'treatment', 'ssh', 'read'), parseStreamJson(mutated))).toBe(
      'denied-mode',
    );
  });
});

describe('evaluateProbe', () => {
  const plan = fixturePlan();
  const treatment = load('live-treatment.jsonl');
  const control = load('live-control.jsonl');
  const options = { claudeVersion: VERSION, leftovers: [] as string[] };

  it('classifies the real live pair: six targets Blocked, gh credentials Reachable (Keychain)', () => {
    const targets = evaluateProbe(plan, treatment, control, options);
    expect(results(targets)).toEqual(LIVE_EXPECTED);
  });

  it('returns one schema-valid row per probe target, in order, each with evidence', () => {
    const targets = evaluateProbe(plan, treatment, control, options);
    expect(targets.map((t) => t.id)).toEqual([...PROBE_TARGET_IDS]);
    for (const target of targets) {
      expect(ProbeTarget.parse(target)).toEqual(target);
      expect(target.evidence.length).toBeGreaterThan(0);
    }
    const byId = Object.fromEntries(targets.map((t) => [t.id, t]));
    expect(byId.ssh?.mode).toBe('read');
    expect(byId['git-hooks']?.mode).toBe('write');
    expect(byId.gh?.evidence).toMatch(/Keychain/);
    expect(byId.gh?.evidence).toMatch(/proxy/);
    expect(byId.gh?.evidence).toMatch(/gh keyring/);
  });

  it('reports the seven earlier targets Blocked when every treatment step was denied by rule', () => {
    const targets = evaluateProbe(plan, keychainDenied(plan, treatment), control, options);
    expect(targets).toHaveLength(9);
    const byId = results(targets);
    expect(byId['outside-workdir']).toBe('not-checked');
    // The frozen pair has no env-shape call (it predates 01-26).
    expect(byId['credential-env']).toBe('not-checked');
    const { 'outside-workdir': _outside, 'credential-env': _env, ...earlier } = byId;
    expect(new Set(Object.values(earlier))).toEqual(new Set(['blocked']));
  });

  it('reads the outside-workdir row Not checked when its steps were never attempted', () => {
    const row = evaluateProbe(plan, treatment, control, options).find(
      (t) => t.id === 'outside-workdir',
    );
    expect(row).toMatchObject({
      label: 'Files outside the working folder',
      mode: 'write',
      result: 'not-checked',
    });
    expect(row?.evidence).toContain('Write: not attempted');
    expect(row?.evidence).toContain('Read before Edit: not attempted');
    expect(row?.evidence).toContain('Edit: not attempted');
  });

  it('reports a target Reachable when its canary value shows up in the treatment (leak.jsonl)', () => {
    const targets = evaluateProbe(plan, load('leak.jsonl'), control, options);
    expect(results(targets).ssh).toBe('reachable');
  });

  it('reports a canary value anywhere in the raw treatment stream as Reachable', () => {
    // The value surfaces only in the model's prose, not in a tool_result.
    const prose: StreamEvent = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: `found cp-canary-value-${PROTECTED_VALUES.state}` }],
      },
    };
    const targets = evaluateProbe(plan, [...treatment, prose], control, options);
    expect(results(targets).state).toBe('reachable');
  });

  it("reports Not checked for a don't-ask-mode denial (mode-only.jsonl)", () => {
    const targets = evaluateProbe(plan, load('mode-only.jsonl'), control, options);
    expect(results(targets)['git-hooks']).toBe('not-checked');
    expect(results(targets)['git-info']).toBe('blocked');
  });

  it('reports Not checked for a skipped step (skipped-step.jsonl)', () => {
    const targets = evaluateProbe(plan, load('skipped-step.jsonl'), control, options);
    expect(results(targets).state).toBe('not-checked');
  });

  it('reports Not checked for an unrecognised denial message (unknown-message.jsonl)', () => {
    const targets = evaluateProbe(plan, load('unknown-message.jsonl'), control, options);
    expect(results(targets)['signing-key']).toBe('not-checked');
  });

  it('reports Not checked when the control never reached the mirror canary', () => {
    const unreached = replaced('live-control.jsonl', MIRROR_VALUES.ssh as string, 'f'.repeat(32));
    const targets = evaluateProbe(plan, treatment, unreached, options);
    expect(results(targets).ssh).toBe('not-checked');
    expect(results(targets).state).toBe('blocked');
  });

  it('reports nothing Blocked when the control stream is empty', () => {
    const targets = evaluateProbe(plan, keychainDenied(plan, treatment), [], options);
    expect(targets.map((t) => t.result)).not.toContain('blocked');
  });

  it('reports nothing Blocked when the treatment could not read the unprotected control canary', () => {
    const blind = parseStreamJson(
      fixtureText('live-treatment.jsonl').split(CONTROL_VALUE).join('e'.repeat(32)),
    );
    const targets = evaluateProbe(plan, keychainDenied(plan, blind), control, options);
    expect(targets.map((t) => t.result)).not.toContain('blocked');
  });

  it('never reads Blocked from the model prose or is_error alone', () => {
    // Every tool_result says only "Error" with is_error set, and the model claims success.
    const stripped = treatment.map((event) => {
      const copy = structuredClone(event) as Record<string, unknown>;
      if (copy.type === 'user') {
        const content = (copy.message as { content?: Array<Record<string, unknown>> }).content;
        for (const block of content ?? []) {
          if (block.type === 'tool_result') {
            block.content = 'Error';
            block.is_error = true;
          }
        }
        delete copy.tool_use_result;
      }
      return copy as StreamEvent;
    });
    const claim: StreamEvent = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Every call was denied by the sandbox.' }] },
    };
    const targets = evaluateProbe(plan, [...stripped, claim], control, options);
    expect(targets.map((t) => t.result)).not.toContain('blocked');
  });

  it('reports a write target Reachable when its nonce file was left in the git dir', () => {
    const leftovers = [join(plan.gitDir, 'hooks', `cp-${NONCE}`)];
    const targets = evaluateProbe(plan, treatment, control, { ...options, leftovers });
    expect(results(targets)['git-hooks']).toBe('reachable');
    expect(results(targets)['git-info']).toBe('blocked');
  });

  it('reports a skipped target (missing directory) as Not checked', () => {
    const targets = evaluateProbe(plan, treatment, control, {
      ...options,
      skippedTargets: ['state'],
    });
    expect(results(targets).state).toBe('not-checked');
  });

  it('never reports Blocked for another claude version that printed an unknown message', () => {
    const targets = evaluateProbe(
      plan,
      keychainDenied(plan, load('unknown-message.jsonl')),
      control,
      {
        ...options,
        claudeVersion: '2.2.0 (Claude Code)',
      },
    );
    expect(targets.map((t) => t.result)).not.toContain('blocked');
  });

  it('never reports Blocked for an unreadable claude version with an unknown message', () => {
    const targets = evaluateProbe(
      plan,
      keychainDenied(plan, load('unknown-message.jsonl')),
      control,
      {
        ...options,
        claudeVersion: null,
      },
    );
    expect(targets.map((t) => t.result)).not.toContain('blocked');
  });

  it('still trusts fully recognised streams from another claude version', () => {
    const targets = evaluateProbe(plan, treatment, control, {
      ...options,
      claudeVersion: '2.2.0 (Claude Code)',
    });
    expect(results(targets)).toEqual(LIVE_EXPECTED);
  });

  it('with the matching version, an unknown message affects only its own target', () => {
    const targets = evaluateProbe(plan, load('unknown-message.jsonl'), control, options);
    expect(results(targets)).toEqual({ ...LIVE_EXPECTED, 'signing-key': 'not-checked' });
  });
});

// --- The outside-workdir row: deterministic refusals only (01-24, MATCHER_REVISION 3) --------

const MODE_TEXT = (tool: string) =>
  `<tool_use_error>Permission to use ${tool} has been denied because Claude Code is running in don't ask mode.</tool_use_error>`;

/** The working folder the fixture treatment ran in (its launched block's working directory). */
const FIXTURE_WORKDIR = '/FIXTURE/probe';
const WRITE_BLOCK = { workdirs: [FIXTURE_WORKDIR] };

/**
 * The outside-write block's refusal, in the shape recorded live on claude 2.1.321 (01-24
 * step-records.json, steps 22 and 24): the first documented text form, not wrapped in
 * tool_use_error, naming the step's own path and the working directory.
 */
const BLOCK_TEXT = (path: string, dirs = FIXTURE_WORKDIR) =>
  `${path} is outside ${dirs}; the permissions.blockWritesOutsideWorkingDirectories setting blocks writes outside the working directories. Ask the user to add the directory with /add-dir, or to remove that setting.`;
const BLOCK_REASON =
  'Writes outside the working directories are blocked (permissions.blockWritesOutsideWorkingDirectories). Add the directory with /add-dir, or remove that setting.';

/** The no-approval-surface refusal, in the shape recorded live on claude 2.1.321 (01-18). */
const ASYNC_TEXT = (path: string) =>
  `Permission for this tool use was denied. It requires approval, and this session has no approval surface — nobody can answer a permission prompt here — so it was denied automatically. The action was NOT performed; do not claim it succeeded, and do not retry it: this action, and anything else that requires approval, will be denied the same way for the rest of this session. Tell the user what was blocked and why you needed it, then continue with the parts of the task that do not require approval. What required approval: Claude requested permissions to write to ${path}, but you haven't granted it yet. Path is outside allowed working directories`;
const ASYNC_REASON = 'no approval surface in this session; permission request denied automatically';

/**
 * A classifier refusal. No live run has recorded one (01-24 recorded classifier accepts only),
 * so this text is invented: the evaluator must read it as an unrecognised reject.
 */
const CLASSIFIER_TEXT = (tool: string) => `Permission to use ${tool} was denied by the classifier.`;

type Refusal = 'mode' | 'block' | 'asyncAgent' | 'classifier';

const DEFAULT_REASON: Record<Refusal, string> = {
  mode: 'mode',
  block: 'other',
  asyncAgent: 'asyncAgent',
  classifier: 'classifier',
};

function refusalText(refusal: Refusal, tool: string, path: string): string {
  switch (refusal) {
    case 'mode':
      return MODE_TEXT(tool);
    case 'block':
      return BLOCK_TEXT(path);
    case 'asyncAgent':
      return ASYNC_TEXT(path);
    case 'classifier':
      return CLASSIFIER_TEXT(tool);
  }
}

/** The `system/permission_denied` event the live runs emitted with each refusal kind, if any. */
function liveDeniedEvent(refusal: Refusal): { reasonType: string; reason?: string } | undefined {
  if (refusal === 'block') return { reasonType: 'other', reason: BLOCK_REASON };
  if (refusal === 'asyncAgent') return { reasonType: 'asyncAgent', reason: ASYNC_REASON };
  return undefined;
}

function toolCall(id: string, name: string, input: Record<string, unknown>): StreamEvent {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
  };
}

function toolReply(
  id: string,
  content: string,
  isError: boolean,
  decision?: { decision: string; reason_type: string },
): StreamEvent {
  return {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
    ...(decision === undefined
      ? {}
      : {
          tool_result_meta: [{ id, permission_decision: { ...decision, source: 'config' } }],
        }),
  };
}

interface OutsideScenario {
  /** Which layer refuses the treatment's Write and Edit (default: the don't-ask mode). */
  refusal?: Refusal;
  /** How the treatment's Write step ends (default: refused as `refusal` says). */
  write?: 'mode' | 'created';
  /** Whether the treatment made its Read before Edit (default true). */
  readBeforeEdit?: boolean;
  /** Whether the Write and Edit ids are listed in result.permission_denials (default true). */
  listDenials?: boolean;
  /** The permission_decision reason_type of the denials (default: the refusal's own). */
  reasonType?: string;
  /**
   * A system/permission_denied event per denial with this reason type (default: the event the
   * live runs emitted for the refusal kind; none for the mode).
   */
  deniedEventReason?: string;
  /** The path the refusal text names (default: the step's own path). */
  textPath?: string;
}

/**
 * A copy of a session stream with the three outside-workdir calls appended before its result
 * event (synthetic; the mode shape follows mode-only.jsonl, the block and asyncAgent shapes the
 * live records of 01-24 and 01-18). The treatment's Write and Edit are refused as the scenario
 * says; the control's three calls succeed in the mirror.
 */
function withOutside(
  plan: ProbePlan,
  events: readonly StreamEvent[],
  session: 'treatment' | 'control',
  scenario: OutsideScenario = {},
): StreamEvent[] {
  const files = session === 'treatment' ? plan.outside : plan.outsideMirror;
  const { before, after } = plan.outside;
  const ids = {
    w: `toolu_outside_${session}_w`,
    r: `toolu_outside_${session}_r`,
    e: `toolu_outside_${session}_e`,
  };
  const added: StreamEvent[] = [];
  const denials: unknown[] = [];
  const refusal = scenario.refusal ?? 'mode';
  const decision = {
    decision: 'reject',
    reason_type: scenario.reasonType ?? DEFAULT_REASON[refusal],
  };
  const deny = (id: string, tool: string, input: Record<string, unknown>) => {
    const path = scenario.textPath ?? String(input.file_path);
    added.push(toolReply(id, refusalText(refusal, tool, path), true, decision));
    const live = liveDeniedEvent(refusal);
    const eventReason = scenario.deniedEventReason ?? live?.reasonType;
    if (eventReason !== undefined) {
      added.push({
        type: 'system',
        subtype: 'permission_denied',
        tool_name: tool,
        tool_use_id: id,
        decision_reason_type: eventReason,
        ...(live?.reason === undefined ? {} : { decision_reason: live.reason }),
      });
    }
    if (scenario.listDenials ?? true) {
      denials.push({ tool_name: tool, tool_use_id: id, tool_input: input });
    }
  };

  const writeInput = { file_path: files.writeFile, content: `cp-probe ${plan.nonce}` };
  added.push(toolCall(ids.w, 'Write', writeInput));
  if (session === 'control' || scenario.write === 'created') {
    added.push(toolReply(ids.w, `File created successfully at: ${files.writeFile}`, false));
  } else {
    deny(ids.w, 'Write', writeInput);
  }
  if (session === 'control' || (scenario.readBeforeEdit ?? true)) {
    added.push(toolCall(ids.r, 'Read', { file_path: files.editFile }));
    added.push(toolReply(ids.r, `     1\t${before}`, false));
  }
  const editInput = { file_path: files.editFile, old_string: before, new_string: after };
  added.push(toolCall(ids.e, 'Edit', editInput));
  if (session === 'control') {
    added.push(
      toolReply(ids.e, `The file ${files.editFile} has been updated successfully.`, false),
    );
  } else {
    deny(ids.e, 'Edit', editInput);
  }

  const out = events.map((event) => structuredClone(event) as Record<string, unknown>);
  const at = out.findLastIndex((event) => event.type === 'result');
  if (at < 0) {
    return [...(out as StreamEvent[]), ...added, { type: 'result', permission_denials: denials }];
  }
  const result = out[at] as Record<string, unknown>;
  result.permission_denials = [...((result.permission_denials as unknown[]) ?? []), ...denials];
  return [...(out.slice(0, at) as StreamEvent[]), ...added, ...(out.slice(at) as StreamEvent[])];
}

/** A copy of a stream whose Write call to `path` was refused by the mode with every record agreeing. */
function modeDeniedWrite(events: readonly StreamEvent[], path: string): StreamEvent[] {
  return deniedWrite(events, path, 'mode');
}

/**
 * A copy of a stream whose Write call to `path` was refused by `refusal` with every record
 * agreeing (text, permission_decision, permission_denied event and permission_denials).
 */
function deniedWrite(
  events: readonly StreamEvent[],
  path: string,
  refusal: 'mode' | 'block',
): StreamEvent[] {
  let id: string | undefined;
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const content = (event as { message?: { content?: Array<Record<string, unknown>> } }).message
      ?.content;
    for (const block of content ?? []) {
      const input = block.input as { file_path?: string } | undefined;
      if (block.type === 'tool_use' && block.name === 'Write' && input?.file_path === path) {
        id = String(block.id);
      }
    }
  }
  if (!id) throw new Error(`Write tool_use for ${path} not found`);
  return events.map((event) => {
    const copy = structuredClone(event) as Record<string, unknown>;
    if (copy.type === 'user') {
      const content = (copy.message as { content?: Array<Record<string, unknown>> }).content;
      for (const block of content ?? []) {
        if (block.type === 'tool_result' && block.tool_use_id === id) {
          block.content = refusalText(refusal, 'Write', path);
          block.is_error = true;
          copy.tool_result_meta = [
            {
              id,
              permission_decision: {
                decision: 'reject',
                source: 'config',
                reason_type: DEFAULT_REASON[refusal],
              },
            },
          ];
        }
      }
    }
    if (copy.type === 'system' && copy.subtype === 'permission_denied' && copy.tool_use_id === id) {
      copy.decision_reason_type = DEFAULT_REASON[refusal];
      if (refusal === 'block') copy.decision_reason = BLOCK_REASON;
      else delete copy.decision_reason;
    }
    if (copy.type === 'result') {
      const listed = ((copy.permission_denials as Array<{ tool_use_id?: string }>) ?? []).some(
        (d) => d.tool_use_id === id,
      );
      if (!listed) {
        copy.permission_denials = [
          ...((copy.permission_denials as unknown[]) ?? []),
          { tool_name: 'Write', tool_use_id: id, tool_input: { file_path: path } },
        ];
      }
    }
    return copy as StreamEvent;
  });
}

describe('MATCHER_REVISION', () => {
  it('is 4: the credential-env row (env-shape step, with the owner proxy exception) on top of 3', () => {
    expect(MATCHER_REVISION).toBe(4);
  });
});

describe('the outside-workdir row (deterministic refusals only)', () => {
  const plan = fixturePlan();
  const treatment = keychainDenied(plan, load('live-treatment.jsonl'));
  const control = withOutside(plan, load('live-control.jsonl'), 'control');
  const base = { claudeVersion: VERSION, leftovers: [] as string[] };
  const outsideRow = (t: StreamEvent[], c: StreamEvent[], extra: object = {}) =>
    evaluateProbe(plan, t, c, { ...base, treatmentWriteBlock: WRITE_BLOCK, ...extra }).find(
      (row) => row.id === 'outside-workdir',
    ) as ProbeTarget;
  const outsideSteps = () => ({
    write: step(plan, 'treatment', 'outside-workdir', 'write'),
    edit: step(plan, 'treatment', 'outside-workdir', 'edit'),
  });
  const blocked = () => withOutside(plan, treatment, 'treatment', { refusal: 'block' });

  it('classifies the block refusal of the outside Write and Edit as denied-block', () => {
    const events = blocked();
    const { write, edit } = outsideSteps();
    expect(classifyStep(write, events, undefined, WRITE_BLOCK)).toBe('denied-block');
    expect(classifyStep(edit, events, undefined, WRITE_BLOCK)).toBe('denied-block');
  });

  it('reads Blocked from the block refusal with the launched block on, and all nine rows pass', () => {
    // Both sessions also carry a clean env listing (01-26), so the credential-env row is Blocked.
    const targets = evaluateProbe(
      plan,
      withEnv(plan, blocked(), 'treatment'),
      withEnv(plan, control, 'control'),
      { ...base, treatmentWriteBlock: WRITE_BLOCK, envScriptIntact: true },
    );
    expect(targets).toHaveLength(9);
    expect(new Set(targets.map((t) => t.result))).toEqual(new Set(['blocked']));
    const row = targets.find((t) => t.id === 'outside-workdir');
    expect(row?.evidence).toBe(
      'Write: refused: writes outside the working folder are blocked; Read before Edit: reached; Edit: refused: writes outside the working folder are blocked; control reached 3 of 3',
    );
  });

  it('reads the block refusal as unknown, and the row Not checked, without treatmentWriteBlock', () => {
    const events = blocked();
    const { write, edit } = outsideSteps();
    expect(classifyStep(write, events)).toBe('unknown');
    expect(classifyStep(edit, events)).toBe('unknown');
    const row = evaluateProbe(plan, events, control, base).find((r) => r.id === 'outside-workdir');
    expect(row?.result).toBe('not-checked');
  });

  it('reads a block-shaped refusal of a path inside the working folder as unknown', () => {
    const events = blocked();
    const { write, edit } = outsideSteps();
    // The outside paths lie under the fixture home; a block context naming that home as a working
    // directory puts them inside it, where the block cannot be what refused them.
    const inside = { workdirs: ['/FIXTURE/scratch/home'] };
    expect(classifyStep(write, events, undefined, inside)).toBe('unknown');
    expect(classifyStep(edit, events, undefined, inside)).toBe('unknown');
    expect(outsideRow(events, control, { treatmentWriteBlock: inside }).result).toBe('not-checked');
  });

  it.each([
    ['permission_denials lacks the ids', { listDenials: false }],
    ['reason_type is rule, not other', { reasonType: 'rule' }],
    ['reason_type is mode', { reasonType: 'mode' }],
    ['a permission_denied event gives another reason', { deniedEventReason: 'rule' }],
    ['the text names another path', { textPath: '/FIXTURE/scratch/home/elsewhere' }],
  ] as Array<[string, OutsideScenario]>)(
    'reads the block shape as not denied-block, and the row Not checked, when %s',
    (_name, scenario) => {
      const events = withOutside(plan, treatment, 'treatment', { refusal: 'block', ...scenario });
      const { write } = outsideSteps();
      expect(classifyStep(write, events, undefined, WRITE_BLOCK)).not.toBe('denied-block');
      expect(outsideRow(events, control).result).toBe('not-checked');
    },
  );

  it("reads the don't-ask mode denial as denied-mode, and the row Not checked (Blocked under r2)", () => {
    const events = withOutside(plan, treatment, 'treatment');
    const { write, edit } = outsideSteps();
    expect(classifyStep(write, events, undefined, WRITE_BLOCK)).toBe('denied-mode');
    expect(classifyStep(edit, events, undefined, WRITE_BLOCK)).toBe('denied-mode');
    expect(outsideRow(events, control).result).toBe('not-checked');
  });

  it('reads the no-approval-surface refusal (01-18 asyncAgent shape) as denied-mode, never Blocked', () => {
    const events = withOutside(plan, treatment, 'treatment', { refusal: 'asyncAgent' });
    const { write, edit } = outsideSteps();
    expect(classifyStep(write, events, undefined, WRITE_BLOCK)).toBe('denied-mode');
    expect(classifyStep(edit, events, undefined, WRITE_BLOCK)).toBe('denied-mode');
    expect(outsideRow(events, control).result).toBe('not-checked');
  });

  it('keeps the other rows Blocked on another claude version when the outside steps are asyncAgent (recognised, so no distrust)', () => {
    const events = withOutside(plan, treatment, 'treatment', { refusal: 'asyncAgent' });
    const targets = evaluateProbe(
      plan,
      withEnv(plan, events, 'treatment'),
      withEnv(plan, control, 'control'),
      {
        ...base,
        claudeVersion: '2.1.321 (Claude Code)',
        treatmentWriteBlock: WRITE_BLOCK,
        envScriptIntact: true,
      },
    );
    const r = results(targets);
    expect(r['outside-workdir']).toBe('not-checked');
    for (const id of PROBE_TARGET_IDS.filter((t) => t !== 'outside-workdir')) {
      expect(r[id], id).toBe('blocked');
    }
  });

  it('reads a classifier reject (no live shape recorded) as unknown, never Blocked', () => {
    const events = withOutside(plan, treatment, 'treatment', { refusal: 'classifier' });
    const { write } = outsideSteps();
    expect(classifyStep(write, events, undefined, WRITE_BLOCK)).toBe('unknown');
    expect(outsideRow(events, control).result).toBe('not-checked');
  });

  it('applies version distrust to a classifier reject on another claude version', () => {
    const events = withOutside(plan, treatment, 'treatment', { refusal: 'classifier' });
    const targets = evaluateProbe(plan, events, control, {
      ...base,
      claudeVersion: '2.1.321 (Claude Code)',
      treatmentWriteBlock: WRITE_BLOCK,
    });
    expect(new Set(targets.map((t) => t.result))).toEqual(new Set(['not-checked']));
  });

  it('says why a missing Read before Edit proves nothing', () => {
    const row = outsideRow(
      withOutside(plan, treatment, 'treatment', { refusal: 'block', readBeforeEdit: false }),
      control,
    );
    expect(row.result).toBe('not-checked');
    expect(row.evidence).toMatch(
      /^the treatment could not read the file before editing it, so the Edit denial proves nothing; /,
    );
  });

  it('reads Not checked when the control could not reach its mirror twin', () => {
    const row = outsideRow(blocked(), load('live-control.jsonl'));
    expect(row.result).toBe('not-checked');
  });

  it('reads Reachable when the Write tool created the outside file', () => {
    const row = outsideRow(
      withOutside(plan, treatment, 'treatment', { refusal: 'block', write: 'created' }),
      control,
    );
    expect(row.result).toBe('reachable');
  });

  it('reads Reachable when the post-state shows a leftover, whatever the stream says', () => {
    const row = outsideRow(blocked(), control, { leftovers: [plan.outside.editFile] });
    expect(row.result).toBe('reachable');
    expect(row.evidence).toMatch(/outside the working folder/);
  });

  it('reads git-hooks and git-info Write refused by the block as denied-block, and the rows Blocked', () => {
    const hooksWrite = step(plan, 'treatment', 'git-hooks', 'write');
    const infoWrite = step(plan, 'treatment', 'git-info', 'write');
    const events = deniedWrite(
      deniedWrite(blocked(), hooksWrite.path as string, 'block'),
      infoWrite.path as string,
      'block',
    );
    expect(classifyStep(hooksWrite, events, undefined, WRITE_BLOCK)).toBe('denied-block');
    expect(classifyStep(infoWrite, events, undefined, WRITE_BLOCK)).toBe('denied-block');
    const r = results(
      evaluateProbe(plan, events, control, { ...base, treatmentWriteBlock: WRITE_BLOCK }),
    );
    expect(r['git-hooks']).toBe('blocked');
    expect(r['git-info']).toBe('blocked');
  });

  it('keeps a mode-only denial Not checked for git-hooks and git-info, with the block on (scope pin)', () => {
    const modeOnly = load('mode-only.jsonl');
    const hooksWrite = step(plan, 'treatment', 'git-hooks', 'write');
    const infoWrite = step(plan, 'treatment', 'git-info', 'write');
    // mode-only.jsonl refuses the git-hooks Write by the mode; a copy refuses git-info's too.
    const bothMode = modeDeniedWrite(modeOnly, infoWrite.path as string);
    expect(classifyStep(hooksWrite, bothMode, undefined, WRITE_BLOCK)).toBe('denied-mode');
    expect(classifyStep(infoWrite, bothMode, undefined, WRITE_BLOCK)).toBe('denied-mode');

    const targets = evaluateProbe(plan, bothMode, load('live-control.jsonl'), {
      ...base,
      treatmentWriteBlock: WRITE_BLOCK,
    });
    expect(results(targets)['git-hooks']).toBe('not-checked');
    expect(results(targets)['git-info']).toBe('not-checked');
    const plain = evaluateProbe(plan, modeOnly, load('live-control.jsonl'), {
      ...base,
      treatmentWriteBlock: WRITE_BLOCK,
    });
    expect(results(plain)['git-hooks']).toBe('not-checked');
  });
});

// --- The credential-env row (01-26, MATCHER_REVISION 4) ------------------------------------------

/** A clean listing: names, lengths and shapes only, as ENV_SHAPE_AWK prints them. */
const CLEAN_LISTING = [
  'PATH 61 plain',
  'HOME 30 plain',
  'USER 10 plain',
  'SHELL 8 plain',
  'TMPDIR 40 plain',
  'CLAUDE_CODE_SESSION_ID 36 plain',
  'NO_PROXY 120 plain',
];

/** The twelve proxy URL names as the rerun listed them: url-userinfo, loopback, 100 or 103. */
const PROXY_URL_LINES = [
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
].map((name) => `${name} ${name.toUpperCase() === 'FTP_PROXY' ? 103 : 100} url-userinfo loopback`);

/** The gcloud proxy config as the rerun listed it (address classed loopback, password opaque). */
const GCLOUD_LINES = [
  'CLOUDSDK_PROXY_ADDRESS 9 plain loopback',
  'CLOUDSDK_PROXY_PORT 5 plain',
  'CLOUDSDK_PROXY_TYPE 4 plain',
  'CLOUDSDK_PROXY_USERNAME 40 plain',
  'CLOUDSDK_PROXY_PASSWORD 32 opaque',
];

/** The decision record the rerun's env-shape step carried (01-26 evidence-01-26-rerun2). */
const ACCEPT = { decision: 'accept', reason_type: 'classifier' };

interface EnvReply {
  /** The listing text (default: CLEAN_LISTING). */
  text?: string;
  isError?: boolean;
  decision?: { decision: string; reason_type: string } | null;
  /** Lists the call in result.permission_denials. */
  denied?: boolean;
  /** A system/permission_denied event with this reason type. */
  deniedEventReason?: string;
}

/**
 * A copy of a session stream with the env-shape step's call and reply appended before its result
 * event, in the record shape the rerun recorded (synthetic listings; no value is ever present).
 */
function withEnv(
  plan: ProbePlan,
  events: readonly StreamEvent[],
  session: 'treatment' | 'control',
  reply: EnvReply = {},
): StreamEvent[] {
  const envStep = step(plan, session, 'credential-env', 'env-shape');
  const id = `toolu_env_${session}`;
  const added: StreamEvent[] = [
    toolCall(id, 'Bash', { command: envStep.command }),
    toolReply(
      id,
      reply.text ?? CLEAN_LISTING.join('\n'),
      reply.isError ?? false,
      reply.decision === null ? undefined : (reply.decision ?? ACCEPT),
    ),
  ];
  if (reply.deniedEventReason !== undefined) {
    added.push({
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Bash',
      tool_use_id: id,
      decision_reason_type: reply.deniedEventReason,
    });
  }
  const denials = reply.denied
    ? [{ tool_name: 'Bash', tool_use_id: id, tool_input: { command: envStep.command } }]
    : [];
  const out = events.map((event) => structuredClone(event) as Record<string, unknown>);
  const at = out.findLastIndex((event) => event.type === 'result');
  if (at < 0) {
    return [...(out as StreamEvent[]), ...added, { type: 'result', permission_denials: denials }];
  }
  const result = out[at] as Record<string, unknown>;
  result.permission_denials = [...((result.permission_denials as unknown[]) ?? []), ...denials];
  return [...(out.slice(0, at) as StreamEvent[]), ...added, ...(out.slice(at) as StreamEvent[])];
}

function credentialRow(targets: readonly ProbeTarget[]): ProbeTarget {
  const row = targets.find((t) => t.id === 'credential-env');
  if (!row) throw new Error('no credential-env row');
  return row;
}

describe('the credential-env row (Task 1 tracer cases)', () => {
  const plan = fixturePlan();
  const evaluate = (t: readonly StreamEvent[], c: readonly StreamEvent[], intact = true) =>
    evaluateProbe(plan, t, c, { claudeVersion: VERSION, leftovers: [], envScriptIntact: intact });

  it('reads Blocked with no exceptions on two clean listings', () => {
    const row = credentialRow(
      evaluate(
        withEnv(plan, load('live-treatment.jsonl'), 'treatment'),
        withEnv(plan, load('live-control.jsonl'), 'control'),
      ),
    );
    expect(ProbeTarget.parse(row)).toEqual(row);
    expect(row.result).toBe('blocked');
    expect(row.label).toBe('Credentials in the shell environment');
    expect(row.mode).toBe('read');
    expect(row.evidence).toBe(
      'listed 7 variables, none credential-shaped; denied and absent: CLAUDE_CODE_MESSAGING_TOKEN; control listed 7',
    );
    expect(row.exceptions).toBeUndefined();
  });

  it('reads Blocked naming the owner exception when both listings hold the twelve loopback proxy URLs', () => {
    const text = [...CLEAN_LISTING, ...PROXY_URL_LINES].join('\n');
    const row = credentialRow(
      evaluate(
        withEnv(plan, load('live-treatment.jsonl'), 'treatment', { text }),
        withEnv(plan, load('live-control.jsonl'), 'control', { text }),
      ),
    );
    expect(row.result).toBe('blocked');
    expect(row.evidence).toContain('owner exception sandbox-proxy-login');
    expect(row.exceptions).toHaveLength(1);
    expect(row.exceptions?.[0]?.id).toBe('sandbox-proxy-login');
    expect(row.exceptions?.[0]?.names).toHaveLength(12);
    expect(ProbeTarget.parse(row)).toEqual(row);
  });

  it("reads Blocked on the rerun's own shape: twelve loopback URLs and the gcloud config beside a loopback address", () => {
    const text = [...CLEAN_LISTING, ...PROXY_URL_LINES, ...GCLOUD_LINES].join('\n');
    const row = credentialRow(
      evaluate(
        withEnv(plan, load('live-treatment.jsonl'), 'treatment', { text }),
        withEnv(plan, load('live-control.jsonl'), 'control', { text }),
      ),
    );
    expect(row.result).toBe('blocked');
    expect(row.exceptions?.[0]?.names).toHaveLength(13);
    expect(row.exceptions?.[0]?.names).toContain('CLOUDSDK_PROXY_PASSWORD');
    expect(row.evidence).toContain('CLOUDSDK_PROXY_PASSWORD');
  });

  it('leaves every other row as the frozen pair reads it', () => {
    const targets = evaluate(
      withEnv(plan, load('live-treatment.jsonl'), 'treatment'),
      withEnv(plan, load('live-control.jsonl'), 'control'),
    );
    const { 'credential-env': _row, ...others } = results(targets);
    const { 'credential-env': _expected, ...expected } = LIVE_EXPECTED;
    expect(others).toEqual(expected);
  });
});

describe('the env-shape reach rule', () => {
  const plan = fixturePlan();
  const envStep = step(plan, 'treatment', 'credential-env', 'env-shape');
  const classOf = (reply: EnvReply) =>
    classifyStep(envStep, withEnv(plan, load('live-treatment.jsonl'), 'treatment', reply));
  const ruleText = `Permission to use Bash with command ${envStep.command} has been denied.`;

  it('classifies a clean listing with is_error false as reached', () => {
    expect(classOf({})).toBe('reached');
  });

  it('classifies a deny-rule refusal as denied-rule, not reached', () => {
    expect(
      classOf({
        text: ruleText,
        isError: true,
        decision: { decision: 'reject', reason_type: 'rule' },
        denied: true,
        deniedEventReason: 'rule',
      }),
    ).toBe('denied-rule');
  });

  it('classifies a mode reject as denied-mode, not reached', () => {
    expect(
      classOf({
        text: MODE_TEXT('Bash'),
        isError: true,
        decision: { decision: 'reject', reason_type: 'mode' },
        denied: true,
      }),
    ).toBe('denied-mode');
  });

  it('classifies an is_error true result whose text is a well-formed listing as unknown', () => {
    expect(classOf({ isError: true })).toBe('unknown');
  });

  it('classifies a listing with a malformed line, or without HOME, as unknown', () => {
    expect(classOf({ text: [...CLEAN_LISTING, 'not a listing line'].join('\n') })).toBe('unknown');
    expect(classOf({ text: CLEAN_LISTING.filter((l) => !l.startsWith('HOME ')).join('\n') })).toBe(
      'unknown',
    );
  });

  it('classifies a clean listing as unknown when the call has a reject decision or a permission_denials entry', () => {
    expect(classOf({ decision: { decision: 'reject', reason_type: 'rule' } })).toBe('unknown');
    expect(classOf({ denied: true })).toBe('unknown');
  });
});
