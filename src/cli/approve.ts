// `counterpoint approve {host} {phase}` (APPR-01, APPR-04, MISN-01).
//
// The command is ID-only: both ids are validated by the strict regexes before any lookup, path or
// argv use, and everything else is re-derived from git at signing time (RESEARCH Pitfall 8,
// Pattern 4). It refuses, writing nothing, unless a key is trusted, the host's integrity baseline
// exists and still matches, the phase is Ready to approve and a terminal is attached. Then it
// prints exactly what is being signed (every input digest in full, the gate slot, the statement
// fingerprint, the prerequisites and the signer), and lets ssh-keygen ask for the passphrase at
// the terminal. The signature is checked against the trusted key before anything lands; the
// commit lands by compare-and-swap on the LOCAL base branch without touching the owner's work, is
// verified again from git, and the new runway is reported. Nothing is pushed.
import { mkdirSync, statSync } from 'node:fs';
import { execa } from 'execa';
import { adapterFor } from '../compose.ts';
import { signAndLand } from '../core/approvals/commit.ts';
import {
  checkIntegrity,
  INTEGRITY_REFUSAL,
  type IntegrityState,
} from '../core/approvals/integrity.ts';
import {
  type PreparedApproval,
  type PrepareRefusal,
  prepareApproval,
} from '../core/approvals/prepare.ts';
import { signPayload, verifySignature } from '../core/approvals/ssh.ts';
import { OWNER_PRINCIPAL, readTrust } from '../core/approvals/trust-store.ts';
import { createGitFileReader } from '../core/git/reader.ts';
import { cleanGitEnv, gitBinary } from '../core/git/run.ts';
import { homePaths } from '../core/host/home.ts';
import { assertHostId, assertPhaseId, InvalidIdError } from '../core/ids.ts';
import { approvalState, computeRunway } from '../core/runway/runway.ts';
import {
  getHost,
  type HostRow,
  listHosts,
  openStoreReadOnly,
  stateDbPath,
} from '../core/store/db.ts';
import { NO_TRUSTED_KEY_FIX } from '../doctor/signing-key.ts';
import { controlRequest, isDaemonRunning } from './control-client.ts';
import { describeChange, printable } from './trust.ts';

export interface ApprovalNotice {
  hostId: string;
  family: 'approval';
}

export interface ApproveCommandOptions {
  home: string;
  hostId: string;
  phaseId: string;
  /** True when stdin and stdout are a terminal (the passphrase is typed there). */
  isTTY: boolean;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Signs the exact commit payload. Default: ssh-keygen with the trusted private key. */
  sign?: (payload: Uint8Array) => Promise<string>;
  /** Tells a running daemon that an approval landed. Default: POST /control/notify if running. */
  notify?: (home: string, body: ApprovalNotice) => Promise<void>;
}

const FALLBACK_IDENT = { name: 'Counterpoint owner', email: 'owner@counterpoint' };

/** Nudges a running daemon; does nothing when none runs. Best effort: never fails the command. */
export async function notifyApproval(home: string, body: ApprovalNotice): Promise<void> {
  try {
    if ((await isDaemonRunning(home)) === null) return;
    await controlRequest(home, 'POST', '/control/notify', body);
  } catch {
    // The console refreshes from git on its own; a missed nudge only delays it.
  }
}

type HostResult = { ok: true; host: HostRow } | { ok: false; message: string };

function findHost(home: string, hostId: string): HostResult {
  if (statSync(stateDbPath(home), { throwIfNoEntry: false }) === undefined) {
    return { ok: false, message: 'No project registered yet. Run counterpoint inside it first.' };
  }
  const store = openStoreReadOnly(home);
  try {
    const host = getHost(store, hostId);
    if (host !== undefined) return { ok: true, host };
    const ids = listHosts(store).map((h) => h.id);
    return {
      ok: false,
      message: `Unknown project "${hostId}". Registered: ${ids.length === 0 ? '(none)' : ids.join(', ')}.`,
    };
  } finally {
    store.close();
  }
}

/**
 * The signer identity from the host repository's normal git config lookup (local, then the
 * owner's global config). Reading only: `git config --get`, hooks and fsmonitor disabled.
 */
async function signerIdentity(root: string): Promise<{ name: string; email: string }> {
  const env: Record<string, string> = { ...cleanGitEnv() };
  delete env.GIT_CONFIG_GLOBAL;
  delete env.GIT_CONFIG_SYSTEM;
  delete env.GIT_CONFIG_NOSYSTEM;
  const read = async (key: string): Promise<string> => {
    const result = await execa(
      gitBinary(),
      ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'config', '--get', key],
      { cwd: root, env, extendEnv: false, reject: false, stdin: 'ignore', timeout: 10_000 },
    );
    return result.exitCode === 0 ? String(result.stdout).trim() : '';
  };
  const name = await read('user.name');
  const email = await read('user.email');
  const usable = (v: string) => v !== '' && v.length <= 200 && !/[<>\n\r\0]/.test(v);
  return usable(name) && usable(email) ? { name, email } : { ...FALLBACK_IDENT };
}

function refusalMessage(refusal: PrepareRefusal, host: HostRow, phaseId: string): string {
  switch (refusal.reason) {
    case 'not-ready':
      return refusal.notReadyReason === 'no-plans'
        ? `Not ready to approve. Phase ${phaseId} has context but no plans yet. You sign the exact plans the builder will run. Run /gsd-plan-phase ${phaseId} in ${host.id}, then come back.`
        : `Not ready to approve. Phase ${phaseId} has no CONTEXT.md yet. Run /gsd-discuss-phase ${phaseId} and /gsd-plan-phase ${phaseId} in ${host.id}, then come back.`;
    case 'built':
      return `Phase ${phaseId} is already built. Approval is not offered.`;
    case 'unreadable':
      return `Couldn't read Phase ${phaseId}: ${printable(refusal.file)} could not be parsed: ${printable(refusal.detail)}.`;
    case 'not-found':
      return `Phase ${phaseId} is not in ${host.id}'s planning on ${host.baseBranch}.`;
    case 'no-base':
      return `The base branch ${printable(host.baseBranch)} of ${host.id} does not resolve to a commit.`;
    case 'gates-config':
      return `Couldn't read the gate config: ${printable(refusal.detail)}`;
  }
}

function signingBlock(
  prepared: PreparedApproval,
  hostId: string,
  baseBranch: string,
  ident: { name: string; email: string },
): string[] {
  const { statement, prerequisites } = prepared;
  const lines = [
    'You are signing',
    `  Phase ${prepared.phase.id}: ${printable(prepared.phase.name)}`,
    `  Project: ${hostId}`,
    `  Base: ${printable(baseBranch)} at ${prepared.tip}`,
    '  Inputs:',
  ];
  for (const input of prepared.inputs) {
    const normalized = input.normalization === null ? '' : ` (normalized: ${input.normalization})`;
    lines.push(`    ${input.digest}  ${printable(input.label)}${normalized}`);
  }
  lines.push(`  Combined: ${statement.inputs.combined}`);
  lines.push('  Draft: none');
  lines.push(
    `  Gates: ${statement.gates.state === 'absent' ? 'none yet' : statement.gates.digest}`,
  );
  lines.push(`  Statement ${prepared.fingerprint}`);
  const setup = prerequisites.userSetup;
  if (setup.length === 0 && prerequisites.nonAutonomous === 0) {
    lines.push('  Prerequisites: none');
  } else {
    lines.push('  Prerequisites:');
    for (const item of setup) {
      const why = item.why === null ? '' : `: ${printable(item.why)}`;
      const vars = item.envVars.length === 0 ? '' : ` (${item.envVars.map(printable).join(', ')})`;
      lines.push(`    - ${printable(item.service)}${why}${vars}`);
    }
    if (prerequisites.nonAutonomous > 0) {
      lines.push(
        `    - ${prerequisites.nonAutonomous} of ${prerequisites.total} plans need you present (not autonomous).`,
      );
    }
  }
  lines.push(`  Signing as ${printable(ident.name)} <${printable(ident.email)}>`);
  return lines;
}

class SignatureRejected extends Error {}
class SigningFailed extends Error {}

export async function approveCommand(options: ApproveCommandOptions): Promise<number> {
  const out = options.out ?? ((line: string) => console.log(line));
  const err = options.err ?? ((line: string) => console.error(line));
  const notify = options.notify ?? notifyApproval;
  const { home } = options;

  // 1. Ids first: nothing is looked up, read or printed with an unchecked id.
  let hostId: string;
  let phaseId: string;
  try {
    hostId = assertHostId(options.hostId);
    phaseId = assertPhaseId(options.phaseId);
  } catch (error) {
    if (error instanceof InvalidIdError) {
      err(error.message);
      return 2;
    }
    throw error;
  }

  // 2. The registered host, read-only.
  const found = findHost(home, hostId);
  if (!found.ok) {
    err(found.message);
    return 2;
  }
  const { host } = found;
  const adapter = adapterFor(host);
  if (adapter === null) {
    err(`Couldn't approve: Counterpoint does not recognise the planning framework of ${host.id}.`);
    return 1;
  }

  // 3. The trusted key.
  const trust = readTrust(home);
  if (!trust.ok) {
    err(
      trust.error === 'no-trusted-key'
        ? `No approval key is trusted yet. ${NO_TRUSTED_KEY_FIX}`
        : `The trusted approval key can't be used: ${printable(trust.detail)} Run "counterpoint trust-key" again.`,
    );
    return 1;
  }

  // 4. Integrity of the host's execution-capable git surface.
  let integrity: IntegrityState;
  try {
    integrity = await checkIntegrity(home, host);
  } catch (error) {
    err(
      `The integrity baseline for ${host.id} can't be used (${printable((error as Error).message)}). Run "counterpoint trust ${host.id}", review the list, then approve again.`,
    );
    return 1;
  }
  if (integrity.state === 'no-baseline') {
    err(
      `No integrity baseline for ${host.id} yet. Run "counterpoint trust ${host.id}", review the list, then approve again.`,
    );
    return 1;
  }
  if (integrity.state === 'changed') {
    err(INTEGRITY_REFUSAL(host.id));
    for (const change of integrity.changes) err(describeChange(change));
    return 1;
  }

  // 5. Re-derive the statement at the local base tip.
  const reader = createGitFileReader(host.root);
  const prepared = await prepareApproval({
    hostId,
    baseBranch: host.baseBranch,
    phaseId,
    reader,
    adapter,
  });
  if (!prepared.ok) {
    err(refusalMessage(prepared, host, phaseId));
    return 1;
  }

  // 6. The passphrase is typed at a terminal, never supplied by a program.
  if (!options.isTTY) {
    err('counterpoint approve needs a terminal: you type your passphrase there.');
    return 1;
  }

  // 7. Show exactly what is signed, then sign.
  const ident = await signerIdentity(host.root);
  for (const line of signingBlock(prepared, hostId, host.baseBranch, ident)) out(line);
  out('');
  out('ssh-keygen will now ask for your approval key passphrase.');

  const tmpDir = homePaths(home).tmpDir;
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const rawSign =
    options.sign ??
    ((payload: Uint8Array) => signPayload({ payload, privateKeyPath: trust.privateKeyPath }));
  const sign = async (payload: Uint8Array): Promise<string> => {
    let signature: string;
    try {
      signature = await rawSign(payload);
    } catch (error) {
      throw new SigningFailed((error as Error).message);
    }
    // Check the signature against the trusted key before anything lands.
    const check = await verifySignature({
      allowedSignersPath: trust.allowedSignersPath,
      principal: OWNER_PRINCIPAL,
      namespace: 'git',
      signature,
      payload,
      tmpDir,
    });
    if (!check.ok || check.fingerprint !== trust.fingerprint) throw new SignatureRejected();
    return signature;
  };

  let landed: Awaited<ReturnType<typeof signAndLand>>;
  try {
    landed = await signAndLand({
      root: host.root,
      baseBranch: host.baseBranch,
      itemPath: prepared.itemPath,
      fileBytes: prepared.bytes,
      message: `counterpoint: approve phase ${phaseId}\n\nStatement ${prepared.fingerprint}\nInputs ${prepared.statement.inputs.combined}\n`,
      ident,
      sign,
      expectedTip: prepared.tip,
    });
  } catch (error) {
    if (error instanceof SigningFailed) {
      err('Signing failed. Nothing was changed.');
      err(`  ${printable(error.message)}`);
      return 1;
    }
    if (error instanceof SignatureRejected) {
      err('The signature did not verify against your trusted key. Nothing was changed.');
      return 1;
    }
    throw error;
  }

  if (!landed.ok) {
    if (landed.reason === 'base-moved') {
      err(
        `${host.baseBranch} moved while you were signing. Run the command again to sign the current version.`,
      );
    } else if (landed.reason === 'occupied') {
      err(
        `A file already exists at ${prepared.itemPath} in your checkout. Move it, then approve again.`,
      );
    } else {
      err(
        `Couldn't place ${prepared.itemPath} in your checkout: ${printable(landed.detail ?? 'unsafe path')} Nothing was changed.`,
      );
    }
    return 1;
  }

  for (const miss of landed.unplaced) {
    err(
      `The approval landed on ${host.baseBranch}, but ${prepared.itemPath} could not be written into ${printable(miss.worktree)} (${printable(miss.error)}). Run "git restore --source=HEAD --staged --worktree ${prepared.itemPath}" there.`,
    );
  }

  // 8. Verify from git, exactly as every later reader will.
  const runwayOptions = {
    hostId,
    root: host.root,
    baseBranch: host.baseBranch,
    reader,
    adapter,
    trust,
    tmpDir,
  };
  const state = await approvalState({ ...runwayOptions, phaseId });
  if (state.state !== 'on-runway') {
    const reason =
      state.state === 'invalid'
        ? state.reason
        : state.state === 'changed'
          ? 'the inputs no longer match the signed statement'
          : 'no approval found';
    err(`Signed, but verification failed: ${reason}.`);
    return 1;
  }
  const runway = await computeRunway(runwayOptions);
  out(
    `Signed and verified. Runway is now ${runway.count}. Not pushed: push ${host.baseBranch} when you're ready.`,
  );
  await notify(home, { hostId, family: 'approval' });
  return 0;
}
