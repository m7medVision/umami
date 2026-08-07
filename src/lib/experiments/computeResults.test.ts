import { expect, test } from 'vitest';
import { computeExperimentResults } from './computeResults';

const day = 86_400_000;
const run = {
  id: 'run-1',
  featureFlagVariations: [{ name: 'Control' }, { name: 'Treatment' }],
  variationWeights: [0.5, 0.5],
  baselineVariation: 0,
  statisticsVersion: 'bayesian-v1',
  startedAt: new Date('2026-01-01T00:00:00Z'),
  pausedAt: null,
  completedAt: null,
  accumulatedPausedDurationMs: 0,
  safeguards: {
    minimumSampleSizePerVariation: 1,
    minimumActiveDays: 7,
    probabilityToWinThreshold: 0,
    expectedLossThreshold: 1,
    sampleRatioMismatchAlpha: 0.01,
  },
};
const outcomes = [
  {
    id: 'primary',
    name: 'Signup',
    type: 'conversion',
    countingMode: 'unique',
    attributionScope: 'both',
    desiredDirection: 'increase' as const,
    role: 'primary' as const,
  },
  {
    id: 'secondary',
    name: 'Clicks',
    type: 'count',
    countingMode: 'count',
    attributionScope: 'both',
    desiredDirection: 'decrease' as const,
    role: 'secondary' as const,
  },
];

test('computes separate modes, SRM, and Primary-only readiness', () => {
  const result = computeExperimentResults({
    run,
    outcomes,
    exposures: [
      { scope: 'session', variation: 0, exposed: 100 },
      { scope: 'session', variation: 1, exposed: 100 },
      { scope: 'visitor', variation: 0, exposed: 190 },
      { scope: 'visitor', variation: 1, exposed: 10 },
    ],
    units: [
      ...Array.from({ length: 30 }, () => ({
        outcomeId: 'primary',
        scope: 'session' as const,
        variation: 0,
        converted: 1,
        eventCount: 1,
        value: 1,
      })),
      ...Array.from({ length: 60 }, () => ({
        outcomeId: 'primary',
        scope: 'session' as const,
        variation: 1,
        converted: 1,
        eventCount: 1,
        value: 1,
      })),
    ],
    computedAt: new Date(run.startedAt.getTime() + 8 * day),
    sourceDataThroughAt: new Date('2026-01-09T00:00:00Z'),
  });

  expect(result.modes.session.totalExposed).toBe(200);
  expect(result.modes.session.exposures[0].rate).toBe(0.5);
  expect(result.modes.visitor.readiness.checks.sampleRatioMismatch.passed).toBe(false);
  expect(result.warnings).toContain('Visitor allocation has sample-ratio mismatch.');
  expect(result.exploratory.filtersAffectOfficialReadiness).toBe(false);

  const changedSecondary = computeExperimentResults({
    run,
    outcomes,
    exposures: [
      { scope: 'session', variation: 0, exposed: 100 },
      { scope: 'session', variation: 1, exposed: 100 },
    ],
    units: Array.from({ length: 1_000 }, () => ({
      outcomeId: 'secondary',
      scope: 'session' as const,
      variation: 0,
      converted: 1,
      eventCount: 10,
      value: 10,
    })),
    computedAt: new Date(run.startedAt.getTime() + 8 * day),
    sourceDataThroughAt: new Date(),
  });
  expect(changedSecondary.modes.session.readiness.winnerVariation).toBe(
    computeExperimentResults({
      run,
      outcomes,
      exposures: [
        { scope: 'session', variation: 0, exposed: 100 },
        { scope: 'session', variation: 1, exposed: 100 },
      ],
      units: [],
      computedAt: new Date(run.startedAt.getTime() + 8 * day),
      sourceDataThroughAt: new Date(),
    }).modes.session.readiness.winnerVariation,
  );
});

test('surfaces diagnostics and raw retention expiry', () => {
  const computedAt = new Date('2026-02-01T00:00:00Z');
  const result = computeExperimentResults({
    run: { ...run, rawDataRetainedUntil: new Date('2026-01-31T00:00:00Z') },
    outcomes,
    exposures: [],
    units: [],
    diagnostics: [
      { type: 'excluded-currency', count: 2 },
      { type: 'late-event', count: 1 },
      { type: 'missing-identity', count: 3 },
      { type: 'crossover', count: 1 },
    ],
    computedAt,
    sourceDataThroughAt: computedAt,
  });
  expect(result.rawRetention.expired).toBe(true);
  expect(result.diagnostics).toMatchObject({
    excludedCurrency: 2,
    lateEvents: 1,
    missingIdentity: 3,
    crossovers: 1,
  });
  expect(result.warnings).toHaveLength(5);
});
