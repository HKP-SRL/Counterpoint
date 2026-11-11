// One live `counterpoint doctor` run on the owner's real `claude` with the owner's accepted risk
// recorded (doctor: Owner-recorded accepted risk; owner decision in docs/decisions.md: Keychain
// reachability accepted, with an explicit recorded doctor exception for the gh credentials row).
//
// Gated by COUNTERPOINT_LIVE_PROBE=1: it needs a signed-in `claude` and spends a few cents of
// haiku. Everything is scratch, under CP_TEST_SCRATCH: the Counterpoint home, a user home with
// .ssh and .config/gh, a passphrase-protected throwaway key trusted with writeTrust, a committed
// scratch repo registered as host `demo` with its integrity baseline, and the risk recorded through
// the library (writeAcceptedRisk) in the scratch home. The settings sources are scratch too, so no
// real user or managed settings file is read. Tools and key checks are faked (not under test
// here); the probe is the real default one, two headless claude sessions through the production
// launch profile. The owner's real keys, settings and Counterpoint home are never touched, and
// accept-risk is never run. The probe's own temporary Keychain canary is the only Keychain item it
// creates, and it removes it itself.
//
// Evidence first: summary.json, doctor-output.txt and doctor.json are written to
// .tmp/live-doctor/ (gitignored) and copied to $CP_TEST_SCRATCH/evidence-doctor-live/ before any
// assertion. The protected-target facts (the stop rule) are hard assertions;
// the facts that step records as findings (the two session checks, the exit code, the accepted-risk
// line) are soft, so the evidence and every finding are reported either way.

import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { doctorCommand } from '../../src/cli/doctor.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { readPublicKey, writeTrust } from '../../src/core/approvals/trust-store.ts';
import {
  readAcceptedRisks,
  revokeAcceptedRisk,
  writeAcceptedRisk,
} from '../../src/core/security/accepted-risks.ts';
import {
  appliedAcceptedRisks,
  type Check,
  DoctorReport,
  reachedOnlyByKeychain,
  reportVerdict,
} from '../../src/core/security/doctor-report.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { makeThrowawayKey } from '../helpers/keys.ts';
import {
  commitAll,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEBUG_DIR = join(REPO_ROOT, '.tmp', 'live-doctor');
const SCRATCH_ROOT = process.env.CP_TEST_SCRATCH ?? join(REPO_ROOT, '.tmp');
const EVIDENCE_DIR = join(SCRATCH_ROOT, 'evidence-doctor-live');
const REASON = 'Live check: owner-accepted Keychain residual (the gh-keychain accepted risk)';

const pass = (id: string, label: string, detail = 'ok'): Check => ({
  id,
  label,
  result: 'pass',
  detail,
});

const passingTools = async (): Promise<Check[]> => [
  pass('claude', 'claude', 'faked: not under test here'),
  pass('git', 'git', 'faked: not under test here'),
  pass('gh', 'gh', 'faked: not under test here'),
];

const passingKeys = async (): Promise<Check[]> => [
  pass('key-passphrase', 'Passphrase-protected', 'faked: not under test here'),
  pass('key-agent', 'Not loaded in ssh-agent', 'faked: not under test here'),
  pass('key-keychain', 'Not loadable via Keychain', 'faked: not under test here'),
  pass('openssh', 'OpenSSH 8.1 or newer', 'faked: not under test here'),
  pass('trusted-key', 'Trusted key', 'faked: not under test here'),
];

afterAll(() => removeScratchDirs());

describe.skipIf(process.env.COUNTERPOINT_LIVE_PROBE !== '1')(
  'live doctor with the accepted risk',
  () => {
    it('passes with the gh-keychain risk applied only to a Keychain-only gh reach, and fails once it is revoked', async () => {
      // Scratch layout.
      const home = makeScratchDir('lhome');
      const userHome = makeScratchDir('luser');
      mkdirSync(join(userHome, '.ssh'), { recursive: true, mode: 0o700 });
      mkdirSync(join(userHome, '.config', 'gh'), { recursive: true, mode: 0o700 });
      const managedDir = makeScratchDir('lmanaged');
      const managedPreferencesDir = makeScratchDir('lprefs');
      const key = await makeThrowawayKey(makeScratchDir('lkeys'), {
        name: 'approval',
        passphrase: randomBytes(12).toString('hex'),
      });
      await writeTrust(home, {
        publicKeyPath: key.publicKeyPath,
        confirmed: readPublicKey(key.publicKeyPath),
      });
      const root = makeScratchDir('lrepo');
      await initScratchRepo(root);
      writeFileIn(root, 'README.md', 'live doctor\n');
      await commitAll(root);
      const gitDir = join(root, '.git');
      const store = openStore(home);
      try {
        upsertHost(store, {
          id: 'demo',
          root,
          gitCommonDir: gitDir,
          baseBranch: 'main',
          adapter: 'none',
        });
      } finally {
        store.close();
      }
      writeBaseline(home, 'demo', await snapshotIntegrity(gitDir));
      const entry = writeAcceptedRisk(home, { reason: REASON });

      // The one live run: the default probe on the owner's claude.
      const out: string[] = [];
      const err: string[] = [];
      const code = await doctorCommand(home, 'demo', {
        cwd: root,
        homeDir: userHome,
        env: {},
        tools: passingTools,
        keyChecks: passingKeys,
        notify: async () => {},
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        settingsLocations: {
          userConfigDir: join(userHome, '.claude'),
          managedDir,
          managedPreferencesDir,
          userName: 'cp-test',
        },
      });

      const reportPath = join(home, 'hosts', 'demo', 'doctor.json');
      const reportText = readFileSync(reportPath, 'utf8');
      const report = DoctorReport.parse(JSON.parse(reportText));
      const recorded = readAcceptedRisks(home);
      const recordedRisks = recorded.ok ? recorded.risks : [];
      const verdict = reportVerdict(report, recordedRisks);
      const applied = appliedAcceptedRisks(report, recordedRisks);
      const gh = report.probe.find((row) => row.id === 'gh');
      const ghKeychainOnly = gh !== undefined && reachedOnlyByKeychain(gh);
      const acceptedLine = out.some((line) => line.includes('Accepted risk gh-keychain, recorded'));

      // Revoke, then judge the same stored report again.
      const revoked = revokeAcceptedRisk(home, 'gh-keychain');
      const afterRevoke = readAcceptedRisks(home);
      const revokedRisks = afterRevoke.ok ? afterRevoke.risks : [];
      const revokedVerdict = reportVerdict(report, revokedRisks);

      // Evidence first (classes, names and results only; no canary or credential value).
      const summary = {
        exitCode: code,
        verdict,
        revokedVerdict,
        revoked,
        revokedRecordEmpty: afterRevoke.ok && revokedRisks.length === 0,
        claudeVersion: report.claudeVersion,
        matcherVersion: report.matcherVersion,
        recordedOk: recorded.ok,
        reportAcceptedRisks: report.acceptedRisks.map(({ id, target, subStep, recordedAt }) => ({
          id,
          target,
          subStep,
          recordedAt,
        })),
        entryRecordedAt: entry.recordedAt,
        applied: applied.map((risk) => risk.id),
        acceptedLine,
        ghKeychainOnly,
        agentMode: report.agentMode
          ? {
              result: report.agentMode.result,
              expected: report.agentMode.expected,
              effective: report.agentMode.effective,
              detail: report.agentMode.detail,
            }
          : null,
        sandboxIsolation: report.sandboxIsolation
          ? {
              result: report.sandboxIsolation.result,
              detail: report.sandboxIsolation.detail,
              sources: report.sandboxIsolation.sources.map(({ kind, label, state, findings }) => ({
                kind,
                label,
                state,
                findings,
              })),
            }
          : null,
        gh:
          gh === undefined
            ? null
            : {
                result: gh.result,
                evidence: gh.evidence,
                steps: gh.steps,
                leaks: gh.leaks,
                trusted: gh.trusted,
              },
        rows: report.probe.map((row) => ({
          id: row.id,
          result: row.result,
          trusted: row.trusted,
          leaks: row.leaks,
          steps: row.steps,
          exceptions: (row.exceptions ?? []).map((exception) => exception.id),
        })),
        stderrLines: err.length,
      };
      mkdirSync(DEBUG_DIR, { recursive: true });
      writeFileSync(join(DEBUG_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
      writeFileSync(join(DEBUG_DIR, 'doctor-output.txt'), `${[...out, ...err].join('\n')}\n`);
      writeFileSync(join(DEBUG_DIR, 'doctor.json'), reportText);
      mkdirSync(EVIDENCE_DIR, { recursive: true });
      cpSync(DEBUG_DIR, EVIDENCE_DIR, { recursive: true });

      // Hard: the protected-target facts (the stop rule).
      for (const row of report.probe) {
        if (row.id === 'gh') continue;
        expect(row.result, `${row.id} must be Blocked`).toBe('blocked');
      }
      expect(gh, 'the report carries a gh row').toBeDefined();
      expect(
        gh?.result === 'blocked' || ghKeychainOnly,
        'gh Blocked or reached only by Keychain',
      ).toBe(true);
      // A Blocked protected row never rests on a mode decision.
      for (const row of report.probe) {
        if (row.result !== 'blocked') continue;
        const byMode = row.steps.filter((step) => step.treatment === 'denied-mode');
        expect(byMode, `${row.id} Blocked by a denied-mode step`).toEqual([]);
      }
      // Doctor never passes when it should not.
      const checksPass =
        report.tools.every((check) => check.result === 'pass') &&
        report.signingKey.every((check) => check.result === 'pass') &&
        report.integrity.result === 'pass' &&
        report.agentMode?.result === 'pass' &&
        report.sandboxIsolation?.result === 'pass';
      if (verdict !== 'fail' || code === 0)
        expect(checksPass, 'a passing verdict needs every check').toBe(true);
      if (applied.length > 0)
        expect(ghKeychainOnly, 'the risk applies only to a Keychain-only gh').toBe(true);
      if (gh?.result === 'reachable')
        expect(revokedVerdict, 'revoked with gh reachable').toBe('fail');
      else expect(revokedVerdict, 'revoked with gh Blocked').toBe(verdict);

      // Soft: facts the plan records as findings.
      expect.soft(code, 'doctor exit code').toBe(0);
      expect.soft(report.agentMode?.result, 'Agent permission mode').toBe('pass');
      expect.soft(report.agentMode?.effective, 'effective mode').toBe('auto');
      expect.soft(report.sandboxIsolation?.result, 'Sandbox isolation settings').toBe('pass');
      const sources = report.sandboxIsolation?.sources ?? [];
      expect.soft(sources.find((source) => source.kind === 'launch')?.state).toBe('read');
      for (const kind of ['user', 'server-managed-cache', 'managed-file'] as const) {
        expect.soft(sources.find((source) => source.kind === kind)?.state, kind).toBe('absent');
      }
      for (const source of sources) {
        if (source.kind !== 'launch') expect.soft(source.state, source.label).toBe('absent');
      }
      expect.soft(report.acceptedRisks.map((risk) => risk.id)).toEqual(['gh-keychain']);
      expect.soft(report.acceptedRisks[0]?.recordedAt).toBe(entry.recordedAt);
      expect.soft(verdict).toBe(gh?.result === 'reachable' ? 'accepted-risk' : 'pass');
      expect
        .soft(acceptedLine, 'the Accepted risk line exactly when the risk applied')
        .toBe(applied.length > 0);
      expect.soft(revoked).toBe(true);
      expect
        .soft(afterRevoke.ok && revokedRisks.length === 0, 'record empty after revoke')
        .toBe(true);
    }, 900_000);
  },
);
