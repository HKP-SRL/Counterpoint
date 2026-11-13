// Design drafts in the console (design-drafts D-13): the Drafts page's data, its actions, and the
// pure parts of its element layer (which part is under the pointer, what a key does), kept here so
// they can be tested without a browser.
import { queryOptions } from '@tanstack/react-query';
import { apiGet, apiPostAnswer, queryKeys } from './api';

export type DraftWidth = 'phone' | 'desktop';
export type ScreenStage = 'low' | 'locked' | 'hifi' | 'signed';
export type DraftState = 'running' | 'ready' | 'failed';
export type MarkState = 'open' | 'sent' | 'addressed' | 'detached';

export interface MapPart {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface PageMap {
  width: number;
  height: number;
  parts: MapPart[];
}

export interface DraftView {
  id: number;
  slot: string;
  direction: string | null;
  state: DraftState;
  error: string | null;
  /** The packed page's path on the draft origin, once ready. */
  url: string | null;
  maps: Partial<Record<DraftWidth, PageMap>> | null;
}

export interface MarkView {
  id: number;
  draftId: number;
  slot: string | null;
  part: string;
  snippet: string;
  kind: 'select' | 'comment';
  note: string | null;
  width: DraftWidth;
  state: MarkState;
}

export interface ScreenView {
  id: number;
  screen: string;
  name: string;
  purpose: string;
  states: string[];
  stage: ScreenStage;
  lockedDraft: number | null;
  signoff: { state: string; prUrl: string | null; reason: string | null } | null;
  round: {
    id: number;
    number: number;
    stage: 'low' | 'hifi';
    state: DraftState;
    error: string | null;
    alsoChanged: string[];
    drafts: DraftView[];
  } | null;
  lowRounds: number;
  marks: MarkView[];
}

export interface DraftsView {
  change: string;
  started: boolean;
  list: { state: 'listing' | 'ready' | 'failed'; error: string | null } | null;
  hold: { held: boolean; waiting: string[] };
  hiFiUnavailable: string | null;
  screens: ScreenView[];
  /** The draft server's origin, or null when it is not running. */
  origin: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The page's answer, trusted for shape only after these checks (the server is ours). */
function parseView(body: unknown, change: string): DraftsView {
  if (!isRecord(body) || !Array.isArray(body.screens)) {
    return {
      change,
      started: false,
      list: null,
      hold: { held: false, waiting: [] },
      hiFiUnavailable: null,
      screens: [],
      origin: null,
    };
  }
  const origin =
    typeof body.origin === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(body.origin)
      ? body.origin
      : null;
  return { ...(body as unknown as DraftsView), origin };
}

const path = (hostId: string, change: string) =>
  `/api/hosts/${encodeURIComponent(hostId)}/drafts/${encodeURIComponent(change)}`;

export const draftsQuery = (hostId: string, change: string) =>
  queryOptions({
    queryKey: queryKeys.drafts(hostId, change),
    queryFn: async ({ signal }) => parseView(await apiGet(path(hostId, change), signal), change),
  });

/** Posts a drafts action; the refusal's words, or null. */
export async function draftAction(
  hostId: string,
  change: string,
  action: string,
  body: unknown = {},
): Promise<string | null> {
  const answer = await apiPostAnswer(`${path(hostId, change)}/${action}`, body);
  if (answer.ok) return null;
  return typeof answer.body.error === 'string' ? answer.body.error : 'That did not work.';
}

/** The smallest part under a point of the page (page pixels), or null. */
export function partAt(map: PageMap, x: number, y: number): MapPart | null {
  let best: MapPart | null = null;
  for (const part of map.parts) {
    if (part.w <= 0 || part.h <= 0) continue;
    if (x < part.x || y < part.y || x > part.x + part.w || y > part.y + part.h) continue;
    if (best === null || part.w * part.h < best.w * best.h) best = part;
  }
  return best;
}

/** How much a page `pageWidth` wide is scaled to fit `available` pixels (never enlarged). */
export function fitScale(pageWidth: number, available: number): number {
  if (pageWidth <= 0 || available <= 0) return 1;
  return Math.min(1, available / pageWidth);
}

export type DraftKeyAction =
  | { type: 'select' }
  | { type: 'comment' }
  | { type: 'fullscreen' }
  | { type: 'close' };

export interface DraftKeyInput {
  key: string;
  /** Meta, Ctrl or Alt held. */
  modified: boolean;
  /** Focus is in a text field. */
  typing: boolean;
}

export interface DraftKeyState {
  /** A part is hovered (or picked). */
  part: boolean;
  /** Selecting is offered (low-fi only). */
  canSelect: boolean;
  /** A draft is hovered or shown full-screen. */
  draft: boolean;
  /** Something is open that Esc closes (the comment box, full-screen). */
  open: boolean;
}

/** What a key does on the Drafts page (D-13): S selects, C comments, F full-screen, Esc closes. */
export function draftKey(input: DraftKeyInput, state: DraftKeyState): DraftKeyAction | null {
  if (input.key === 'Escape') return state.open ? { type: 'close' } : null;
  if (input.typing || input.modified) return null;
  switch (input.key.toLowerCase()) {
    case 's':
      return state.part && state.canSelect ? { type: 'select' } : null;
    case 'c':
      return state.part ? { type: 'comment' } : null;
    case 'f':
      return state.draft ? { type: 'fullscreen' } : null;
    default:
      return null;
  }
}

/** The marks list line (D-13): "A header (select)", "C list: fewer cards". */
export function markLabel(mark: Pick<MarkView, 'slot' | 'part' | 'kind' | 'note'>): string {
  const where = `${mark.slot ?? '?'} ${mark.part}`;
  return mark.kind === 'select' ? `${where} (select)` : `${where}: ${mark.note ?? ''}`;
}

/** What a mark's state is called in the comments list. */
export const MARK_STATE_LABEL: Record<MarkState, string> = {
  open: 'Not sent',
  sent: 'Sent',
  addressed: 'Addressed',
  detached: 'Detached',
};
