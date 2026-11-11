import { describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../../src/adapters/openspec/index.ts';
import type { ChangeFacts } from '../../../src/core/framework/port.ts';

const adapter = createOpenSpecAdapter();
const change = {
  id: 'add-menu',
  dir: 'openspec/changes/add-menu',
  artifacts: { proposal: true, design: false, tasks: true, specs: [] },
} as unknown as ChangeFacts;

describe('OpenSpec adapter, build-lane methods', () => {
  it('treats everything under openspec/ as planning', () => {
    expect(adapter.isPlanningPath('openspec/changes/x/tasks.md')).toBe(true);
    expect(adapter.isPlanningPath('openspec')).toBe(true);
    expect(adapter.isPlanningPath('openspecs/x')).toBe(false);
    expect(adapter.isPlanningPath('src/openspec/x')).toBe(false);
  });

  it('names the task list, or none', () => {
    expect(adapter.tasksPath(change)).toBe('openspec/changes/add-menu/tasks.md');
    expect(
      adapter.tasksPath({ ...change, artifacts: { ...change.artifacts, tasks: false } }),
    ).toBeNull();
  });

  it('finds ticked tasks by text, once per listing', () => {
    const before = '- [ ] 1.1 A\n- [x] 1.2 B\n- [ ] 1.3 C\n- [ ] dup\n- [ ] dup\n';
    const after = '- [x] 1.1 A\n- [x] 1.2 B\n- [ ] 1.3 C\n- [x] dup\n- [ ] dup\n';
    expect(adapter.tickedTasks(before, after)).toEqual(['1.1 A', 'dup']);
  });

  it('tells tick-only edits from real ones', () => {
    expect(adapter.sameApartFromTicks('- [ ] a\n', '- [x] a\n')).toBe(true);
    expect(adapter.sameApartFromTicks('- [ ] a\n', '- [x] a, changed\n')).toBe(false);
    expect(adapter.sameApartFromTicks('- [ ] a\n', '- [ ] a\n- [ ] b\n')).toBe(false);
  });

  it('tells the builder to use the host workflow and leave other planning files alone', () => {
    const text = adapter.buildInstructions(change);
    expect(text).toContain('openspec-apply-change');
    expect(text).toContain('/opsx:apply');
    expect(text).toContain('Owner:');
    expect(text).toContain('Do not edit any other file under openspec/');
  });
});
