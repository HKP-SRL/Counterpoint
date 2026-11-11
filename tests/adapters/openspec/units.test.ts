// Pure parsing units of the OpenSpec adapter: proposal, metadata, tasks (progress, owner steps,
// the `cp-openspec-tasks/v1` normalizer) and change order.
import { describe, expect, it } from 'vitest';
import { parseMetadata } from '../../../src/adapters/openspec/metadata.ts';
import { orderChanges } from '../../../src/adapters/openspec/order.ts';
import { parseProposal } from '../../../src/adapters/openspec/proposal.ts';
import {
  countTasks,
  normalizeTasks,
  TASKS_NORMALIZER,
} from '../../../src/adapters/openspec/tasks.ts';

describe('parseProposal', () => {
  it('takes the first top-level heading as the title and the Why section as why', () => {
    const text =
      '# QR menu browsing\n\n## Why\n\nDiners scan a code.\n\nThey see the menu.\n\n### Detail\n\nStill why.\n\n## What Changes\n\n- Things\n';
    expect(parseProposal(text)).toEqual({
      title: 'QR menu browsing',
      why: 'Diners scan a code.\n\nThey see the menu.\n\n### Detail\n\nStill why.',
    });
  });

  it('has no title without a depth-1 heading, and ignores headings inside code fences', () => {
    const text = '```md\n# Not a title\n## Why\nnope\n```\n\n## Why\n\nReal why.\n';
    expect(parseProposal(text)).toEqual({ title: null, why: 'Real why.' });
  });

  it('has no why when the section is missing or empty', () => {
    expect(parseProposal('# T\n\n## Why\n\n## What Changes\n\nx\n').why).toBeNull();
    expect(parseProposal('# T\n\nBody.\n').why).toBeNull();
  });

  it('caps a very long why and title', () => {
    const facts = parseProposal(`# ${'T'.repeat(500)}\n\n## Why\n\n${'w'.repeat(5000)}\n`);
    expect(facts.title?.length).toBe(200);
    expect(facts.why?.length).toBe(1200);
    expect(facts.why?.endsWith('…')).toBe(true);
  });
});

describe('parseMetadata', () => {
  it('reads created and x-depends-on, ignoring other keys', () => {
    expect(
      parseMetadata(
        'schema: spec-driven\ncreated: 2026-11-01\nx-depends-on: [a-change, b]\ngoal: x\n',
      ),
    ).toEqual({ ok: true, metadata: { created: '2026-11-01', dependsOn: ['a-change', 'b'] } });
  });

  it('treats an empty file or missing keys as no date and no dependencies', () => {
    expect(parseMetadata('')).toEqual({ ok: true, metadata: { created: null, dependsOn: [] } });
    expect(parseMetadata('schema: spec-driven\n')).toEqual({
      ok: true,
      metadata: { created: null, dependsOn: [] },
    });
  });

  it('keeps created null when it is not a real YYYY-MM-DD date (not unreadable)', () => {
    for (const bad of ['created: yesterday', 'created: 2026-13-01', 'created: 2026-02-30']) {
      expect(parseMetadata(bad)).toEqual({ ok: true, metadata: { created: null, dependsOn: [] } });
    }
  });

  it('is unreadable for malformed YAML, with a one-line reason', () => {
    const result = parseMetadata('created: [unclosed\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/^Invalid YAML: /);
      expect(result.reason).not.toContain('\n');
    }
  });

  it('is unreadable for duplicate keys and for dependencies that are not change names', () => {
    expect(parseMetadata('created: 2026-11-01\ncreated: 2026-11-02\n').ok).toBe(false);
    const bad = parseMetadata('x-depends-on: [Not_A_Change]\n');
    expect(bad).toEqual({
      ok: false,
      reason: expect.stringMatching(/^Invalid metadata: x-depends-on\.0: not a change name/),
    });
    expect(parseMetadata('x-depends-on: a-change\n').ok).toBe(false);
    expect(parseMetadata('- a\n- b\n').ok).toBe(false);
  });
});

describe('countTasks', () => {
  it('counts checkboxes the way OpenSpec does', () => {
    const text = [
      '# Tasks',
      '- [ ] 1.1 open',
      '- [x] 1.2 done',
      '* [X] 1.3 done upper',
      '  - [ x] 1.4 padded done',
      '1. [ ] 1.5 ordered',
      '+ [~] 1.6 odd marker counts as open',
      '- [link](./doc.md) not a task',
      '- [A](https://example.com) not a task',
      '- plain bullet',
    ].join('\r\n');
    expect(countTasks(text)).toEqual({ total: 6, done: 3, ownerSteps: [] });
  });

  it('lists unchecked Owner: tasks (after an optional number) as owner steps', () => {
    const text = [
      '- [ ] 1.1 Owner: create the Supabase project',
      '- [ ] Owner: add the   API key',
      '- [x] 1.3 Owner: already done',
      '- [ ] 1.4 Ask the Owner: not a step',
      '- [ ] 1.5 owner: lowercase is not a step',
    ].join('\n');
    expect(countTasks(text)).toEqual({
      total: 5,
      done: 1,
      ownerSteps: ['Owner: create the Supabase project', 'Owner: add the API key'],
    });
  });
});

describe(`normalizeTasks (${TASKS_NORMALIZER})`, () => {
  const base = '# Tasks\n\n## 1. Setup\n\n- [ ] 1.1 One\n- [ ] 1.2 Two\n';

  it('reads every done box as open, keeping the marker and the text', () => {
    const ticked = '# Tasks\n\n## 1. Setup\n\n- [x] 1.1 One\n- [X] 1.2 Two\n';
    expect(normalizeTasks(ticked)).toBe(base);
    expect(normalizeTasks('  * [ x ] nested\n1. [x] ordered\n')).toBe(
      '  * [ ] nested\n1. [ ] ordered\n',
    );
  });

  it('normalizes line endings, trailing whitespace and surrounding blank lines', () => {
    const messy = '\r\n\n# Tasks  \r\n\r\n## 1. Setup\t\r\n\r\n- [ ] 1.1 One \r- [ ] 1.2 Two\n\n\n';
    expect(normalizeTasks(messy)).toBe(base);
  });

  it('keeps every other edit visible', () => {
    expect(normalizeTasks(base.replace('One', 'Uno'))).not.toBe(base);
    expect(normalizeTasks(`${base}- [ ] 1.3 Three\n`)).not.toBe(base);
    expect(normalizeTasks(base.replace('- [ ] 1.2 Two\n', ''))).not.toBe(base);
    // Not a done marker: stays as written.
    expect(normalizeTasks('- [~] maybe\n')).toBe('- [~] maybe\n');
    expect(normalizeTasks('- [x](./link.md)\n')).toBe('- [x](./link.md)\n');
  });
});

describe('orderChanges', () => {
  const c = (
    id: string,
    created: string | null,
    dependsOn: string[] = [],
    archivedOn: string | null = null,
  ) => ({ id, created, dependsOn, archived: archivedOn !== null, archivedOn });
  const ids = (list: { id: string }[]) => list.map((x) => x.id);

  it('orders by created, then id, with no dated changes last', () => {
    expect(
      ids(
        orderChanges([
          c('b', '2026-10-02'),
          c('z', null),
          c('a', '2026-10-02'),
          c('c', '2026-10-01'),
        ]),
      ),
    ).toEqual(['c', 'a', 'b', 'z']);
  });

  it('puts a dependency before its dependent, even when it was created later', () => {
    expect(ids(orderChanges([c('b', '2026-10-01', ['a']), c('a', '2026-10-05')]))).toEqual([
      'a',
      'b',
    ]);
  });

  it('follows a chain and breaks ties among free changes by created, then id', () => {
    const list = [
      c('d', '2026-10-01', ['c']),
      c('c', '2026-10-02', ['b']),
      c('b', '2026-10-03', ['a']),
      c('a', '2026-10-04'),
      c('x', '2026-10-03'),
    ];
    expect(ids(orderChanges(list))).toEqual(['x', 'a', 'b', 'c', 'd']);
  });

  it('treats unknown and archived dependencies as satisfied', () => {
    const list = [
      c('b', '2026-10-01', ['gone', 'old']),
      c('a', '2026-10-02'),
      c('old', null, [], '2026-09-01'),
    ];
    expect(ids(orderChanges(list))).toEqual(['b', 'a', 'old']);
  });

  it('breaks a cycle at its first member by created, then id; dependents still follow', () => {
    const list = [
      c('free', '2026-10-09'),
      c('y', '2026-10-02', ['x']),
      c('x', '2026-10-03', ['y']),
      c('after', '2026-10-01', ['x']),
    ];
    expect(ids(orderChanges(list))).toEqual(['free', 'y', 'x', 'after']);
  });

  it('ignores a self-dependency', () => {
    expect(ids(orderChanges([c('a', '2026-10-02', ['a']), c('b', '2026-10-01')]))).toEqual([
      'b',
      'a',
    ]);
  });

  it('lists archived changes after the active ones, newest archive first', () => {
    const list = [
      c('old-b', null, [], '2026-09-01'),
      c('active', null),
      c('new', null, [], '2026-10-01'),
      c('old-a', null, [], '2026-09-01'),
    ];
    expect(ids(orderChanges(list))).toEqual(['active', 'new', 'old-a', 'old-b']);
  });
});
