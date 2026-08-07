import { expect, test } from 'vitest';
import {
  createExperimentAggregateCsv,
  createExperimentFrozenConfigExport,
  formulaSafeCsvCell,
} from './export';

test('CSV export is aggregate-only and formula-safe', () => {
  const csv = createExperimentAggregateCsv(
    {
      variations: [{ name: '=IMPORTXML("bad")' }],
      modes: {
        session: {
          outcomes: [
            {
              name: '+Signup',
              role: 'primary',
              totals: [{ variation: 0, exposed: 2, value: 1, rate: 0.5 }],
              statistics: {
                variations: [
                  {
                    variation: 0,
                    probabilityToWin: 0.8,
                    uplift: { credibleInterval: [-0.1, 0.2] },
                    expectedLoss: 0.01,
                  },
                ],
              },
            },
          ],
        },
      },
    },
    'session',
  );
  expect(csv).toContain("'+Signup");
  expect(csv).toContain("'=IMPORTXML");
  expect(csv).not.toContain('unitKey');
  expect(csv).not.toContain('visitorDigest');
  expect(formulaSafeCsvCell(' @SUM(A1)')).toBe('"\' @SUM(A1)"');
});

test('JSON export allowlists only frozen configuration', () => {
  const result = createExperimentFrozenConfigExport({
    runNumber: 2,
    featureFlagKey: 'checkout',
    featureFlagValueType: 'string',
    featureFlagVariations: [],
    rolloutPercentage: 100,
    variationWeights: [0.5, 0.5],
    fallthroughVariation: 0,
    baselineVariation: 0,
    assignmentPolicy: {},
    audienceSegmentSnapshot: null,
    exclusionSegmentSnapshot: null,
    statisticsVersion: 'bayesian-v1',
    bucketingVersion: 'v1',
    statisticalModel: {},
    safeguards: {},
    outcomes: [],
    unitKey: 'secret',
    visitorDigest: 'secret',
    resultSnapshot: { raw: 'secret' },
  });
  expect(JSON.stringify(result)).not.toMatch(/unitKey|visitorDigest|resultSnapshot|secret/);
  expect(result.statisticsVersion).toBe('bayesian-v1');
});
