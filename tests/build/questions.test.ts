// The builder's ask-first questions, as it writes them in its blocked note (build-runs: Ask first
// before what cannot be undone; needs-you: Builder questions in Needs You).
import { describe, expect, it } from 'vitest';
import { parseQuestions } from '../../src/build/questions.ts';

describe('parseQuestions', () => {
  it('reads the documented format', () => {
    const note = [
      '## Question',
      'Task: 3.2 Run the migration on the hosted database',
      'Question: The migration drops the orders_old table on the hosted database.',
      'Run it now?',
      'Options:',
      '1. Run it against the hosted database now',
      '2. Leave it for you to run after the merge',
      '3. Rewrite it to keep the old table',
      'Recommended: 2',
      'Waiting: 3.3, 3.4',
    ].join('\n');
    expect(parseQuestions(note)).toEqual([
      {
        task: '3.2 Run the migration on the hosted database',
        text: 'The migration drops the orders_old table on the hosted database. Run it now?',
        options: [
          'Run it against the hosted database now',
          'Leave it for you to run after the merge',
          'Rewrite it to keep the old table',
        ],
        recommended: 1,
        waiting: ['3.3', '3.4'],
      },
    ]);
  });

  it('takes several questions, bullets, a marked recommendation and bold keys', () => {
    const note = [
      '# Blocked',
      'Some notes first.',
      '### Question 1',
      '**Question:** Publish the package to npm?',
      '**Options:**',
      '- Publish now',
      '- Keep it private (recommended)',
      '### Question 2',
      'Question: Rotate the live Stripe key?',
      'Options:',
      'a) Rotate it now',
      'b) Leave it',
      'Recommended: b',
      'Waiting: none',
    ].join('\n');
    expect(parseQuestions(note)).toEqual([
      {
        task: null,
        text: 'Publish the package to npm?',
        options: ['Publish now', 'Keep it private'],
        recommended: 1,
        waiting: [],
      },
      {
        task: null,
        text: 'Rotate the live Stripe key?',
        options: ['Rotate it now', 'Leave it'],
        recommended: 1,
        waiting: [],
      },
    ]);
  });

  it('finds no question in a note that has none, and never throws', () => {
    expect(parseQuestions('- 1.1 waits on the Owner: step\n')).toEqual([]);
    expect(parseQuestions('## Question\nOptions:\n- a\n')).toEqual([]);
    expect(parseQuestions('')).toEqual([]);
    expect(
      parseQuestions('## Question\nQuestion: Which?\nOptions:\n- A\nRecommended: 9\n')[0]
        ?.recommended,
    ).toBeNull();
  });
});
