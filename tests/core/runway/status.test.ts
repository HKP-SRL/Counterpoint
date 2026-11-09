import { describe, expect, it } from 'vitest';
import type { PhaseFacts, PlanFacts } from '../../../src/core/framework/port.ts';
import { derivePhaseStatus, phasePrerequisites } from '../../../src/core/runway/status.ts';

function plan(overrides: Partial<PlanFacts> = {}): PlanFacts {
  return {
    id: '02-01',
    file: 'plans/02-01.md',
    wave: 1,
    dependsOn: [],
    autonomous: true,
    objective: null,
    filesModified: [],
    userSetup: [],
    hasSummary: false,
    ...overrides,
  };
}

function phase(overrides: Partial<PhaseFacts> = {}): PhaseFacts {
  return {
    id: '02',
    number: [2],
    name: 'Thing',
    inserted: false,
    dir: 'phases/02-thing',
    goal: null,
    dependsOn: null,
    requirements: null,
    hasContext: true,
    plans: [plan()],
    unreadable: null,
    ...overrides,
  };
}

const unreadable = { file: 'phases/02-thing/02-01.md', reason: 'bad YAML' };

describe('derivePhaseStatus', () => {
  it('reports an unreadable phase as unreadable, whatever else is true', () => {
    expect(derivePhaseStatus(phase({ unreadable }))).toEqual({
      status: 'unreadable',
      notReadyReason: null,
    });
    expect(derivePhaseStatus(phase({ unreadable }), 'on-runway').status).toBe('unreadable');
  });

  it('reports a phase whose every plan has a summary as built', () => {
    const built = phase({ plans: [plan({ hasSummary: true }), plan({ id: '02-02', hasSummary: true })] });
    expect(derivePhaseStatus(built)).toEqual({ status: 'built', notReadyReason: null });
  });

  it('is not built while any plan lacks a summary', () => {
    const partial = phase({ plans: [plan({ hasSummary: true }), plan({ id: '02-02' })] });
    expect(derivePhaseStatus(partial).status).toBe('ready');
  });

  it('reports context plus at least one plan as ready', () => {
    expect(derivePhaseStatus(phase())).toEqual({ status: 'ready', notReadyReason: null });
  });

  it('reports context without plans as not planned, reason no-plans', () => {
    expect(derivePhaseStatus(phase({ plans: [] }))).toEqual({
      status: 'not-planned',
      notReadyReason: 'no-plans',
    });
  });

  it('reports a phase without context as not planned, reason no-context', () => {
    expect(derivePhaseStatus(phase({ hasContext: false }))).toEqual({
      status: 'not-planned',
      notReadyReason: 'no-context',
    });
    expect(derivePhaseStatus(phase({ hasContext: false, plans: [], dir: null }))).toEqual({
      status: 'not-planned',
      notReadyReason: 'no-context',
    });
  });

  it.each(['on-runway', 'changed'] as const)('lets the %s overlay win over ready', (overlay) => {
    expect(derivePhaseStatus(phase(), overlay)).toEqual({ status: overlay, notReadyReason: null });
  });

  it.each(['on-runway', 'changed'] as const)('does not let %s win over built', (overlay) => {
    const built = phase({ plans: [plan({ hasSummary: true })] });
    expect(derivePhaseStatus(built, overlay).status).toBe('built');
  });

  it('ignores a null overlay', () => {
    expect(derivePhaseStatus(phase(), null).status).toBe('ready');
  });
});

describe('phasePrerequisites', () => {
  it('dedupes user setup by service across plans and counts non-autonomous plans', () => {
    const p = phase({
      plans: [
        plan({
          autonomous: false,
          userSetup: [
            { service: 'docker', why: 'local stack', envVars: ['DB_URL'] },
            { service: 'google-oauth', why: null, envVars: ['CLIENT_ID'] },
          ],
        }),
        plan({
          id: '02-02',
          userSetup: [{ service: 'docker', why: 'again', envVars: ['DB_URL', 'SECRET'] }],
        }),
        plan({ id: '02-03', autonomous: false }),
      ],
    });
    expect(phasePrerequisites(p)).toEqual({
      userSetup: [
        { service: 'docker', why: 'local stack', envVars: ['DB_URL', 'SECRET'] },
        { service: 'google-oauth', why: null, envVars: ['CLIENT_ID'] },
      ],
      nonAutonomous: 2,
      total: 3,
    });
  });

  it('is empty for a phase without plans', () => {
    expect(phasePrerequisites(phase({ plans: [] }))).toEqual({
      userSetup: [],
      nonAutonomous: 0,
      total: 0,
    });
  });
});
