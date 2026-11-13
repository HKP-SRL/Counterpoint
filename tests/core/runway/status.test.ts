import { describe, expect, it } from 'vitest';
import type { ChangeFacts } from '../../../src/core/framework/port.ts';
import { deriveChangeStatus, isBuilt, ownerSteps } from '../../../src/core/runway/status.ts';

function change(overrides: Partial<ChangeFacts> = {}): ChangeFacts {
  return {
    id: 'ready-thing',
    dir: 'openspec/changes/ready-thing',
    archived: false,
    archivedOn: null,
    title: 'Ready thing',
    why: null,
    created: '2026-10-01',
    dependsOn: [],
    artifacts: { proposal: true, design: false, tasks: true, specs: [] },
    tasks: { total: 3, done: 1, ownerSteps: [] },
    unreadable: null,
    ...overrides,
  };
}

const unreadable = { file: 'openspec/changes/ready-thing/.openspec.yaml', reason: 'bad YAML' };

describe('deriveChangeStatus', () => {
  it('reports an unreadable change as unreadable, whatever else is true', () => {
    expect(deriveChangeStatus(change({ unreadable }))).toEqual({
      status: 'unreadable',
      notReadyReason: null,
    });
    expect(deriveChangeStatus(change({ unreadable }), 'on-runway').status).toBe('unreadable');
    expect(deriveChangeStatus(change({ unreadable, archived: true })).status).toBe('unreadable');
  });

  it('reports an archived change as built, even with open tasks or no proposal', () => {
    const archived = change({
      archived: true,
      archivedOn: '2026-09-01',
      artifacts: { proposal: false, design: false, tasks: false, specs: [] },
      tasks: { total: 0, done: 0, ownerSteps: [] },
    });
    expect(deriveChangeStatus(archived)).toEqual({ status: 'built', notReadyReason: null });
    expect(deriveChangeStatus(archived, 'on-runway').status).toBe('built');
  });

  it('reports a change whose every task is done as built, over any overlay', () => {
    const done = change({ tasks: { total: 2, done: 2, ownerSteps: [] } });
    expect(deriveChangeStatus(done)).toEqual({ status: 'built', notReadyReason: null });
    expect(deriveChangeStatus(done, 'on-runway').status).toBe('built');
  });

  it('is not built while any task is open, nor with no tasks at all', () => {
    expect(
      deriveChangeStatus(change({ tasks: { total: 2, done: 1, ownerSteps: [] } })).status,
    ).toBe('ready');
    expect(isBuilt(change({ tasks: { total: 0, done: 0, ownerSteps: [] } }))).toBe(false);
  });

  it('applies the approval overlay to an unbuilt, readable change', () => {
    expect(deriveChangeStatus(change(), 'on-runway')).toEqual({
      status: 'on-runway',
      notReadyReason: null,
    });
    // The overlay wins even when the change would otherwise not be ready.
    const bare = change({ artifacts: { proposal: false, design: false, tasks: false, specs: [] } });
    expect(deriveChangeStatus(bare, 'on-runway').status).toBe('on-runway');
  });

  it('reports a proposal plus at least one task as ready', () => {
    expect(deriveChangeStatus(change())).toEqual({ status: 'ready', notReadyReason: null });
    expect(deriveChangeStatus(change(), null).status).toBe('ready');
  });

  it('reports a change without a proposal as not planned (no-proposal), before no-tasks', () => {
    const noProposal = change({
      artifacts: { proposal: false, design: false, tasks: false, specs: [] },
      tasks: { total: 0, done: 0, ownerSteps: [] },
    });
    expect(deriveChangeStatus(noProposal)).toEqual({
      status: 'not-planned',
      notReadyReason: 'no-proposal',
    });
  });

  it('reports a proposal without tasks as not planned (no-tasks)', () => {
    const noTasks = change({
      artifacts: { proposal: true, design: true, tasks: true, specs: ['menu'] },
      tasks: { total: 0, done: 0, ownerSteps: [] },
    });
    expect(deriveChangeStatus(noTasks)).toEqual({
      status: 'not-planned',
      notReadyReason: 'no-tasks',
    });
  });
});

describe('ownerSteps', () => {
  it('returns the owner steps in task order without repeats', () => {
    const facts = change({
      tasks: {
        total: 4,
        done: 0,
        ownerSteps: [
          'Owner: create the project',
          'Owner: add the key',
          'Owner: create the project',
        ],
      },
    });
    expect(ownerSteps(facts)).toEqual(['Owner: create the project', 'Owner: add the key']);
  });

  it('is empty when there are none, and never aliases the facts', () => {
    const facts = change();
    expect(ownerSteps(facts)).toEqual([]);
    ownerSteps(facts).push('x');
    expect(facts.tasks.ownerSteps).toEqual([]);
  });
});
