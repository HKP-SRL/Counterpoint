// The gate-sandbox probe row (doctor: Build-lane probe rows). No agent session: Counterpoint runs
// short commands under the gate profile (build/gate-sandbox.ts) exactly as the gate runner will,
// and judges by outcome, never by error text:
// - read: `cat` a nonce canary planted in each protected read directory that exists. A canary
//   value in the output is Reachable. Control: `cat` an unprotected canary in the gate's own
//   folder must print its value.
// - write: `touch` a file in an outside folder (`~/.cp-outside-<nonce>`); it must not appear.
//   Control: `touch` inside the gate's folder must work.
// - network: Node `fetch` (through srt's proxy, as a Node test would) and a raw TCP connect to a
//   stand-in for the console (a probe listener on a port the profile does not list) must not reach
//   it. Control: `fetch` to a listener on a port the profile lists must reach it.
// A step whose control did not succeed leaves the row Not checked: a refusal then proves nothing.
// Every file the probe plants uses the probe's nonce patterns, so the doctor's stale sweep removes
// leftovers of a killed run.
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { buildGateSandboxSettings, gateArgv } from '../build/gate-sandbox.ts';
import type {
  ProbeStepClass,
  ProbeStepRecord,
  ProbeTarget,
} from '../core/security/doctor-report.ts';
import {
  buildAgentSandboxSettings,
  type ProtectedPaths,
} from '../core/security/sandbox-settings.ts';

const STEP_TIMEOUT_MS = 30_000;
const CANARY_MARKER = 'cp-canary-value-';

export interface GateSandboxProbeInput {
  protectedPaths: Omit<ProtectedPaths, 'workdir'>;
  /** The console port the stand-in plays (recorded in the evidence; never listed). */
  consolePort: number;
  tmpRoot?: string;
  /** For tests: a fixed nonce. */
  nonce?: string;
}

const hex = () => randomBytes(16).toString('hex');

function listen(): Promise<{ server: Server; port: number; hits: () => number }> {
  let count = 0;
  const server = createServer((_req, res) => {
    count += 1;
    res.end('ok');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, hits: () => count });
    });
  });
}

const NET_SCRIPT = `
const [allowed, standIn] = process.argv.slice(1).map(Number);
const net = await import('node:net');
const out = {};
for (const [name, port] of [['allowed', allowed], ['standIn', standIn]]) {
  out[name] = await fetch('http://127.0.0.1:' + port + '/').then((r) => r.status, (e) => 'refused');
}
out.raw = await new Promise((resolve) => {
  const s = net.connect(standIn, '127.0.0.1');
  s.on('connect', () => { s.end(); resolve('connected'); });
  s.on('error', (e) => resolve(e.code ?? 'error'));
});
console.log('cp-net=' + JSON.stringify(out));
`;

export async function runGateSandboxProbe(input: GateSandboxProbeInput): Promise<ProbeTarget> {
  const nonce = input.nonce ?? hex();
  const base = realpathSync(mkdtempSync(join(input.tmpRoot ?? tmpdir(), 'cp-probe-gate-')));
  const workdir = join(base, 'work');
  const gateTmp = join(base, 'tmp');
  mkdirSync(workdir);
  mkdirSync(gateTmp);
  const agent = buildAgentSandboxSettings({ ...input.protectedPaths });
  const canaries: { path: string; value: string }[] = [];
  const outsideDir = join(input.protectedPaths.homeDir, `.cp-outside-${nonce}`);
  const outsideFile = join(outsideDir, `cp-${nonce}-b`);
  const servers: Server[] = [];
  const row = { id: 'gate-sandbox' as const, label: 'Gate sandbox', mode: 'write' as const };

  try {
    // One canary per directory: the signing key often lives in ~/.ssh, so two targets share one.
    for (const dir of new Set(agent.readTargets.map((target) => target.path))) {
      if (!existsSync(dir)) continue;
      const path = join(dir, `.cp-canary-${nonce}`);
      const value = `${CANARY_MARKER}${hex()}`;
      writeFileSync(path, `${value}\n`, { mode: 0o600, flag: 'wx' });
      canaries.push({ path, value });
    }
    const control = {
      path: join(workdir, `.cp-canary-${nonce}`),
      value: `${CANARY_MARKER}${hex()}`,
    };
    writeFileSync(control.path, `${control.value}\n`, { mode: 0o600, flag: 'wx' });
    mkdirSync(outsideDir, { mode: 0o700 });

    const allowed = await listen();
    const standIn = await listen();
    servers.push(allowed.server, standIn.server);
    const settingsPath = join(base, 'gate-settings.json');
    writeFileSync(
      settingsPath,
      JSON.stringify(
        buildGateSandboxSettings({
          protectedPaths: input.protectedPaths,
          workdir,
          tmpDir: gateTmp,
          ports: [allowed.port],
          consolePort: input.consolePort,
        }),
      ),
      { mode: 0o600 },
    );
    const run = async (command: string[]) => {
      const argv = gateArgv(settingsPath, command);
      const result = await execa(argv[0] as string, argv.slice(1), {
        cwd: workdir,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: input.protectedPaths.homeDir },
        extendEnv: false,
        stdin: 'ignore',
        timeout: STEP_TIMEOUT_MS,
        reject: false,
        all: true,
      });
      return String(result.all ?? '');
    };

    // read
    const readOut = await run(['/bin/cat', control.path, ...canaries.map((c) => c.path)]);
    const readControl = readOut.includes(control.value);
    const readLeak = canaries.some((c) => readOut.includes(c.value));
    // write
    await run(['/usr/bin/touch', outsideFile, join(workdir, `cp-${nonce}-in`)]);
    const writeControl = existsSync(join(workdir, `cp-${nonce}-in`));
    const writeLeak = existsSync(outsideFile);
    // network
    const netOut = await run([
      process.execPath,
      '--input-type=module',
      '-e',
      NET_SCRIPT,
      String(allowed.port),
      String(standIn.port),
    ]);
    const netControl = allowed.hits() > 0;
    const netLeak = standIn.hits() > 0 || /"raw":"connected"/.test(netOut);

    const cls = (
      leak: boolean,
      controlOk: boolean,
    ): { treatment: ProbeStepClass; control: ProbeStepClass } => ({
      treatment: leak ? 'reached' : controlOk ? 'denied-os' : 'unknown',
      control: controlOk ? 'reached' : 'unknown',
    });
    const steps: ProbeStepRecord[] = [
      { index: 1, tool: 'Bash', operation: 'cat', ...cls(readLeak, readControl) },
      { index: 2, tool: 'Bash', operation: 'touch', ...cls(writeLeak, writeControl) },
      { index: 3, tool: 'Bash', operation: 'connect', ...cls(netLeak, netControl) },
    ];
    const leaks: ProbeTarget['leaks'] = [];
    if (readLeak) leaks.push('file-canary');
    if (writeLeak) leaks.push('leftover');
    const reached = [
      readLeak && 'a protected file',
      writeLeak && 'a folder outside its own',
      netLeak && 'a port it does not list (console stand-in)',
    ].filter((x): x is string => typeof x === 'string');
    if (reached.length > 0) {
      return {
        ...row,
        result: 'reachable',
        evidence: `A command under the gate sandbox reached ${reached.join(', ')}.`,
        steps,
        leaks,
        trusted: true,
      };
    }
    const failedControls = [
      !readControl && 'read',
      !writeControl && 'write',
      !netControl && 'allowed port',
    ].filter((x): x is string => typeof x === 'string');
    if (failedControls.length > 0 || canaries.length === 0) {
      return {
        ...row,
        result: 'not-checked',
        evidence:
          canaries.length === 0
            ? 'No protected read directory exists to plant a canary in.'
            : `The gate sandbox refused its own allowed ${failedControls.join(', ')} too, so its refusals prove nothing.`,
        steps,
        leaks,
        trusted: false,
      };
    }
    return {
      ...row,
      result: 'blocked',
      evidence: `Under the gate sandbox a command read none of ${canaries.length} protected canaries, wrote nothing outside its folder and could not reach an unlisted port (stand-in for the console on ${input.consolePort}); it reached its own folder and its listed port.`,
      steps,
      leaks,
      trusted: true,
    };
  } finally {
    for (const server of servers) server.close();
    for (const canary of canaries) {
      try {
        unlinkSync(canary.path);
      } catch {
        // already gone
      }
    }
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  }
}
