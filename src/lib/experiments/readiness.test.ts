import { describe, expect, test } from 'vitest';
import { calculateExperimentReadiness, detectSampleRatioMismatch } from './readiness';

const day = 24 * 60 * 60 * 1000;
const safeguards = {
  minimumSampleSizePerVariation: 100,
  minimumActiveDays: 7,
  probabilityToWinThreshold: 0.95,
  expectedLossThreshold: 0.01,
  sampleRatioMismatchAlpha: 0.01,
};

function input() {
  return {
    exposedUnits: [500, 500],
    expectedWeights: [0.5, 0.5],
    activeRuntimeMs: 7 * day,
    safeguards,
    primaryOutcome: {
      variations: [
        { variation: 0, probabilityToWin: 0.03, expectedLoss: 0.2 },
        { variation: 1, probabilityToWin: 0.97, expectedLoss: 0.005 },
      ],
    },
  };
}

describe('Primary Outcome readiness', () => {
  test('requires every safeguard and recommends without mutating lifecycle state', () => {
    const result = calculateExperimentReadiness(input());

    expect(result).toMatchObject({
      status: 'Ready',
      ready: true,
      winnerVariation: 1,
      checks: {
        minimumSample: { passed: true },
        minimumRuntime: { passed: true },
        sampleRatioMismatch: { passed: true },
        probabilityToWin: { passed: true },
        expectedLoss: { passed: true },
      },
    });
    expect(result).not.toHaveProperty('runStatus');
    expect(result).not.toHaveProperty('promote');
  });

  test.each([
    { exposedUnits: [99, 901] },
    { activeRuntimeMs: 7 * day - 1 },
    {
      primaryOutcome: {
        variations: [
          { variation: 0, probabilityToWin: 0.1, expectedLoss: 0.1 },
          { variation: 1, probabilityToWin: 0.9, expectedLoss: 0.005 },
        ],
      },
    },
    {
      primaryOutcome: {
        variations: [
          { variation: 0, probabilityToWin: 0.03, expectedLoss: 0.2 },
          { variation: 1, probabilityToWin: 0.97, expectedLoss: 0.02 },
        ],
      },
    },
  ])('is not ready when one Primary safeguard fails', change => {
    expect(calculateExperimentReadiness({ ...input(), ...change }).ready).toBe(false);
  });

  test('detects severe SRM while accepting a balanced allocation', () => {
    expect(detectSampleRatioMismatch([500, 500], [0.5, 0.5], 0.01).mismatch).toBe(false);
    const severe = detectSampleRatioMismatch([900, 100], [0.5, 0.5], 0.01);
    expect(severe.mismatch).toBe(true);
    expect(severe.pValue).toBeLessThan(0.01);
  });

  test('ignores Secondary Outcome statistics entirely', () => {
    const withSecondary = {
      ...input(),
      secondaryOutcomes: [
        {
          variations: [
            { variation: 0, probabilityToWin: 1, expectedLoss: 0 },
            { variation: 1, probabilityToWin: 0, expectedLoss: 999 },
          ],
        },
      ],
    };
    expect(calculateExperimentReadiness(withSecondary)).toEqual(
      calculateExperimentReadiness(input()),
    );
  });
});
