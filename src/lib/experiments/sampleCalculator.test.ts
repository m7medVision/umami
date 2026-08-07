import { describe, expect, test } from 'vitest';
import { calculateExperimentSampleGuidance } from './sampleCalculator';

describe('Experiment pre-run sample and runtime guidance', () => {
  test('matches a worked two-Variation conversion example', () => {
    expect(
      calculateExperimentSampleGuidance({
        baselineRate: 0.1,
        minimumDetectableEffect: 0.02,
        expectedDailyTraffic: 1000,
        variationCount: 2,
      }),
    ).toEqual({
      sampleSizePerVariation: 3841,
      totalSampleSize: 7682,
      estimatedRuntimeDays: 8,
      confidenceLevel: 0.95,
      power: 0.8,
    });
  });

  test('accounts for additional Variation comparisons without blocking a Run', () => {
    const guidance = calculateExperimentSampleGuidance({
      baselineRate: 0.25,
      minimumDetectableEffect: 0.05,
      expectedDailyTraffic: 1200,
      variationCount: 4,
    });

    expect(guidance).toEqual({
      sampleSizePerVariation: 1669,
      totalSampleSize: 6676,
      estimatedRuntimeDays: 6,
      confidenceLevel: 0.95,
      power: 0.8,
    });
  });

  test.each([
    { baselineRate: 0, minimumDetectableEffect: 0.01, expectedDailyTraffic: 1, variationCount: 2 },
    { baselineRate: 1, minimumDetectableEffect: 0.01, expectedDailyTraffic: 1, variationCount: 2 },
    { baselineRate: 0.5, minimumDetectableEffect: 0, expectedDailyTraffic: 1, variationCount: 2 },
    {
      baselineRate: 0.99,
      minimumDetectableEffect: 0.02,
      expectedDailyTraffic: 1,
      variationCount: 2,
    },
    { baselineRate: 0.5, minimumDetectableEffect: 0.1, expectedDailyTraffic: 0, variationCount: 2 },
    { baselineRate: 0.5, minimumDetectableEffect: 0.1, expectedDailyTraffic: 1, variationCount: 1 },
    {
      baselineRate: 0.5,
      minimumDetectableEffect: 0.1,
      expectedDailyTraffic: 1,
      variationCount: 11,
    },
  ])('rejects invalid calculator ranges: %#', input => {
    expect(() => calculateExperimentSampleGuidance(input)).toThrow();
  });
});
