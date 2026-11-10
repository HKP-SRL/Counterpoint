// The live environment listing of one sandboxed Bash command on the owner's real `claude` (01-26,
// replacement 3 of 3 for the scrub opt-out, STATE.md [Owner] 2026-11-10).
//
// Gated by COUNTERPOINT_LIVE_PROBE=1: it needs a signed-in `claude` and spends a few cents of
// haiku. One session runs the production launch profile (buildAgentSandboxSettings, unchanged,
// with a scratch probe directory as its workdir) through ClaudeCliRunner, so agentEnv and the scrub
// opt-out apply exactly as for a builder. Every protected path is scratch (a fake home with .ssh
// and .config/gh, a fake Counterpoint home, a fake signing-key dir and a scratch git repo); the
// owner's real directories are never targeted. The probe directory is under CP_TEST_SCRATCH.
//
// The session makes exactly one call: the env-shape step, `awk -f '{probeDir}/cp-env-{nonce}.awk'`,
// running Counterpoint's own ENV_SHAPE_AWK. It prints each variable's name, length and shape word,
// never a value. The listing is parsed and judged with src/agent/env-listing.ts, the same code the
// evaluator's credential-env row uses; this test never imports the evaluator.
//
// Before the session, the test records the state of src/agent/probe-evaluator.ts (`evaluator`:
// HEAD, the committed blob at HEAD and the working-tree blob), so a gate can check that the live
// listing ran before any evaluator edit (the owner's ordering rule).
//
// Evidence first: stream.jsonl, stderr.txt, session.json and env-listing.json are written to
// .tmp/live-env/ (gitignored) and copied to $CP_TEST_SCRATCH/evidence-01-26-live/ before any
// assertion, so a failing run keeps its evidence. Only names, lengths and shapes are recorded.
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';
import { AGENT_PERMISSION_MODE, buildClaudeArgv } from '../../src/agent/claude-argv.ts';
import { credentialFindings, parseEnvListing } from '../../src/agent/env-listing.ts';
import { ENV_SHAPE_AWK, envShapeStep, probePrompt } from '../../src/agent/probe.ts';
import { ClaudeCliRunner, type StreamEvent } from '../../src/agent/runner.ts';
import {
  buildAgentSandboxSettings,
  type ProtectedPaths,
} from '../../src/core/security/sandbox-settings.ts';
import { initScratchRepo, makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEBUG_DIR = join(REPO_ROOT, '.tmp', 'live-env');
const EVIDENCE_DIR = join(
  process.env.CP_TEST_SCRATCH ?? join(REPO_ROOT, '.tmp'),
  'evidence-01-26-live',
);
const EVALUATOR = 'src/agent/probe-evaluator.ts';
const NOTICE_RE = /permission mode|auto mode/i;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function contentBlocks(event: StreamEvent): Json[] {
  const message = (event as Json).message;
  if (!isObject(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isObject);
}

interface ToolUse {
  id: string;
  name: string;
  input: Json;
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

/** The tool_result block and tool_result_meta entry of one tool call, if any. */
function resultOf(events: readonly StreamEvent[], useId: string): { block?: Json; meta?: Json } {
  for (const event of events) {
    if (event.type !== 'user') continue;
    const block = contentBlocks(event).find(
      (b) => b.type === 'tool_result' && b.tool_use_id === useId,
    );
    if (!block) continue;
    const metaList = (event as Json).tool_result_meta;
    const meta = Array.isArray(metaList)
      ? metaList.filter(isObject).find((m) => m.id === useId)
      : undefined;
    return { block, meta };
  }
  return {};
}

function notices(stderr: string): string[] {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && NOTICE_RE.test(line));
}

/** The scratch protected layout (no real directory of the owner). */
async function scratchLayout(): Promise<ProtectedPaths> {
  const root = makeScratchDir('lenv');
  const home = join(root, 'home');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(join(home, '.config', 'gh'), { recursive: true });
  const cpHome = join(root, 'Library', 'Application Support', 'Counterpoint');
  mkdirSync(cpHome, { recursive: true });
  const keyDir = join(root, 'keys');
  mkdirSync(keyDir);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  await initScratchRepo(repo);
  return {
    homeDir: home,
    counterpointHome: cpHome,
    signingKeyDir: keyDir,
    ghConfigDir: join(home, '.config', 'gh'),
    hostGitDir: join(repo, '.git'),
  };
}

/** A read-only git query in the repository root (argument array, no shell). */
async function gitRead(args: readonly string[]): Promise<{ stdout: string; exitCode: number }> {
  const result = await execa('git', [...args], {
    cwd: REPO_ROOT,
    stdin: 'ignore',
    reject: false,
    timeout: 15_000,
  });
  return { stdout: String(result.stdout ?? '').trim(), exitCode: result.exitCode ?? -1 };
}

afterAll(() => {
  removeScratchDirs();
});

describe.skipIf(process.env.COUNTERPOINT_LIVE_PROBE !== '1')('live environment listing', () => {
  it('lists the sandboxed Bash environment by name, length and shape, unrefused, in auto mode', async () => {
    const protectedPaths = await scratchLayout();
    const probeDir = makeScratchDir('lprb');
    const nonce = randomBytes(16).toString('hex');
    const profile = buildAgentSandboxSettings({ ...protectedPaths, workdir: probeDir });

    const scriptPath = join(probeDir, `cp-env-${nonce}.awk`);
    writeFileSync(scriptPath, ENV_SHAPE_AWK, { mode: 0o600, flag: 'wx' });
    const step = { index: 1, ...envShapeStep(scriptPath) };

    // The evaluator's state when the listing runs (the owner's rule: live proof before evaluator
    // work). Read-only git queries only.
    const evaluator = {
      head: (await gitRead(['rev-parse', 'HEAD'])).stdout,
      headBlob: (await gitRead(['rev-parse', `HEAD:${EVALUATOR}`])).stdout,
      blob: (await gitRead(['hash-object', EVALUATOR])).stdout,
      uncommittedEdit: (await gitRead(['diff', '--quiet', 'HEAD', '--', EVALUATOR])).exitCode !== 0,
    };

    const runner = new ClaudeCliRunner();
    const claudeVersion = await runner.version();
    const argv = buildClaudeArgv({
      settings: profile.settings,
      model: 'haiku',
      maxTurns: 4,
      maxBudgetUsd: 0.1,
      allowedTools: profile.allowedTools,
      prompt: probePrompt([step]),
    });
    const run = await runner.run({
      argv,
      cwd: probeDir,
      timeoutMs: 240_000,
      rawLogPath: join(makeScratchDir('lelog'), 'env.jsonl'),
    });

    // --- Evidence, before any assertion ---------------------------------------------------------
    const inits = run.events.filter((e) => e.type === 'system' && e.subtype === 'init') as Json[];
    const modes = [...new Set(inits.map((e) => e.permissionMode))];
    const uses = toolUses(run.events);
    const stepUse = uses.find((u) => u.name === 'Bash' && u.input.command === step.command);
    const { block, meta } = stepUse === undefined ? {} : resultOf(run.events, stepUse.id);
    const pd = isObject(meta?.permission_decision) ? meta.permission_decision : null;
    const deniedEvent = run.events.find(
      (e) =>
        e.type === 'system' &&
        e.subtype === 'permission_denied' &&
        stepUse !== undefined &&
        (e as Json).tool_use_id === stepUse.id,
    ) as Json | undefined;
    const denials = run.events
      .filter((e) => e.type === 'result')
      .flatMap((e) => {
        const list = (e as Json).permission_denials;
        return Array.isArray(list) ? list.filter(isObject) : [];
      });
    // The same normalisation the evaluator applies to a tool result's text.
    const text =
      block === undefined
        ? ''
        : resultText(block.content)
            .replace(/^<tool_use_error>/, '')
            .replace(/<\/tool_use_error>$/, '')
            .trim();
    const listing = parseEnvListing(text);
    const findings = credentialFindings(listing.entries);
    const session = {
      claudeVersion,
      permissionMode: modes.length === 1 ? modes[0] : modes,
      initCount: inits.length,
      model: inits[0]?.model ?? null,
      notices: notices(run.stderr),
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      resultSubtype: isObject(run.result) ? (run.result as Json).subtype : null,
      stepCommand: step.command,
      toolUses: uses.map((u) => ({
        name: u.name,
        command: typeof u.input.command === 'string' ? u.input.command : null,
      })),
      decision:
        pd === null
          ? null
          : { decision: pd.decision, source: pd.source, reason_type: pd.reason_type },
      deniedEvent:
        deniedEvent === undefined
          ? null
          : {
              decision_reason_type: deniedEvent.decision_reason_type,
              decision_reason: deniedEvent.decision_reason,
            },
      inPermissionDenials:
        stepUse !== undefined && denials.some((d) => d.tool_use_id === stepUse.id),
      isError: typeof block?.is_error === 'boolean' ? block.is_error : null,
      evaluator,
    };
    mkdirSync(DEBUG_DIR, { recursive: true });
    writeFileSync(join(DEBUG_DIR, 'stream.jsonl'), run.raw);
    writeFileSync(join(DEBUG_DIR, 'stderr.txt'), run.stderr);
    writeFileSync(join(DEBUG_DIR, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
    writeFileSync(
      join(DEBUG_DIR, 'env-listing.json'),
      `${JSON.stringify({ malformed: listing.malformed, entries: listing.entries, findings }, null, 2)}\n`,
    );
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    cpSync(DEBUG_DIR, EVIDENCE_DIR, { recursive: true });

    // --- Assertions -------------------------------------------------------------------------------
    expect.soft(evaluator.uncommittedEdit, 'uncommitted evaluator edit').toBe(false);
    expect.soft(evaluator.blob, 'evaluator blob').toBe(evaluator.headBlob);
    expect.soft(session.permissionMode, 'init permissionMode').toBe(AGENT_PERMISSION_MODE);
    expect.soft(session.notices, 'notices').toEqual([]);
    expect.soft(session.toolUses, 'tool uses').toEqual([{ name: 'Bash', command: step.command }]);
    expect.soft(session.isError, 'is_error').toBe(false);
    expect.soft(session.decision?.decision, 'decision').not.toBe('reject');
    expect.soft(session.deniedEvent, 'permission_denied event').toBeNull();
    expect.soft(session.inPermissionDenials, 'listed in permission_denials').toBe(false);
    expect.soft(listing.malformed, 'malformed lines').toBe(0);
    const names = listing.entries.map((e) => e.name);
    expect.soft(names, 'PATH').toContain('PATH');
    expect.soft(names, 'HOME').toContain('HOME');
    // `findings` is recorded, not asserted: the plan's stop rule (e) decides.
  }, 600_000);
});
