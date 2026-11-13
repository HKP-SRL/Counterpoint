// Design rules (design-drafts 6.4, D-11): given verbatim with the file, nothing without it, and cut
// at the last whole line under 8 KB, saying so, when it is longer.
import { describe, expect, it } from 'vitest';
import { builderPrompt, designRulesSection } from '../../src/build/prompt.ts';
import { DESIGN_RULES_MAX_BYTES, designRulesFrom } from '../../src/core/host/design-rules.ts';

const bytes = (text: string) => new TextEncoder().encode(text);
const prompt = (rules: ReturnType<typeof designRulesFrom>) =>
  builderPrompt({
    changeId: 'quiet',
    branch: 'cp/quiet',
    instructions: 'Build it.',
    session: 1,
    handoff: null,
    gateFailure: null,
    doneTasks: [],
    gates: [],
    testBudget: 30,
    designRules: rules,
  });

describe('design rules in prompts', () => {
  it('gives the rules verbatim when the file is there, and nothing without it', () => {
    const rules = designRulesFrom(bytes('# Rules\n\n- Forms group related fields.\n'));
    expect(prompt(rules)).toContain('- Forms group related fields.');
    expect(prompt(rules)).toContain('.counterpoint/design-rules.md');
    expect(prompt(null)).not.toContain('design rules');
    expect(designRulesSection(designRulesFrom(bytes('  \n')))).toEqual([]);
  });

  it('cuts a file over 8 KB at a whole line and says so', () => {
    const line = 'x'.repeat(99);
    const rules = designRulesFrom(bytes(`${line}\n`.repeat(100)));
    expect(rules?.clipped).toBe(true);
    expect(Buffer.byteLength(rules?.text ?? '')).toBeLessThanOrEqual(DESIGN_RULES_MAX_BYTES);
    expect(rules?.text.endsWith(line)).toBe(true);
    expect(prompt(rules)).toContain('longer than 8 KB');
  });
});
