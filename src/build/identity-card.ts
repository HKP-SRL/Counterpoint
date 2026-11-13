// The owner's git identity is missing (owner-identity: Commits carry the owner's identity). A commit
// then falls back to Counterpoint's own (`counterpoint@localhost`), which hosts like Vercel match to
// no account, so previews fail with no explanation. Needs You says so with one card, raised once:
// set the identity GitHub knows for the owner (their name, and their public or no-reply email), or
// set it by hand.
import { execa } from 'execa';
import { getCardByKey, type NewCard } from '../core/store/cards.ts';
import type { CardDesk } from '../server/cards.ts';

export const IDENTITY_CARD_KEY = 'setup:git-identity';

export interface Identity {
  name: string;
  email: string;
}

/** The identity GitHub knows for the owner (`gh api user`), or null when `gh` can't tell. */
export async function githubIdentity(
  env: Readonly<Record<string, string>>,
): Promise<Identity | null> {
  try {
    const result = await execa('gh', ['api', 'user'], {
      env,
      extendEnv: false,
      reject: false,
      stdin: 'ignore',
      timeout: 15_000,
    });
    if (result.exitCode !== 0) return null;
    const user = JSON.parse(String(result.stdout)) as Record<string, unknown>;
    const login = typeof user.login === 'string' ? user.login : null;
    const id = typeof user.id === 'number' ? user.id : null;
    if (login === null || id === null || !/^[A-Za-z0-9-]{1,39}$/.test(login)) return null;
    const name =
      typeof user.name === 'string' && user.name.trim() !== '' ? user.name.trim() : login;
    const email =
      typeof user.email === 'string' && /^\S+@\S+$/.test(user.email)
        ? user.email
        : `${id}+${login}@users.noreply.github.com`;
    return { name: name.slice(0, 200), email: email.slice(0, 200) };
  } catch {
    return null;
  }
}

/** The card: use the identity GitHub knows (when there is one), or set it by hand. */
export function identityCard(suggested: Identity | null): NewCard {
  const byHand = {
    label: "I'll set it myself",
    consequence:
      "Run git config --global user.name and user.email; commits stay Counterpoint's until then.",
  };
  return {
    hostId: null,
    key: IDENTITY_CARD_KEY,
    kind: 'setup',
    source: 'machine',
    question: 'Your git name and email are not set. Commit as you?',
    why: 'Commits fall back to counterpoint@localhost, which previews like Vercel refuse.',
    options:
      suggested === null
        ? [
            byHand,
            {
              label: "Keep Counterpoint's",
              consequence: 'Commits stay counterpoint@localhost; previews may fail.',
            },
          ]
        : [
            {
              label:
                `Use ${suggested.name} <${suggested.email}>`.length <= 120
                  ? `Use ${suggested.name} <${suggested.email}>`
                  : 'Use your GitHub name and email',
              consequence: 'Counterpoint sets it in your global git config; next commits use it.',
              action: { type: 'set-git-identity', name: suggested.name, email: suggested.email },
            },
            byHand,
          ],
    recommended: 0,
    reversible: true,
    blocking: false,
  };
}

/**
 * Raises the identity card once, whatever the owner answers later. Calls while one is being made
 * share it.
 */
export function identityFallbackNotice(
  desk: CardDesk,
  ownerEnv: () => Promise<Readonly<Record<string, string>>>,
): () => void {
  let raising = false;
  return () => {
    if (raising || getCardByKey(desk.store, IDENTITY_CARD_KEY) !== undefined) return;
    raising = true;
    void ownerEnv()
      .then(githubIdentity)
      .catch(() => null)
      .then((suggested) => {
        try {
          desk.raise(identityCard(suggested));
        } catch {
          // a card the model refuses changes nothing about the commit
        }
      })
      .finally(() => {
        raising = false;
      });
  };
}
