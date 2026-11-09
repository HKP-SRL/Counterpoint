// Live differential sandbox probe against the owner's real `claude` binary (01-04 Task 2).
//
// Gated by COUNTERPOINT_LIVE_PROBE=1: it needs a signed-in `claude` and spends a few cents of
// haiku. Every protected directory here is a scratch directory (a fake home with .ssh and
// .config/gh, a fake Counterpoint home under "Application Support", a fake signing-key dir and a
// scratch git repo); the owner's real directories are never targeted. The test asserts raw facts
// only (the verdict evaluator lands in 01-05) and then freezes both raw streams, redacted, as
// fixtures under tests/fixtures/stream-json/.
import { mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { type ProbeStep, runSandboxProbe } from '../../src/agent/probe.ts';
import { ClaudeCliRunner } from '../../src/agent/runner.ts';
import type { ProtectedPaths } from '../../src/core/security/sandbox-settings.ts';
import { initScratchRepo, makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'stream-json');
const DEBUG_DIR = join(REPO_ROOT, '.tmp', 'live-probe');

/** Every file or directory name under `dir` (recursive). */
function walkNames(dir: string): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    names.push(entry.name);
    if (entry.isDirectory()) names.push(...walkNames(join(dir, entry.name)));
  }
  return names;
}

function deepReplaceSessionIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepReplaceSessionIds);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = key === 'session_id' ? 'fixture-session' : deepReplaceSessionIds(inner);
    }
    return out;
  }
  return value;
}

/**
 * Redacts a raw stream for a fixture: known absolute prefixes become /FIXTURE/..., any remaining
 * /Users/<name> or /private/var/folders/... prefix becomes /FIXTURE, session ids become
 * `fixture-session`, and the init event keeps only type, subtype, model, tools and version.
 */
function redact(raw: string, prefixes: ReadonlyArray<readonly [string, string]>): string {
  const ordered = [...prefixes].sort((a, b) => b[0].length - a[0].length);
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    let text = line;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const reduced =
        event.type === 'system' && event.subtype === 'init'
          ? {
              type: event.type,
              subtype: event.subtype,
              model: event.model,
              tools: event.tools,
              claude_code_version: event.claude_code_version,
            }
          : deepReplaceSessionIds(event);
      text = JSON.stringify(reduced);
    } catch {
      // keep the raw line; still redacted below
    }
    for (const [prefix, replacement] of ordered) text = text.split(prefix).join(replacement);
    text = text
      .replace(/\/Users\/[^/"\s\\]+/g, '/FIXTURE/home')
      .replace(/\/(private\/)?var\/folders\/[^"\s\\]*?\/T(?=\/|")/g, '/FIXTURE/tmp');
    lines.push(text);
  }
  return `${lines.join('\n')}\n`;
}

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

/** Every tool_use block in a raw stream. */
function toolUses(raw: string): ToolUse[] {
  const uses: ToolUse[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    let event: { type?: string; message?: { content?: unknown } };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content as Array<Record<string, unknown>>) {
      if (block.type === 'tool_use') {
        uses.push({
          name: String(block.name),
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }
  }
  return uses;
}

/** True when the session really attempted the step (right tool, right path or command). */
function attempted(step: ProbeStep, uses: readonly ToolUse[]): boolean {
  return uses.some((use) => {
    if (use.name !== step.tool) return false;
    if (step.tool === 'Bash') {
      return String(use.input.command ?? '').includes(step.path ?? (step.command as string));
    }
    if (step.tool === 'Grep') return use.input.path === step.path;
    return use.input.file_path === step.path;
  });
}

afterAll(() => {
  removeScratchDirs();
});

describe.skipIf(process.env.COUNTERPOINT_LIVE_PROBE !== '1')('live sandbox probe', () => {
  it('keeps every protected canary out of the treatment stream and reaches every mirror canary in the control stream', async () => {
    const root = makeScratchDir('live');
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
    const gitDir = join(repo, '.git');
    const protectedPaths: ProtectedPaths = {
      homeDir: home,
      counterpointHome: cpHome,
      signingKeyDir: keyDir,
      ghConfigDir: join(home, '.config', 'gh'),
      hostGitDir: gitDir,
    };
    const gitNamesBefore = walkNames(gitDir);

    const outcome = await runSandboxProbe({
      protectedPaths,
      runner: new ClaudeCliRunner(),
      logDir: join(root, 'logs'),
      model: 'haiku',
    });
    const { plan, treatment, control } = outcome;

    // Keep unredacted copies for diagnosis (gitignored .tmp/).
    mkdirSync(DEBUG_DIR, { recursive: true });
    writeFileSync(join(DEBUG_DIR, 'treatment.jsonl'), treatment.raw);
    writeFileSync(join(DEBUG_DIR, 'control.jsonl'), control.raw);
    writeFileSync(join(DEBUG_DIR, 'stderr.txt'), `${treatment.stderr}\n---\n${control.stderr}`);

    // Both sessions really ran to a result.
    expect(treatment.result, treatment.stderr).not.toBeNull();
    expect(control.result, control.stderr).not.toBeNull();

    // Both sessions attempted every planned step; a skipped step would make a "no canary in the
    // treatment stream" result meaningless (RESEARCH Pitfall 1).
    const tUses = toolUses(treatment.raw);
    const cUses = toolUses(control.raw);
    const missing = (steps: readonly ProbeStep[], uses: readonly ToolUse[]) =>
      steps.filter((step) => !attempted(step, uses)).map((s) => `${s.index} ${s.instruction}`);
    expect(missing(plan.treatment.steps, tUses), 'treatment skipped steps').toEqual([]);
    expect(missing(plan.control.steps, cUses), 'control skipped steps').toEqual([]);

    // Treatment: no protected canary file's value anywhere in the raw stream.
    for (const canary of plan.protectedCanaries) {
      expect(treatment.raw.includes(canary.value), `${canary.target} canary leaked`).toBe(false);
    }

    // The temporary Keychain item (RESEARCH A5 proxy for gh's keyring entry) is recorded, not
    // asserted: its verdict belongs to the evaluator (01-05), which reports the gh row Reachable
    // when the value shows up. On claude 2.1.319 / macOS it did show up (A5 is false); that is an
    // owner decision, surfaced in 01-04-SUMMARY, not something this test may hide or bake in.
    const keychainReachable =
      outcome.keychainCreated && treatment.raw.includes(plan.keychain.value);
    writeFileSync(
      join(DEBUG_DIR, 'keychain.txt'),
      `created=${outcome.keychainCreated} reachableFromTreatment=${keychainReachable}\n`,
    );
    if (keychainReachable) {
      console.warn(
        'LIVE PROBE FINDING: the temporary Keychain canary item was readable from the sandboxed treatment session (RESEARCH A5 does not hold).',
      );
    }

    // Control: every mirror canary value was reached.
    for (const canary of plan.mirrorCanaries) {
      expect(control.raw.includes(canary.value), `${canary.target} mirror not reached`).toBe(true);
    }

    // The unprotected control canary was reached by both sessions.
    expect(treatment.raw).toContain(plan.controlCanary.value);
    expect(control.raw).toContain(plan.controlCanary.value);

    // No nonce file was created under the git dir.
    expect(outcome.leftovers).toEqual([]);
    const gitNamesAfter = walkNames(gitDir);
    expect(gitNamesAfter.filter((name) => name.includes(plan.nonce))).toEqual([]);
    expect(gitNamesAfter.filter((name) => !gitNamesBefore.includes(name))).toEqual([]);

    // Freeze both streams as redacted fixtures.
    const tmpReal = realpathSync(tmpdir());
    const prefixes: Array<[string, string]> = [
      [plan.probeDir, '/FIXTURE/probe'],
      [root, '/FIXTURE/scratch'],
      [tmpReal, '/FIXTURE/tmp'],
      [tmpdir(), '/FIXTURE/tmp'],
      [homedir(), '/FIXTURE/home'],
      [REPO_ROOT, '/FIXTURE/repo'],
    ];
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(join(FIXTURE_DIR, 'live-treatment.jsonl'), redact(treatment.raw, prefixes));
    writeFileSync(join(FIXTURE_DIR, 'live-control.jsonl'), redact(control.raw, prefixes));
  }, 900_000);
});
