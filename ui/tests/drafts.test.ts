// The Drafts page's keys and element layer (design-drafts 5.1-5.3, D-13): S selects the hovered
// part (low-fi only), C comments on it, F opens full-screen, Esc closes; the smallest part under
// the pointer is the one picked; marks across two drafts are told apart by their draft.
import { describe, expect, it } from 'vitest';
import { draftKey, fitScale, markLabel, partAt } from '../src/drafts';

const key = (k: string, typing = false, modified = false) => ({ key: k, typing, modified });
const ON = { part: true, canSelect: true, draft: true, open: false };

describe('draft keys', () => {
  it('S selects, C comments and F opens full-screen when a part is hovered', () => {
    expect(draftKey(key('s'), ON)).toEqual({ type: 'select' });
    expect(draftKey(key('C'), ON)).toEqual({ type: 'comment' });
    expect(draftKey(key('f'), ON)).toEqual({ type: 'fullscreen' });
  });

  it('S is not offered on hi-fi, and nothing acts without a part, while typing or with a modifier', () => {
    expect(draftKey(key('s'), { ...ON, canSelect: false })).toBeNull();
    expect(draftKey(key('c'), { ...ON, part: false })).toBeNull();
    expect(draftKey(key('s', true), ON)).toBeNull();
    expect(draftKey(key('f', false, true), ON)).toBeNull();
  });

  it('Esc closes what is open, even from the comment box', () => {
    expect(draftKey(key('Escape', true), { ...ON, open: true })).toEqual({ type: 'close' });
    expect(draftKey(key('Escape'), ON)).toBeNull();
  });
});

describe('element layer', () => {
  const map = {
    width: 390,
    height: 800,
    parts: [
      { id: 'page', x: 0, y: 0, w: 390, h: 800, text: '' },
      { id: 'header', x: 0, y: 0, w: 390, h: 60, text: 'Today' },
      { id: 'title', x: 10, y: 10, w: 100, h: 20, text: 'Today' },
    ],
  };

  it('picks the smallest part under the pointer', () => {
    expect(partAt(map, 20, 15)?.id).toBe('title');
    expect(partAt(map, 300, 30)?.id).toBe('header');
    expect(partAt(map, 300, 500)?.id).toBe('page');
    expect(partAt(map, 500, 500)).toBeNull();
  });

  it('scales a desktop page down to its column, never up', () => {
    expect(fitScale(1440, 360)).toBe(0.25);
    expect(fitScale(390, 800)).toBe(1);
  });

  it("names marks across two drafts by their draft: A's header, C's list", () => {
    expect(markLabel({ slot: 'A', part: 'header', kind: 'select', note: null })).toBe(
      'A header (select)',
    );
    expect(markLabel({ slot: 'C', part: 'list', kind: 'comment', note: 'fewer cards' })).toBe(
      'C list: fewer cards',
    );
  });
});
