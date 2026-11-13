// Design drafts (design-drafts): the daemon's side of the Drafts page.
//
// - Start drafts: one short session over the change's planning writes `screens.json` (D-2); the
//   owner adds, renames or drops screens before the first round.
// - Low-fi rounds: three sessions at once (A, B, C), each with its own direction, in its own scratch
//   folder in the Counterpoint home, never touching the host's code. Each draft is packed (D-4),
//   mapped (D-6) and shown as soon as its own session ends.
// - Marks: the owner selects or comments on parts of the round's drafts; Next round sends them as
//   excerpts and notes to all three sessions.
// - Lock starts the hi-fi draft (D-3) in a detached worktree at the base tip: one session writes an
//   entry per state with the host's components, the host's render command renders each like a gate,
//   and Counterpoint packs and maps the result. A render failure goes back to a session up to twice.
// - Comments on hi-fi collect until Send; a revision changes only those parts, comments are matched
//   by id then text (Addressed or Detached), and parts nobody commented on that changed anyway go
//   back once, then show as "also changed" (D-7).
// - Sign off lands the packed pages, `styles.css` and the entries' source through one planning
//   write (D-9); earlier rounds stay here.
// - A change with drafts is held from building until every screen is signed off and landed (D-12).
//
// Every session goes through the governor (the runner the daemon passes). Work runs in the
// background: actions return at once and a `drafts` event tells open consoles to refetch.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { buildClaudeArgv } from '../agent/claude-argv.ts';
import type { AgentRunner } from '../agent/runner.ts';
import { lastLines, runGate } from '../build/gate-runner.ts';
import { readHostSettings } from '../build/host-settings.ts';
import type { PlanningLane } from '../build/planning-lane.ts';
import { cloneIntoWorktree } from '../build/worktree-clone.ts';
import { type ChangeFacts, findChange } from '../core/framework/port.ts';
import { catBlob } from '../core/git/plumbing.ts';
import { runGit } from '../core/git/run.ts';
import { readDesignRules } from '../core/host/design-rules.ts';
import {
  type DraftsConfig,
  ENTRY_PLACEHOLDER,
  type HostConfig,
  OUT_PLACEHOLDER,
  readHostConfig,
} from '../core/host/host-config.ts';
import type { NewCard } from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import {
  addScreen,
  type DraftMaps,
  type DraftMarkRow,
  type DraftRoundRow,
  type DraftRow,
  type DraftScreenRow,
  type DraftWidth,
  deleteMark,
  deleteScreen,
  draftScreen,
  dropDraftChange,
  failInFlightDrafts,
  getDraft,
  getDraftChange,
  getMark,
  getRound,
  getScreen,
  insertDraft,
  insertMark,
  insertRound,
  latestRound,
  listDraftChanges,
  listDrafts,
  listMarks,
  listRounds,
  listScreens,
  type MarkKind,
  replaceScreens,
  type ScreenInput,
  setDraftChangeState,
  setMarkState,
  startDraftChange,
  updateDraft,
  updateRound,
  updateScreen,
} from '../core/store/drafts.ts';
import { getPlanningWrite } from '../core/store/planning-writes.ts';
import { NoBrowserError } from './browser.ts';
import {
  PACKED_PAGE,
  PACKED_PARTS,
  PACKED_STYLES,
  PackError,
  type PackResult,
  packPage,
  STYLES_LINK,
} from './pack.ts';
import {
  type Comment,
  DRAFT_LETTERS,
  type HiFiComment,
  hiFiPrompt,
  lowFiPrompt,
  parseScreensFile,
  renderFailedPrompt,
  restorePrompt,
  revisionPrompt,
  SCREENS_FILE,
  type Selection,
  screenListPrompt,
} from './prompts.ts';
import { draftsRoot } from './server.ts';
import { WIRE_CSS, WIRE_FILE } from './wire.ts';

export const NO_BROWSER_KIND = 'drafts-browser';

const LOW_FI_TIMEOUT_MS = 5 * 60 * 1000;
const HI_FI_TIMEOUT_MS = 30 * 60 * 1000;
const RENDER_RETRIES = 2;
const MAX_PLANNING_CHARS = 60_000;
const MAX_GUIDE_BYTES = 32 * 1024;
const MAX_SIGNOFF_FILE = 1024 * 1024;
/** Where a hi-fi session writes its entries in the worktree. */
const ENTRY_DIR = '.cp-draft';

/** A refused action, said to the owner as it is. */
export class DraftsRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftsRefused';
  }
}

/** What the service needs of a registered host (the daemon's HostRuntime fits). */
export interface DraftsHost {
  host: { id: string; root: string; baseBranch: string };
  reader: import('../core/framework/port.ts').GitFileReader;
  adapter: import('../core/framework/port.ts').FrameworkAdapter | null;
  tip(): Promise<string | null>;
}

/** Element maps and screenshots (browser.ts). */
export interface DraftMapper {
  maps(pagePath: string): Promise<DraftMaps>;
}

export interface DraftsOptions {
  db: Store;
  home: string;
  host: (hostId: string) => DraftsHost | null;
  /** A governed runner for the claude on the owner's PATH. */
  runner: (hostId: string, env: Readonly<Record<string, string>>) => AgentRunner;
  ownerEnv: () => Promise<Readonly<Record<string, string>>>;
  mapper: DraftMapper;
  /** Tells open consoles a change's drafts moved. */
  publish: (hostId: string, payload: Record<string, unknown>) => void;
  /** Raises a Needs You card (no browser to map drafts with). */
  raise?: (card: NewCard) => void;
  /** Sign-off's planning write. */
  lane?: Pick<PlanningLane, 'submit'>;
  log?: (event: string, fields: Record<string, unknown>) => void;
  now?: () => number;
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** A screen id from a name: lowercase, dashes, unique among `taken`. */
export function screenSlug(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'screen';
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

function readParts(dir: string): PackResult | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'packed', PACKED_PARTS), 'utf8')) as PackResult;
  } catch {
    return null;
  }
}

/** The session's last words, on one line. */
function lastWords(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const text = (result as { result?: unknown }).result;
  return typeof text === 'string' && text.trim() !== '' ? clip(text, 240) : null;
}

/** Why a change is held, by screen name; empty when it is not held. */
export interface HoldState {
  held: boolean;
  /** The screens that still wait, by name (or "the screen list" while it is made). */
  waiting: string[];
}

export class Drafts {
  readonly #o: DraftsOptions;
  readonly #working = new Set<Promise<void>>();
  readonly #now: () => number;

  constructor(options: DraftsOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
  }

  get store(): Store {
    return this.#o.db;
  }

  /** True while a draft session or render is going on. */
  busy(): boolean {
    return this.#working.size > 0;
  }

  /** Resolves once no draft work is going on. */
  async idle(): Promise<void> {
    while (this.#working.size > 0) await Promise.allSettled([...this.#working]);
  }

  /** At daemon start (D-8): what was in flight shows Failed with Try again. */
  recover(): number {
    return failInFlightDrafts(this.#o.db, this.#now());
  }

  #publish(hostId: string, change: string, what: string): void {
    this.#o.publish(hostId, { change, what });
  }

  #background(name: string, fields: Record<string, unknown>, work: () => Promise<void>): void {
    const run = work().catch((error: Error) => {
      this.#o.log?.(`drafts-${name}-failed`, { ...fields, message: error.message });
    });
    this.#working.add(run);
    void run.finally(() => this.#working.delete(run));
  }

  #runtime(hostId: string): DraftsHost {
    const runtime = this.#o.host(hostId);
    if (runtime === null) throw new DraftsRefused('This project is no longer registered.');
    return runtime;
  }

  #folder(hostId: string, change: string, ...rest: string[]): string {
    return join(draftsRoot(this.#o.home, hostId), change, ...rest);
  }

  #screen(id: number): DraftScreenRow {
    const screen = getScreen(this.#o.db, id);
    if (screen === undefined) throw new DraftsRefused('That screen is gone.');
    return screen;
  }

  /** The change at the base tip, its planning text and the design rules. */
  async #context(hostId: string, change: string) {
    const runtime = this.#runtime(hostId);
    const tip = await runtime.tip();
    if (tip === null || runtime.adapter === null) {
      throw new DraftsRefused(`${runtime.host.baseBranch} cannot be read.`);
    }
    const snapshot = await runtime.adapter.snapshot(runtime.reader, tip);
    const facts = findChange(snapshot.changes, change);
    if (facts === undefined || facts.archived) {
      throw new DraftsRefused(`${change} is not an open change at the base tip.`);
    }
    const inputs = await runtime.adapter
      .approvalInputs(runtime.reader, tip, change)
      .catch(() => []);
    let planning = '';
    for (const input of inputs) {
      if (input.kind === 'metadata' || input.kind === 'tasks') continue;
      planning += `## ${input.sourcePath}\n\n${new TextDecoder().decode(input.bytes)}\n\n`;
    }
    if (planning.length > MAX_PLANNING_CHARS) {
      planning = `${planning.slice(0, MAX_PLANNING_CHARS)}\n[... the rest is left out ...]`;
    }
    const rules = await readDesignRules(runtime.reader, tip);
    return { runtime, tip, facts, planning: planning.trim() || facts.title, rules };
  }

  #settings(hostId: string) {
    return readHostSettings(this.#o.db, hostId).settings;
  }

  // --- the screen list ---

  /** Start drafts (D-2): the change is held from now on and its screen list is made. */
  async start(hostId: string, change: string): Promise<void> {
    await this.#context(hostId, change);
    const existing = getDraftChange(this.#o.db, hostId, change);
    if (existing?.state === 'listing') return;
    if (existing !== undefined && listScreens(this.#o.db, hostId, change).length > 0) {
      throw new DraftsRefused('Drafts are already started for this change.');
    }
    startDraftChange(this.#o.db, hostId, change, this.#now());
    this.#publish(hostId, change, 'list');
    this.#background('list', { hostId, change }, () => this.#makeList(hostId, change));
  }

  async #makeList(hostId: string, change: string): Promise<void> {
    try {
      const ctx = await this.#context(hostId, change);
      const dir = this.#folder(hostId, change, 'list');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const env = await this.#o.ownerEnv();
      const settings = this.#settings(hostId);
      await this.#o.runner(hostId, env).run({
        argv: buildClaudeArgv({
          model: settings.draftModel,
          effort: 'low',
          maxTurns: 6,
          maxBudgetUsd: 2,
          prompt: screenListPrompt({ change, planning: ctx.planning }),
        }),
        cwd: dir,
        env,
        timeoutMs: LOW_FI_TIMEOUT_MS,
        rawLogPath: join(dir, 'session.jsonl'),
      });
      const file = join(dir, SCREENS_FILE);
      if (!existsSync(file)) throw new DraftsRefused(`The session wrote no ${SCREENS_FILE}.`);
      const parsed = parseScreensFile(readFileSync(file, 'utf8'));
      if (!parsed.ok) throw new DraftsRefused(parsed.error);
      replaceScreens(
        this.#o.db,
        hostId,
        change,
        parsed.file.screens.map((s) => ({
          screen: s.id,
          name: s.name,
          purpose: s.purpose,
          states: s.states,
          directions: s.directions,
        })),
        this.#now(),
      );
      setDraftChangeState(this.#o.db, hostId, change, 'ready', null, this.#now());
    } catch (error) {
      setDraftChangeState(
        this.#o.db,
        hostId,
        change,
        'failed',
        clip((error as Error).message, 300),
        this.#now(),
      );
    }
    this.#publish(hostId, change, 'list');
  }

  /** Try again on a failed screen list. */
  retryList(hostId: string, change: string): void {
    const row = getDraftChange(this.#o.db, hostId, change);
    if (row === undefined) throw new DraftsRefused('Drafts are not started for this change.');
    if (row.state !== 'failed') return;
    startDraftChange(this.#o.db, hostId, change, this.#now());
    this.#publish(hostId, change, 'list');
    this.#background('list', { hostId, change }, () => this.#makeList(hostId, change));
  }

  addScreen(
    hostId: string,
    change: string,
    input: { name: string; purpose?: string; states?: string[] },
  ): DraftScreenRow {
    if (getDraftChange(this.#o.db, hostId, change) === undefined) {
      throw new DraftsRefused('Drafts are not started for this change.');
    }
    const taken = new Set(listScreens(this.#o.db, hostId, change).map((s) => s.screen));
    const screen: ScreenInput = {
      screen: screenSlug(input.name, taken),
      name: input.name.trim(),
      purpose: input.purpose?.trim() || input.name.trim(),
      states: input.states !== undefined && input.states[0] === 'main' ? input.states : ['main'],
      directions: [
        'A simple list or form, the most important thing first.',
        'Cards or sections, grouped by what belongs together.',
        'A dense layout that fits everything on one screen.',
      ],
    };
    const row = addScreen(this.#o.db, hostId, change, screen, this.#now());
    this.#publish(hostId, change, 'screen');
    return row;
  }

  renameScreen(screenId: number, name: string): DraftScreenRow {
    const screen = this.#screen(screenId);
    const row = updateScreen(this.#o.db, screenId, { name: name.trim() }, this.#now());
    this.#publish(screen.hostId, screen.change, 'screen');
    return row;
  }

  async dropScreen(screenId: number): Promise<void> {
    const screen = this.#screen(screenId);
    await this.#removeWorktree(screen);
    deleteScreen(this.#o.db, screenId);
    rmSync(this.#folder(screen.hostId, screen.change, `s${screen.id}`), {
      recursive: true,
      force: true,
    });
    this.#publish(screen.hostId, screen.change, 'screen');
  }

  // --- low-fi rounds ---

  /**
   * A low-fi round (D-2): the first, or Next round with the open marks. `startFrom` is the locked
   * draft after an Unlock.
   */
  startRound(screenId: number, startFrom: DraftRow | null = null): DraftRoundRow {
    const screen = this.#screen(screenId);
    if (screen.stage !== 'low') throw new DraftsRefused('This screen is not in low-fi.');
    const latest = latestRound(this.#o.db, screenId);
    if (latest?.state === 'running') throw new DraftsRefused('A round is still being made.');
    const marks = listMarks(this.#o.db, screenId, ['open']);
    const { selections, comments } = this.#lowFiMarks(marks);
    const round = insertRound(this.#o.db, screenId, 'low', this.#now());
    for (const mark of marks) setMarkState(this.#o.db, mark.id, 'sent', round.number, this.#now());
    const directions = screen.directions.length === 3 ? screen.directions : [];
    const drafts = DRAFT_LETTERS.map((letter, index) =>
      insertDraft(
        this.#o.db,
        {
          roundId: round.id,
          slot: letter,
          direction: directions[index] ?? `Direction ${letter}`,
          dir: this.#folder(
            screen.hostId,
            screen.change,
            `s${screen.id}`,
            `r${round.number}`,
            letter,
          ),
        },
        this.#now(),
      ),
    );
    const base = startFrom === null ? null : this.#readPage(startFrom.dir, 'packed', PACKED_PAGE);
    this.#publish(screen.hostId, screen.change, 'round');
    for (const draft of drafts) {
      this.#background('low-fi', { screenId, draftId: draft.id }, () =>
        this.#makeLowFi(screen, round, draft, { selections, comments, startFrom: base }),
      );
    }
    return round;
  }

  #readPage(dir: string, ...path: string[]): string | null {
    try {
      return readFileSync(join(dir, ...path), 'utf8');
    } catch {
      return null;
    }
  }

  /** Marks as the next round's sessions get them: selections as excerpts, comments as notes. */
  #lowFiMarks(marks: readonly DraftMarkRow[]): { selections: Selection[]; comments: Comment[] } {
    const selections: Selection[] = [];
    const comments: Comment[] = [];
    for (const mark of marks) {
      const draft = getDraft(this.#o.db, mark.draftId);
      if (draft === undefined) continue;
      if (mark.kind === 'select') {
        const excerpt = readParts(draft.dir)?.parts[mark.part]?.excerpt ?? mark.snippet;
        selections.push({ letter: draft.slot, part: mark.part, excerpt });
      } else {
        comments.push({
          letter: draft.slot,
          part: mark.part,
          snippet: mark.snippet,
          note: mark.note ?? '',
        });
      }
    }
    return { selections, comments };
  }

  async #makeLowFi(
    screen: DraftScreenRow,
    round: DraftRoundRow,
    draft: DraftRow,
    marks: { selections: Selection[]; comments: Comment[]; startFrom: string | null },
  ): Promise<void> {
    try {
      const ctx = await this.#context(screen.hostId, screen.change);
      rmSync(draft.dir, { recursive: true, force: true });
      mkdirSync(draft.dir, { recursive: true });
      writeFileSync(join(draft.dir, WIRE_FILE), WIRE_CSS);
      const env = await this.#o.ownerEnv();
      const settings = this.#settings(screen.hostId);
      await this.#o.runner(screen.hostId, env).run({
        argv: buildClaudeArgv({
          model: settings.draftModel,
          effort: 'low',
          maxTurns: 8,
          maxBudgetUsd: 2,
          prompt: lowFiPrompt({
            change: screen.change,
            screen,
            letter: draft.slot,
            direction: draft.direction ?? '',
            planning: ctx.planning,
            rules: ctx.rules,
            ...marks,
          }),
        }),
        cwd: draft.dir,
        env,
        timeoutMs: LOW_FI_TIMEOUT_MS,
        rawLogPath: join(draft.dir, 'session.jsonl'),
      });
      packPage({ root: draft.dir, outDir: join(draft.dir, 'packed') });
      const maps = await this.#maps(screen.hostId, join(draft.dir, 'packed', PACKED_PAGE));
      updateDraft(this.#o.db, draft.id, { state: 'ready', error: null, maps }, this.#now());
    } catch (error) {
      updateDraft(
        this.#o.db,
        draft.id,
        { state: 'failed', error: clip((error as Error).message, 300) },
        this.#now(),
      );
    }
    this.#settleRound(round.id);
    this.#publish(screen.hostId, screen.change, 'draft');
  }

  /** A round is done when none of its drafts is still being made; failed when none is ready. */
  #settleRound(roundId: number): void {
    const drafts = listDrafts(this.#o.db, roundId);
    if (drafts.some((d) => d.state === 'running')) return;
    const ready = drafts.some((d) => d.state === 'ready');
    updateRound(
      this.#o.db,
      roundId,
      ready
        ? { state: 'ready', error: null }
        : { state: 'failed', error: drafts.find((d) => d.error !== null)?.error ?? 'Failed.' },
      this.#now(),
    );
  }

  /** The page's maps; with no browser, null and a Needs You card (D-6). */
  async #maps(hostId: string, page: string): Promise<DraftMaps | null> {
    try {
      return await this.#o.mapper.maps(page);
    } catch (error) {
      if (!(error instanceof NoBrowserError)) throw error;
      this.#o.raise?.(noBrowserCard(hostId));
      return null;
    }
  }

  /** Try again on a failed low-fi draft. */
  retryDraft(draftId: number): void {
    const draft = getDraft(this.#o.db, draftId);
    const screen = draft === undefined ? undefined : draftScreen(this.#o.db, draftId);
    const round = draft === undefined ? undefined : getRound(this.#o.db, draft.roundId);
    if (draft === undefined || screen === undefined || round === undefined) {
      throw new DraftsRefused('That draft is gone.');
    }
    if (round.stage !== 'low') {
      this.retryHiFi(screen.id);
      return;
    }
    if (draft.state !== 'failed') return;
    if (latestRound(this.#o.db, screen.id)?.id !== round.id || screen.stage !== 'low') {
      throw new DraftsRefused('Only a draft of the current round can be made again.');
    }
    updateDraft(this.#o.db, draftId, { state: 'running', error: null }, this.#now());
    updateRound(this.#o.db, round.id, { state: 'running', error: null }, this.#now());
    const sent = listMarks(this.#o.db, screen.id).filter((m) => m.sentRound === round.number);
    const locked =
      screen.lockedDraft === null ? undefined : getDraft(this.#o.db, screen.lockedDraft);
    this.#publish(screen.hostId, screen.change, 'draft');
    this.#background('low-fi', { draftId }, () =>
      this.#makeLowFi(screen, round, draft, {
        ...this.#lowFiMarks(sent),
        startFrom:
          round.number > 1 && locked !== undefined
            ? this.#readPage(locked.dir, 'packed', PACKED_PAGE)
            : null,
      }),
    );
  }

  // --- marks ---

  /** Select or comment on a part of a draft of the screen's current round (or hi-fi version). */
  mark(
    draftId: number,
    input: { part: string; kind: MarkKind; note: string | null; width: DraftWidth },
  ): DraftMarkRow {
    const draft = getDraft(this.#o.db, draftId);
    const screen = draft === undefined ? undefined : draftScreen(this.#o.db, draftId);
    if (draft === undefined || screen === undefined) throw new DraftsRefused('That draft is gone.');
    if (latestRound(this.#o.db, screen.id)?.id !== draft.roundId) {
      throw new DraftsRefused('Marks go on the current round.');
    }
    const round = getRound(this.#o.db, draft.roundId);
    if (round?.stage === 'hifi' && input.kind === 'select') {
      throw new DraftsRefused('On a hi-fi draft, comment on a part.');
    }
    if (screen.stage === 'signed') throw new DraftsRefused('This screen is signed off.');
    const note = input.note?.trim() ?? '';
    if (input.kind === 'comment' && note === '') throw new DraftsRefused('A comment needs words.');
    const part =
      readParts(draft.dir)?.parts[input.part] ??
      draft.maps?.[input.width]?.parts.find((p) => p.id === input.part);
    if (part === undefined) throw new DraftsRefused('That part is not on the draft.');
    const row = insertMark(
      this.#o.db,
      {
        screenId: screen.id,
        draftId,
        part: input.part,
        snippet: clip(part.text, 160),
        kind: input.kind,
        note: input.kind === 'comment' ? note.slice(0, 2000) : null,
        width: input.width,
      },
      this.#now(),
    );
    this.#publish(screen.hostId, screen.change, 'mark');
    return row;
  }

  unmark(markId: number): void {
    const mark = getMark(this.#o.db, markId);
    if (mark === undefined) return;
    const screen = this.#screen(mark.screenId);
    deleteMark(this.#o.db, markId);
    this.#publish(screen.hostId, screen.change, 'mark');
  }

  // --- lock, hi-fi, unlock ---

  /** Why hi-fi is unavailable for a host, or null (D-3). */
  async hiFiUnavailable(hostId: string): Promise<string | null> {
    const runtime = this.#runtime(hostId);
    const tip = await runtime.tip();
    if (tip === null) return `${runtime.host.baseBranch} cannot be read.`;
    try {
      const config = await readHostConfig(runtime.reader, tip);
      return config.drafts === null
        ? 'Hi-fi needs a drafts section (render, entry, guide) in .counterpoint/config.yaml.'
        : null;
    } catch (error) {
      return (error as Error).message;
    }
  }

  /** Lock (spec: Lock a direction): low-fi ends and the hi-fi draft of the locked one is made. */
  lock(draftId: number): void {
    const draft = getDraft(this.#o.db, draftId);
    const screen = draft === undefined ? undefined : draftScreen(this.#o.db, draftId);
    if (draft === undefined || screen === undefined) throw new DraftsRefused('That draft is gone.');
    if (screen.stage !== 'low') throw new DraftsRefused('This screen is locked already.');
    if (draft.state !== 'ready') throw new DraftsRefused('Only a finished draft can be locked.');
    const round = getRound(this.#o.db, draft.roundId);
    if (round?.stage !== 'low') throw new DraftsRefused('Lock a low-fi draft.');
    updateScreen(this.#o.db, screen.id, { stage: 'locked', lockedDraft: draft.id }, this.#now());
    const hifi = insertRound(this.#o.db, screen.id, 'hifi', this.#now());
    this.#publish(screen.hostId, screen.change, 'lock');
    this.#background('hi-fi', { screenId: screen.id }, () =>
      this.#makeHiFi(this.#screen(screen.id), hifi, null),
    );
  }

  /** Unlock: back to low-fi, the next round starting from the locked draft. */
  async unlock(screenId: number): Promise<DraftRoundRow> {
    const screen = this.#screen(screenId);
    if (screen.stage === 'low') throw new DraftsRefused('This screen is not locked.');
    if (screen.stage === 'signed') throw new DraftsRefused('This screen is signed off.');
    const latest = latestRound(this.#o.db, screenId);
    if (latest?.state === 'running') throw new DraftsRefused('The hi-fi draft is being made.');
    await this.#removeWorktree(screen);
    // Hi-fi comments do not carry into low-fi.
    for (const mark of listMarks(this.#o.db, screenId, ['open'])) deleteMark(this.#o.db, mark.id);
    updateScreen(this.#o.db, screenId, { stage: 'low' }, this.#now());
    const locked =
      screen.lockedDraft === null ? null : (getDraft(this.#o.db, screen.lockedDraft) ?? null);
    return this.startRound(screenId, locked);
  }

  /** Send (D-7): the open comments go to a revision of the hi-fi draft. */
  send(screenId: number): DraftRoundRow {
    const screen = this.#screen(screenId);
    if (screen.stage !== 'hifi') throw new DraftsRefused('There is no hi-fi draft to revise.');
    const latest = latestRound(this.#o.db, screenId, 'hifi');
    if (latest === undefined || latest.state !== 'ready') {
      throw new DraftsRefused('The hi-fi draft is not ready.');
    }
    const comments = listMarks(this.#o.db, screenId, ['open']).filter((m) => m.kind === 'comment');
    if (comments.length === 0) throw new DraftsRefused('There are no comments to send.');
    const round = insertRound(this.#o.db, screenId, 'hifi', this.#now());
    for (const mark of comments)
      setMarkState(this.#o.db, mark.id, 'sent', round.number, this.#now());
    this.#publish(screen.hostId, screen.change, 'send');
    this.#background('hi-fi', { screenId }, () =>
      this.#makeHiFi(screen, round, { previous: latest, comments }),
    );
    return round;
  }

  /** Try again on a failed hi-fi draft or revision. */
  retryHiFi(screenId: number): void {
    const screen = this.#screen(screenId);
    const latest = latestRound(this.#o.db, screenId);
    if (latest === undefined || latest.stage !== 'hifi' || latest.state !== 'failed') return;
    const previous = listRounds(this.#o.db, screenId)
      .filter((r) => r.stage === 'hifi' && r.state === 'ready' && r.number < latest.number)
      .at(-1);
    const comments = listMarks(this.#o.db, screenId).filter(
      (m) => m.kind === 'comment' && m.sentRound === latest.number,
    );
    updateRound(this.#o.db, latest.id, { state: 'running', error: null }, this.#now());
    this.#publish(screen.hostId, screen.change, 'retry');
    this.#background('hi-fi', { screenId }, () =>
      this.#makeHiFi(
        screen,
        latest,
        previous === undefined || comments.length === 0 ? null : { previous, comments },
      ),
    );
  }

  /** `<parent>/<repo>-worktrees/draft-<screen>`: a sibling of the repository. */
  #worktreePath(hostRoot: string, screen: DraftScreenRow): string {
    const root = realpathSync(hostRoot);
    return join(
      dirname(root),
      `${basename(root)}-worktrees`,
      `draft-${screen.hostId}-${screen.id}`,
    );
  }

  async #removeWorktree(screen: DraftScreenRow): Promise<void> {
    const runtime = this.#o.host(screen.hostId);
    if (runtime === null) return;
    let path: string;
    try {
      path = this.#worktreePath(runtime.host.root, screen);
    } catch {
      return;
    }
    if (!existsSync(path)) return;
    const removed = await runGit(runtime.host.root, ['worktree', 'remove', '--force', path], {
      allowExitCodes: [0, 128],
    }).catch(() => null);
    if (removed?.exitCode !== 0) {
      rmSync(path, { recursive: true, force: true });
      await runGit(runtime.host.root, ['worktree', 'prune'], { allowExitCodes: [0, 128] }).catch(
        () => undefined,
      );
    }
  }

  /** The hi-fi worktree, made at the base tip on first use (D-3). */
  async #worktree(
    runtime: DraftsHost,
    screen: DraftScreenRow,
    tip: string,
    config: HostConfig,
  ): Promise<string> {
    const path = this.#worktreePath(runtime.host.root, screen);
    if (existsSync(path)) return path;
    mkdirSync(dirname(path), { recursive: true });
    await runGit(runtime.host.root, ['worktree', 'add', '--detach', path, tip], {
      timeoutMs: 300_000,
    });
    await cloneIntoWorktree({
      hostRoot: runtime.host.root,
      worktree: path,
      paths: config.worktree.clone,
    });
    // Counterpoint's own entries never show as changes of the host.
    const exclude = (await runGit(path, ['rev-parse', '--git-path', 'info/exclude'])).stdout.trim();
    const excludePath = exclude.startsWith('/') ? exclude : join(path, exclude);
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
    if (!current.split('\n').includes(`/${ENTRY_DIR}/`)) {
      mkdirSync(dirname(excludePath), { recursive: true });
      writeFileSync(
        excludePath,
        `${current}${current.endsWith('\n') || current === '' ? '' : '\n'}/${ENTRY_DIR}/\n`,
      );
    }
    return path;
  }

  /**
   * Makes a hi-fi version (D-3, D-7): the first from the locked draft, or a revision with the
   * comments. Sessions write entries; the host renders them; Counterpoint packs and maps.
   */
  async #makeHiFi(
    screen: DraftScreenRow,
    round: DraftRoundRow,
    revision: { previous: DraftRoundRow; comments: DraftMarkRow[] } | null,
  ): Promise<void> {
    try {
      const ctx = await this.#context(screen.hostId, screen.change);
      const config = await readHostConfig(ctx.runtime.reader, ctx.tip);
      if (config.drafts === null) {
        throw new DraftsRefused(
          'Hi-fi needs a drafts section (render, entry, guide) in .counterpoint/config.yaml.',
        );
      }
      const drafts: DraftsConfig = config.drafts;
      const worktree = await this.#worktree(ctx.runtime, screen, ctx.tip, config);
      const entries: Record<string, string> = {};
      for (const state of screen.states) {
        entries[state] = `${ENTRY_DIR}/${state}/${drafts.entry}`;
        mkdirSync(join(worktree, ENTRY_DIR, state), { recursive: true });
      }
      // A worktree made again (a restart, a cleanup) gets the last version's entries back.
      if (revision !== null) {
        for (const draft of listDrafts(this.#o.db, revision.previous.id)) {
          const entry = entries[draft.slot];
          const saved = join(draft.dir, 'source.txt');
          if (entry !== undefined && !existsSync(join(worktree, entry)) && existsSync(saved)) {
            mkdirSync(dirname(join(worktree, entry)), { recursive: true });
            copyFileSync(saved, join(worktree, entry));
          }
        }
      }
      const rowsBySlot = new Map(listDrafts(this.#o.db, round.id).map((d) => [d.slot, d]));
      const rows = screen.states.map(
        (state) =>
          rowsBySlot.get(state) ??
          insertDraft(
            this.#o.db,
            {
              roundId: round.id,
              slot: state,
              direction: null,
              dir: this.#folder(
                screen.hostId,
                screen.change,
                `s${screen.id}`,
                `r${round.number}`,
                state,
              ),
            },
            this.#now(),
          ),
      );
      for (const row of rows) updateDraft(this.#o.db, row.id, { state: 'running', error: null });
      this.#publish(screen.hostId, screen.change, 'hifi');

      const env = await this.#o.ownerEnv();
      const session = async (prompt: string, n: number) => {
        const settings = this.#settings(screen.hostId);
        const run = await this.#o.runner(screen.hostId, env).run({
          argv: buildClaudeArgv({
            model: settings.draftModel,
            effort: 'medium',
            maxTurns: 60,
            maxBudgetUsd: 10,
            prompt,
          }),
          cwd: worktree,
          env,
          timeoutMs: HI_FI_TIMEOUT_MS,
          rawLogPath: this.#folder(
            screen.hostId,
            screen.change,
            `s${screen.id}`,
            `r${round.number}`,
            `session-${n}.jsonl`,
          ),
        });
        return lastWords(run.result);
      };

      let sessions = 0;
      if (revision === null) {
        const locked =
          screen.lockedDraft === null ? undefined : getDraft(this.#o.db, screen.lockedDraft);
        const lockedPage =
          locked === undefined ? null : this.#readPage(locked.dir, 'packed', PACKED_PAGE);
        if (lockedPage === null) throw new DraftsRefused('The locked draft is gone.');
        const guide =
          drafts.guide === undefined ? null : await ctx.runtime.reader.read(ctx.tip, drafts.guide);
        await session(
          hiFiPrompt({
            change: screen.change,
            screen,
            states: screen.states,
            locked: lockedPage,
            guide:
              guide === null ? null : new TextDecoder().decode(guide.subarray(0, MAX_GUIDE_BYTES)),
            rules: ctx.rules,
            entries,
            render: drafts.render,
          }),
          ++sessions,
        );
      } else {
        await session(
          revisionPrompt({
            change: screen.change,
            screen: screen.name,
            entries,
            comments: this.#hiFiComments(revision.comments),
          }),
          ++sessions,
        );
      }

      const renderAll = async (states: readonly string[]) => {
        const failed: { state: string; tail: string }[] = [];
        for (const state of states) {
          const row = rows[screen.states.indexOf(state)] as DraftRow;
          const problem = await this.#renderState(
            worktree,
            entries[state] as string,
            row,
            drafts,
            env,
          );
          if (problem !== null) failed.push({ state, tail: problem });
        }
        return failed;
      };
      let failed = await renderAll(screen.states);
      for (let retry = 0; failed.length > 0 && retry < RENDER_RETRIES; retry += 1) {
        await session(
          failed
            .map((f) => renderFailedPrompt(f.state, entries[f.state] as string, f.tail))
            .join('\n\n'),
          ++sessions,
        );
        failed = await renderAll(failed.map((f) => f.state));
      }
      if (failed.length > 0) {
        const first = failed[0] as { state: string; tail: string };
        throw new DraftsRefused(
          `Rendering ${first.state} failed: ${clip(lastLines(first.tail, 3), 240)}`,
        );
      }

      let alsoChanged: string[] = [];
      if (revision !== null) {
        let changed = this.#changedParts(screen, revision.previous, round, revision.comments);
        if (changed.length > 0) {
          await session(restorePrompt(entries, changed), ++sessions);
          const again = await renderAll(screen.states);
          if (again.length === 0) {
            changed = this.#changedParts(screen, revision.previous, round, revision.comments);
          }
        }
        alsoChanged = changed.map((c) => `${c.state}: ${c.part}`);
        this.#matchComments(round, revision.comments);
      }
      for (const row of rows) {
        const maps = await this.#maps(screen.hostId, join(row.dir, 'packed', PACKED_PAGE));
        updateDraft(this.#o.db, row.id, { state: 'ready', error: null, maps }, this.#now());
      }
      updateRound(this.#o.db, round.id, { state: 'ready', error: null, alsoChanged }, this.#now());
      updateScreen(this.#o.db, screen.id, { stage: 'hifi' }, this.#now());
    } catch (error) {
      const message = clip((error as Error).message, 300);
      for (const row of listDrafts(this.#o.db, round.id)) {
        if (row.state === 'running') {
          updateDraft(this.#o.db, row.id, { state: 'failed', error: message }, this.#now());
        }
      }
      updateRound(this.#o.db, round.id, { state: 'failed', error: message }, this.#now());
    }
    this.#publish(screen.hostId, screen.change, 'hifi');
  }

  #hiFiComments(marks: readonly DraftMarkRow[]): HiFiComment[] {
    return marks.map((mark) => ({
      state: getDraft(this.#o.db, mark.draftId)?.slot ?? 'main',
      part: mark.part,
      snippet: mark.snippet,
      note: mark.note ?? '',
    }));
  }

  /** Renders one state's entry like a gate and packs it; the failure's output, or null. */
  async #renderState(
    worktree: string,
    entry: string,
    row: DraftRow,
    drafts: DraftsConfig,
    env: Readonly<Record<string, string>>,
  ): Promise<string | null> {
    const entryPath = join(worktree, entry);
    if (!existsSync(entryPath)) return `The session wrote no ${entry}.`;
    const out = join(row.dir, 'render');
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const command = drafts.render.map((arg) =>
      arg === ENTRY_PLACEHOLDER ? entryPath : arg === OUT_PLACEHOLDER ? out : arg,
    );
    const result = await runGate({
      gate: {
        name: 'render',
        command,
        when: 'every',
        timeout: drafts.timeout,
        testLock: false,
        services: [],
      },
      worktree,
      logPath: join(row.dir, 'render.log'),
      parentEnv: env,
    });
    if (result.verdict !== 'pass') return result.tail || `It ended with ${result.reason}.`;
    try {
      packPage({ root: out, outDir: join(row.dir, 'packed') });
    } catch (error) {
      if (error instanceof PackError) return error.message;
      throw error;
    }
    copyFileSync(entryPath, join(row.dir, 'source.txt'));
    return null;
  }

  /**
   * Parts nobody commented on that differ from the version before (D-7). A part around or inside a
   * commented part is left out: it changes with it.
   */
  #changedParts(
    screen: DraftScreenRow,
    previous: DraftRoundRow,
    round: DraftRoundRow,
    comments: readonly DraftMarkRow[],
  ): { state: string; part: string; before: string }[] {
    const before = new Map(listDrafts(this.#o.db, previous.id).map((d) => [d.slot, d]));
    const after = new Map(listDrafts(this.#o.db, round.id).map((d) => [d.slot, d]));
    const changed: { state: string; part: string; before: string }[] = [];
    for (const state of screen.states) {
      const old = before.get(state);
      const now = after.get(state);
      const oldParts = old === undefined ? null : readParts(old.dir);
      const newParts = now === undefined ? null : readParts(now.dir);
      if (oldParts === null || newParts === null) continue;
      const commented = new Set(
        comments.filter((m) => getDraft(this.#o.db, m.draftId)?.slot === state).map((m) => m.part),
      );
      for (const [id, print] of Object.entries(oldParts.parts)) {
        if (commented.has(id)) continue;
        if (print.ancestors.some((a) => commented.has(a))) continue;
        if ([...commented].some((c) => oldParts.parts[c]?.ancestors.includes(id))) continue;
        const next = newParts.parts[id];
        if (next === undefined || next.hash !== print.hash) {
          changed.push({ state, part: id, before: print.excerpt });
        }
      }
    }
    return changed;
  }

  /** After a revision: each comment's part is found by id, then by text, else Detached (D-7). */
  #matchComments(round: DraftRoundRow, comments: readonly DraftMarkRow[]): void {
    const bySlot = new Map(listDrafts(this.#o.db, round.id).map((d) => [d.slot, d]));
    for (const mark of comments) {
      const slot = getDraft(this.#o.db, mark.draftId)?.slot;
      const draft = slot === undefined ? undefined : bySlot.get(slot);
      const parts = draft === undefined ? null : readParts(draft.dir);
      const found =
        parts !== null &&
        (parts.parts[mark.part] !== undefined ||
          (mark.snippet !== '' && Object.values(parts.parts).some((p) => p.text === mark.snippet)));
      setMarkState(this.#o.db, mark.id, found ? 'addressed' : 'detached', undefined, this.#now());
    }
  }

  // --- sign-off ---

  /** Sign off (D-9): the hi-fi pages land in the change's folder through one planning write. */
  async signOff(screenId: number): Promise<string> {
    const screen = this.#screen(screenId);
    if (screen.stage !== 'hifi') throw new DraftsRefused('Only a hi-fi draft can be signed off.');
    const round = latestRound(this.#o.db, screenId, 'hifi');
    if (round === undefined || round.state !== 'ready') {
      throw new DraftsRefused('The hi-fi draft is not ready.');
    }
    if (this.#o.lane === undefined) throw new DraftsRefused('Planning writes are not available.');
    const ctx = await this.#context(screen.hostId, screen.change);
    const edits = await signOffEdits({
      root: ctx.runtime.host.root,
      tip: ctx.tip,
      change: ctx.facts,
      screen,
      drafts: listDrafts(this.#o.db, round.id),
    });
    const submit = this.#o.lane.submit.bind(this.#o.lane);
    let row: ReturnType<typeof submit>;
    try {
      row = submit(screen.hostId, {
        message: `${screen.change}: sign off the ${screen.name} drafts\n\nThe signed-off hi-fi pages of ${screen.name}, the builder's reference for it (design drafts).`,
        edits,
      });
    } catch (error) {
      throw new DraftsRefused(`The pages could not land: ${(error as Error).message}`);
    }
    updateScreen(this.#o.db, screenId, { stage: 'signed', signoffWrite: row.id }, this.#now());
    await this.#removeWorktree(screen);
    this.#publish(screen.hostId, screen.change, 'signed');
    return 'Landing as a small PR.';
  }

  /** Drop drafts (D-12): everything of the change goes, and the hold ends. */
  async drop(hostId: string, change: string): Promise<boolean> {
    for (const screen of listScreens(this.#o.db, hostId, change)) {
      await this.#removeWorktree(screen);
    }
    const dropped = dropDraftChange(this.#o.db, hostId, change);
    rmSync(this.#folder(hostId, change), { recursive: true, force: true });
    this.#publish(hostId, change, 'drop');
    return dropped;
  }

  // --- the hold ---

  /**
   * Whether the change is held now, from the store (listings, D-12): every screen must be signed
   * off and its sign-off write merged. The build start also checks the pages are on the base.
   */
  hold(hostId: string, change: string): HoldState {
    const row = getDraftChange(this.#o.db, hostId, change);
    if (row === undefined) return { held: false, waiting: [] };
    const screens = listScreens(this.#o.db, hostId, change);
    if (row.state !== 'ready' && screens.length === 0) {
      return { held: true, waiting: ['the screen list'] };
    }
    const waiting = screens
      .filter((screen) => {
        if (screen.stage !== 'signed' || screen.signoffWrite === null) return true;
        return getPlanningWrite(this.#o.db, screen.signoffWrite)?.state !== 'merged';
      })
      .map((screen) => screen.name);
    return { held: waiting.length > 0, waiting };
  }

  /** Every held change of a host, by change (listings). */
  holds(hostId: string): Map<string, HoldState> {
    const holds = new Map<string, HoldState>();
    for (const row of listDraftChanges(this.#o.db, hostId)) {
      holds.set(row.change, this.hold(hostId, row.change));
    }
    return holds;
  }

  /**
   * The hold at a build's start (D-12): the store's hold, plus every signed screen's pages at the
   * build's base commit. Null when the change may build.
   */
  async heldAtBase(
    hostId: string,
    change: ChangeFacts,
    reader: DraftsHost['reader'],
    baseCommit: string,
  ): Promise<string[] | null> {
    const state = this.hold(hostId, change.id);
    if (getDraftChange(this.#o.db, hostId, change.id) === undefined) return null;
    const waiting = [...state.waiting];
    for (const screen of listScreens(this.#o.db, hostId, change.id)) {
      if (waiting.includes(screen.name)) continue;
      const page = `${change.dir}/drafts/${screen.screen}/${screen.states[0] ?? 'main'}.html`;
      if ((await reader.read(baseCommit, page)) === null) waiting.push(screen.name);
    }
    return waiting.length === 0 ? null : waiting;
  }

  // --- the view ---

  /** Everything the Drafts page shows for a change. */
  async view(hostId: string, change: string) {
    const row = getDraftChange(this.#o.db, hostId, change);
    const hiFi = row === undefined ? null : await this.hiFiUnavailable(hostId).catch(() => null);
    return {
      change,
      started: row !== undefined,
      list: row === undefined ? null : { state: row.state, error: row.error },
      hold: this.hold(hostId, change),
      hiFiUnavailable: hiFi,
      screens: (row === undefined ? [] : listScreens(this.#o.db, hostId, change)).map((screen) =>
        this.#screenView(screen),
      ),
    };
  }

  #screenView(screen: DraftScreenRow) {
    const rounds = listRounds(this.#o.db, screen.id);
    const current = rounds.at(-1) ?? null;
    const root = draftsRoot(this.#o.home, screen.hostId);
    const url = (draft: DraftRow) =>
      draft.state === 'ready'
        ? `/h/${screen.hostId}/${draft.dir
            .slice(root.length + 1)
            .split('/')
            .map(encodeURIComponent)
            .join('/')}/packed/${PACKED_PAGE}`
        : null;
    const write =
      screen.signoffWrite === null ? undefined : getPlanningWrite(this.#o.db, screen.signoffWrite);
    return {
      id: screen.id,
      screen: screen.screen,
      name: screen.name,
      purpose: screen.purpose,
      states: screen.states,
      stage: screen.stage,
      lockedDraft: screen.lockedDraft,
      signoff:
        write === undefined
          ? null
          : { state: write.state, prUrl: write.prUrl, reason: write.reason },
      round:
        current === null
          ? null
          : {
              id: current.id,
              number: current.number,
              stage: current.stage,
              state: current.state,
              error: current.error,
              alsoChanged: current.alsoChanged,
              drafts: listDrafts(this.#o.db, current.id).map((draft) => ({
                id: draft.id,
                slot: draft.slot,
                direction: draft.direction,
                state: draft.state,
                error: draft.error,
                url: url(draft),
                maps: draft.maps,
              })),
            },
      lowRounds: rounds.filter((r) => r.stage === 'low').length,
      marks: listMarks(this.#o.db, screen.id)
        .filter((m) => {
          // The marks of the stage shown: open marks in low-fi, every comment in hi-fi.
          const round = getRound(this.#o.db, getDraft(this.#o.db, m.draftId)?.roundId ?? -1);
          if (round?.stage !== current?.stage) return false;
          return round?.stage === 'hifi' ? m.kind === 'comment' : m.state === 'open';
        })
        .map((m) => ({
          id: m.id,
          draftId: m.draftId,
          slot: getDraft(this.#o.db, m.draftId)?.slot ?? null,
          part: m.part,
          snippet: m.snippet,
          kind: m.kind,
          note: m.note,
          width: m.width,
          state: m.state,
        })),
    };
  }
}

/** The files a sign-off lands (D-9): styles once, a page per state, and the entries' source. */
export async function signOffEdits(input: {
  root: string;
  tip: string;
  change: ChangeFacts;
  screen: DraftScreenRow;
  drafts: readonly DraftRow[];
}): Promise<{ kind: 'text'; path: string; before: string | null; after: string }[]> {
  const folder = `${input.change.dir}/drafts`;
  const files: { path: string; after: string }[] = [];
  let styles: string | null = null;
  const sources: string[] = [];
  for (const state of input.screen.states) {
    const draft = input.drafts.find((d) => d.slot === state);
    if (draft === undefined || draft.state !== 'ready') {
      throw new DraftsRefused(`The ${state} page is not ready.`);
    }
    const page = readFileSync(join(draft.dir, 'packed', PACKED_PAGE), 'utf8');
    files.push({
      path: `${folder}/${input.screen.screen}/${state}.html`,
      after: page.replace(STYLES_LINK, `<link rel="stylesheet" href="../${PACKED_STYLES}">`),
    });
    styles ??= readFileSync(join(draft.dir, 'packed', PACKED_STYLES), 'utf8');
    const source = join(draft.dir, 'source.txt');
    if (existsSync(source)) {
      const text = readFileSync(source, 'utf8');
      const fence = '`'.repeat(
        Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
      );
      sources.push(`## ${state}\n\n${fence}tsx\n${text.trimEnd()}\n${fence}\n`);
    }
  }
  files.unshift({ path: `${folder}/${PACKED_STYLES}`, after: styles ?? '' });
  files.push({
    path: `${folder}/${input.screen.screen}/source.md`,
    after: `# ${input.screen.name}: source\n\nThe hi-fi entries the signed-off pages were rendered from: which components and props they use. Reference only; nothing compiles them.\n\n${sources.join('\n')}`,
  });
  const edits = [];
  for (const file of files) {
    if (Buffer.byteLength(file.after) > MAX_SIGNOFF_FILE) {
      throw new DraftsRefused(
        `${file.path} is larger than 1 MiB; it cannot land as a planning file.`,
      );
    }
    const was = await catBlob(input.root, input.tip, file.path);
    const before = was === null ? null : new TextDecoder().decode(was);
    if (before === file.after) continue;
    edits.push({ kind: 'text' as const, path: file.path, before, after: file.after });
  }
  if (edits.length === 0) throw new DraftsRefused('These pages are on the base already.');
  return edits;
}

/** The card when no browser can map drafts (D-6). */
export function noBrowserCard(hostId: string): NewCard {
  return {
    hostId,
    key: `drafts-browser:${hostId}`,
    kind: NO_BROWSER_KIND,
    source: 'machine',
    question: 'Install a browser so drafts can be selected and commented on?',
    why: "Counterpoint maps each draft in headless Chromium, and found neither Playwright's Chromium nor Google Chrome. Drafts show, but their parts cannot be picked.",
    options: [
      {
        label: 'I installed Chrome',
        consequence: 'Try again on a draft maps it.',
      },
      {
        label: 'I ran the Playwright install',
        consequence:
          '`npx playwright-core install chromium` downloads it; Try again on a draft maps it.',
      },
    ],
    recommended: 0,
    reversible: true,
    blocking: false,
  };
}
