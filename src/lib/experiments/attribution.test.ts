import { describe, expect, test } from 'vitest';
import { attributeExperimentOutcomes } from './attribution';

const at = (value: string) => new Date(value);
const exposure = {
  unitType: 'visitor' as const,
  unitKey: 'visitor-a',
  sessionId: 'session-a',
  variation: 1,
  exposedAt: at('2026-01-01T12:00:00.000Z'),
};
const assignment = {
  unitType: 'visitor' as const,
  unitKey: 'visitor-a',
  variation: 1,
  assignedAt: at('2026-01-01T11:59:00.000Z'),
};

describe('Experiment Outcome attribution', () => {
  test('uses exact ordering, visitor links and the configured window', () => {
    const result = attributeExperimentOutcomes({
      scope: 'visitor',
      countingMode: 'count',
      visitorWindowDays: 2,
      exposures: [exposure],
      assignments: [assignment],
      linkedSessions: { 'session-a': ['session-a', 'session-b'] },
      outcomes: [
        { sessionId: 'session-a', occurredAt: at('2026-01-01T11:59:59.999Z') },
        { sessionId: 'session-b', occurredAt: at('2026-01-01T12:00:00.001Z') },
        { sessionId: 'session-b', occurredAt: at('2026-01-03T12:00:00.001Z') },
      ],
    });

    expect(result.units[0]).toMatchObject({ converted: true, eventCount: 1, variation: 1 });
    expect(result.units[0].firstOutcomeAt?.toISOString()).toBe('2026-01-01T12:00:00.001Z');
  });

  test.each([
    ['unique', 1, 1],
    ['count', 2, 2],
    ['sum', 2, 7.5],
  ] as const)('supports %s counting', (countingMode, eventCount, valueSum) => {
    const result = attributeExperimentOutcomes({
      scope: 'visitor',
      countingMode,
      visitorWindowDays: 14,
      exposures: [exposure],
      assignments: [assignment],
      linkedSessions: { 'session-a': ['session-a'] },
      outcomes: [
        { sessionId: 'session-a', occurredAt: at('2026-01-02T00:00:00Z'), value: 3 },
        { sessionId: 'session-a', occurredAt: at('2026-01-02T01:00:00Z'), value: 4.5 },
      ],
    });
    expect(result.units[0]).toMatchObject({ eventCount, valueSum });
  });

  test('keeps Session and Visitor populations separate and requires the same Session', () => {
    const result = attributeExperimentOutcomes({
      scope: 'session',
      countingMode: 'count',
      visitorWindowDays: 14,
      exposures: [{ ...exposure, unitType: 'session', unitKey: 'assignment-key' }],
      assignments: [{ ...assignment, unitType: 'session', unitKey: 'assignment-key' }],
      linkedSessions: { 'session-a': ['session-a', 'session-b'] },
      outcomes: [{ sessionId: 'session-b', occurredAt: at('2026-01-02T00:00:00Z') }],
    });
    expect(result.units[0]).toMatchObject({ converted: false, eventCount: 0 });
  });

  test('excludes other currencies, tombstones, and retains first assignment after crossover', () => {
    const result = attributeExperimentOutcomes({
      scope: 'visitor',
      countingMode: 'sum',
      visitorWindowDays: 14,
      currency: 'USD',
      exposures: [exposure],
      assignments: [
        assignment,
        { ...assignment, variation: 0, assignedAt: at('2026-01-01T12:01:00Z') },
      ],
      linkedSessions: { 'session-a': ['session-a'] },
      outcomes: [
        {
          sessionId: 'session-a',
          occurredAt: at('2026-01-02T00:00:00Z'),
          value: 5,
          currency: 'EUR',
        },
        {
          sessionId: 'session-a',
          occurredAt: at('2026-01-02T01:00:00Z'),
          value: 7,
          currency: 'usd',
        },
      ],
    });
    expect(result.units[0]).toMatchObject({ variation: 1, valueSum: 7 });
    expect(result.diagnostics).toMatchObject({ excludedCurrency: 1, crossover: 1 });

    expect(
      attributeExperimentOutcomes({
        scope: 'visitor',
        countingMode: 'unique',
        visitorWindowDays: 14,
        exposures: [exposure],
        assignments: [assignment],
        outcomes: [],
        tombstonedVisitorKeys: new Set(['visitor-a']),
      }).units,
    ).toEqual([]);
  });

  test('paused attribution remains status-independent for already-exposed Units', () => {
    const result = attributeExperimentOutcomes({
      scope: 'visitor',
      countingMode: 'unique',
      visitorWindowDays: 14,
      exposures: [exposure],
      assignments: [assignment],
      linkedSessions: { 'session-a': ['session-a'] },
      outcomes: [{ sessionId: 'session-a', occurredAt: at('2026-01-05T00:00:00Z') }],
    });
    expect(result.units[0].converted).toBe(true);
  });
});
