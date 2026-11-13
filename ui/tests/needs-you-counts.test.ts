// What waits across every project (needs-you: One inbox): the counts the badge, the tab title, the
// switcher and notifications read, what refetches them, and the empty inbox that names another
// project with items waiting.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type HostSummary, parseNeedsYouCounts, queryKeys, waitingElsewhere } from '../src/api';
import { EVENT_FAMILIES, keysForEvent } from '../src/live';
import { AlsoWaiting, elsewhereText, NeedsYouEmptyView } from '../src/pages/NeedsYouPage';

const host = (id: string, name = id): HostSummary => ({
  id,
  name,
  root: `/repos/${name}`,
  baseBranch: 'main',
});
const hosts = [host('counterpoint', 'Counterpoint'), host('cena', 'Cena'), host('cv', 'CV')];

describe('needs-you counts', () => {
  it('reads the counts and drops what it cannot trust', () => {
    expect(
      parseNeedsYouCounts({
        total: 3,
        machine: 1,
        hosts: [{ hostId: 'cena', count: 2 }, { hostId: 7 }, 'x'],
        blocking: [
          { id: 'c-1', hostId: 'cena', question: 'Drop the table?' },
          { id: 'c-2', hostId: null, question: 'Restart?' },
          { id: 'c-3' },
        ],
      }),
    ).toEqual({
      total: 3,
      machine: 1,
      hosts: [{ hostId: 'cena', count: 2 }],
      blocking: [
        { id: 'c-1', hostId: 'cena', question: 'Drop the table?' },
        { id: 'c-2', hostId: null, question: 'Restart?' },
      ],
    });
    expect(parseNeedsYouCounts(null)).toEqual({ total: 0, machine: 0, hosts: [], blocking: [] });
    expect(parseNeedsYouCounts({ total: -1, hosts: [{ hostId: 'a', count: 1.5 }] }).total).toBe(0);
  });

  it('lists the other projects with items waiting, most first', () => {
    const counts = parseNeedsYouCounts({
      total: 4,
      machine: 0,
      hosts: [
        { hostId: 'counterpoint', count: 1 },
        { hostId: 'cena', count: 1 },
        { hostId: 'cv', count: 2 },
        { hostId: 'gone', count: 5 },
      ],
      blocking: [],
    });
    expect(waitingElsewhere(counts, hosts, 'counterpoint')).toEqual([
      { id: 'cv', name: 'CV', count: 2 },
      { id: 'cena', name: 'Cena', count: 1 },
    ]);
    expect(waitingElsewhere(undefined, hosts, 'counterpoint')).toEqual([]);
  });

  it('every event that can change an inbox refetches the counts', () => {
    const data = JSON.stringify({ hostId: 'cena' });
    for (const family of ['host', 'planning', 'approval', 'needs-you', 'run'] as const) {
      expect(keysForEvent(family, data)).toContainEqual(queryKeys.needsYouCounts);
    }
    // A machine card has no host: every inbox and the counts.
    expect(keysForEvent('needs-you', JSON.stringify({}))).toContainEqual(queryKeys.needsYouCounts);
    expect(keysForEvent('runway', data)).not.toContainEqual(queryKeys.needsYouCounts);
    expect(EVENT_FAMILIES).toContain('needs-you');
  });
});

describe('the empty inbox', () => {
  it('says what waits elsewhere in one line', () => {
    expect(elsewhereText([{ id: 'cena', name: 'Cena', count: 2 }])).toBe('2 items wait in Cena.');
    expect(elsewhereText([{ id: 'cena', name: 'Cena', count: 1 }])).toBe('1 item waits in Cena.');
    expect(
      elsewhereText([
        { id: 'cena', name: 'Cena', count: 1 },
        { id: 'cv', name: 'CV', count: 1 },
      ]),
    ).toBe('Items wait in 2 other projects.');
  });

  it('names another project with items waiting, with a link to its inbox', () => {
    const html = renderToStaticMarkup(
      createElement(NeedsYouEmptyView, { elsewhere: [{ id: 'cena', name: 'Cena', count: 2 }] }),
    );
    expect(html).toContain('Nothing needs you here');
    expect(html).toContain('2 items wait in Cena.');
    expect(html).toContain('href="/h/cena/needs-you"');
  });

  it('stays "Nothing needs you" when no project has anything waiting', () => {
    const html = renderToStaticMarkup(createElement(NeedsYouEmptyView, { elsewhere: [] }));
    expect(html).toContain('Nothing needs you');
    expect(html).not.toContain('Nothing needs you here');
    expect(html).not.toContain('href=');
  });

  it('under a non-empty inbox, one line names what also waits elsewhere', () => {
    expect(renderToStaticMarkup(createElement(AlsoWaiting, { elsewhere: [] }))).toBe('');
    const html = renderToStaticMarkup(
      createElement(AlsoWaiting, { elsewhere: [{ id: 'cv', name: 'CV', count: 1 }] }),
    );
    expect(html).toContain('Also waiting: 1 item waits in CV.');
    expect(html).toContain('href="/h/cv/needs-you"');
  });
});
