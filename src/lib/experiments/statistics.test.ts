import { describe, expect, test } from 'vitest';
import { calculateExperimentStatistics } from './statistics';

const common = { baselineVariation: 0, seed: 'run-1:primary', draws: 12_000 } as const;

describe('bayesian-v1 statistics', () => {
  test('uses the Beta(1,1) posterior and treats equal conversion evidence symmetrically', () => {
    const result = calculateExperimentStatistics({
      ...common,
      model: 'conversion',
      desiredDirection: 'increase',
      variations: [
        { exposed: 100, conversions: 20 },
        { exposed: 100, conversions: 20 },
      ],
    });

    expect(result.statisticsVersion).toBe('bayesian-v1');
    expect(result.variations[0].posteriorMean).toBeCloseTo(21 / 102, 10);
    expect(result.variations[1].posteriorMean).toBeCloseTo(21 / 102, 10);
    expect(result.variations[0].probabilityToWin).toBeCloseTo(0.5, 1);
    expect(result.variations[1].uplift.credibleInterval[0]).toBeLessThan(0);
    expect(result.variations[1].uplift.credibleInterval[1]).toBeGreaterThan(0);
  });

  test('strong conversion evidence has high probability to win and low expected loss', () => {
    const result = calculateExperimentStatistics({
      ...common,
      model: 'conversion',
      desiredDirection: 'increase',
      variations: [
        { exposed: 200, conversions: 20 },
        { exposed: 200, conversions: 80 },
      ],
    });

    expect(result.variations[1].probabilityToWin).toBeGreaterThan(0.999);
    expect(result.variations[1].expectedLoss).toBeLessThan(result.variations[0].expectedLoss);
    expect(result.variations[1].uplift.credibleInterval[0]).toBeGreaterThan(1);
  });

  test('uses Gamma-Poisson rates for counts and honors decrease direction', () => {
    const increase = calculateExperimentStatistics({
      ...common,
      model: 'count',
      desiredDirection: 'increase',
      variations: [
        { exposed: 100, count: 80 },
        { exposed: 100, count: 20 },
      ],
    });
    const decrease = calculateExperimentStatistics({
      ...common,
      model: 'count',
      desiredDirection: 'decrease',
      variations: [
        { exposed: 100, count: 80 },
        { exposed: 100, count: 20 },
      ],
    });

    expect(increase.variations[0].posteriorMean).toBeCloseTo(81 / 101, 10);
    expect(increase.variations[0].probabilityToWin).toBeGreaterThan(0.999);
    expect(decrease.variations[1].probabilityToWin).toBeGreaterThan(0.999);
  });

  test('Bayesian bootstrap is deterministic by stored seed without snapshotting random draws', () => {
    const input = {
      ...common,
      model: 'continuous' as const,
      desiredDirection: 'increase' as const,
      variations: [{ values: [1, 2, 3, 4] }, { values: [3, 4, 5, 6] }],
    };
    const first = calculateExperimentStatistics(input);
    const second = calculateExperimentStatistics(input);
    const anotherSeed = calculateExperimentStatistics({ ...input, seed: 'run-2:primary' });

    expect(first).toEqual(second);
    expect(first).not.toEqual(anotherSeed);
    expect(first.variations[1].probabilityToWin).toBeGreaterThan(0.9);
    expect(first.variations[1].posteriorMean).toBeCloseTo(4.5, 10);
  });

  test('rejects invalid sufficient statistics instead of producing misleading results', () => {
    expect(() =>
      calculateExperimentStatistics({
        ...common,
        model: 'conversion',
        desiredDirection: 'increase',
        variations: [
          { exposed: 3, conversions: 4 },
          { exposed: 3, conversions: 0 },
        ],
      }),
    ).toThrow();
  });
});
