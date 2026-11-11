// The owner's accepted sandbox risk (doctor: Owner-recorded accepted risk; owner decision in
// docs/decisions.md: Keychain reachability accepted, with an explicit recorded doctor exception for
// the gh credentials row).
//
//   counterpoint accept-risk gh-keychain   records it, at a terminal, with a reason and `y`
//   counterpoint revoke-risk gh-keychain   withdraws it (no terminal needed: it only makes the
//                                          verdict stricter)
//
// This module is the only caller of the record's writer and revoker (a source-scan test in
// tests/cli/risk.test.ts keeps it that way). Recording is always the owner's act at a terminal:
// both stdin and stdout must be terminals, the owner types a one-line reason and answers `y`;
// anything else writes nothing. The record is per machine, in the Counterpoint home's trust
// folder, and covers only a gh row reached through the Keychain lookup alone.
import {
  ACCEPTED_RISK_IDS,
  type AcceptedRiskId,
  RiskReason,
  readAcceptedRisks,
  revokeAcceptedRisk,
  writeAcceptedRisk,
} from '../core/security/accepted-risks.ts';
import { printable, type TrustCommandOptions } from './trust.ts';

export interface AcceptRiskOptions extends TrustCommandOptions {
  now?: () => Date;
}

export interface RevokeRiskOptions {
  out?: (line: string) => void;
  err?: (line: string) => void;
}

const isRiskId = (risk: string): risk is AcceptedRiskId =>
  (ACCEPTED_RISK_IDS as readonly string[]).includes(risk);

const dayOf = (iso: string) => iso.slice(0, 10);

/**
 * Records the owner's acceptance of `gh-keychain`. Needs a terminal, a one-line reason and `y`.
 * Returns the exit code: 2 for any other risk id, 1 when nothing was saved, 0 when recorded.
 */
export async function acceptRiskCommand(
  home: string,
  risk: string,
  options: AcceptRiskOptions,
): Promise<number> {
  const out = options.out ?? console.log;
  const err = options.err ?? console.error;
  if (risk !== 'gh-keychain') {
    err('Only gh-keychain can be accepted. Nothing saved.');
    return 2;
  }
  if (!options.isTTY) {
    err('counterpoint accept-risk needs a terminal so you can confirm it. Nothing saved.');
    return 1;
  }

  out('Accept this risk: gh credentials (Keychain lookup only)');
  out(
    "A sandboxed agent's shell can read items in your macOS Keychain, so gh credentials kept there are reachable by agents.",
  );
  out('Doctor still fails if any other probe target, or any gh config file, is reachable.');
  const current = readAcceptedRisks(home);
  const existing = current.ok ? current.risks.find((entry) => entry.id === risk) : undefined;
  if (existing !== undefined) {
    out(`Currently recorded on ${dayOf(existing.recordedAt)}: ${printable(existing.reason)}`);
  }

  const answer = await options.confirm(
    'Why do you accept it? (one line, shown wherever the risk is shown): ',
  );
  const reason = RiskReason.safeParse(answer);
  if (!reason.success) {
    err('A one-line reason of up to 300 characters is needed. Nothing saved.');
    return 1;
  }
  const confirmed = await options.confirm('Record this accepted risk? [y/N] ');
  if (confirmed.trim().toLowerCase() !== 'y') {
    out('Nothing saved.');
    return 1;
  }

  const entry = writeAcceptedRisk(home, {
    reason: reason.data,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  out(
    `Accepted risk gh-keychain recorded on ${dayOf(entry.recordedAt)}. counterpoint doctor and the console show it on every check. Withdraw it with: counterpoint revoke-risk gh-keychain`,
  );
  return 0;
}

/**
 * Withdraws an accepted risk. Idempotent; needs no terminal. Returns the exit code: 2 for any
 * other risk id, 1 when the record cannot be read, 0 otherwise.
 */
export function revokeRiskCommand(
  home: string,
  risk: string,
  options: RevokeRiskOptions = {},
): number {
  const out = options.out ?? console.log;
  const err = options.err ?? console.error;
  if (!isRiskId(risk)) {
    err('Only gh-keychain can be revoked.');
    return 2;
  }
  let existed: boolean;
  try {
    existed = revokeAcceptedRisk(home, risk);
  } catch (error) {
    err(
      `Couldn't read your accepted-risk record (${printable((error as Error).message)}). Nothing changed.`,
    );
    return 1;
  }
  out(
    existed
      ? 'Accepted risk gh-keychain withdrawn. From now on doctor fails while gh credentials are reachable.'
      : 'No accepted risk gh-keychain is recorded.',
  );
  return 0;
}
